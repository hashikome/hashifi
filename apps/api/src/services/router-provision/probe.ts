/**
 * Capability probe — ask a MikroTik what it actually is and what it can actually do,
 * before we try to configure it or push users to it.
 *
 * This exists because the system previously assumed every board behaved like the one it
 * was developed against. Two failures came from that assumption:
 *   - RouterOS 7 on smips (hAP lite) ships no hotspot at all, discovered only via a flood
 *     of "no such command or directory (hotspot)" errors from the sync daemons.
 *   - `=shared-users=` / `=rate-limit=` are rejected on RouterOS 6 hAP Lite class boards,
 *     previously handled by catching "unknown parameter" and retrying.
 *
 * Probing is strictly read-only. It never writes to the router.
 */

import {
  closeConnection,
  connectToRouter,
  type MikroTikConn,
  type RouterCredentials,
} from "../mikrotik.js";
import { RouterLogger } from "../router-log.js";
import { toRows } from "./ros-client.js";

export interface RosVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export interface RouterPackage {
  name: string;
  version: string;
  disabled: boolean;
}

export interface RouterInterface {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
}

/**
 * An entry from `/ip/address`. Needed to tell which interface carries the address we
 * manage the router on — putting the hotspot gateway there would hijack that network.
 */
export interface RouterAddress {
  /** CIDR form, e.g. "192.168.0.161/24" */
  address: string;
  interface: string;
  disabled: boolean;
}

export type WirelessStack = "wireless" | "wifi" | "none";

export interface RouterCapabilities {
  /** `/ip hotspot` menu exists — without this the product cannot work on this board */
  hotspot: boolean;
  /** `=shared-users=` accepted on `/ip/hotspot/user/add` (device limit) */
  userSharedUsers: boolean;
  /** `=rate-limit=` accepted at user level (vs profile level only) */
  userRateLimit: boolean;
  /** `/tool fetch` available — how we upload login.html without FTP */
  toolFetch: boolean;
  /** `/ip/hotspot/active/login` exists — the only way a device is signed in (ADR-0008) */
  hotspotLogin: boolean;
}

/**
 * RouterOS 7 `/system device-mode` gates features independently of the firmware.
 * A board in `home`/`basic` mode hides `/ip hotspot` entirely, producing the exact same
 * "no such command or directory" as a build that genuinely lacks it — so the two must be
 * told apart before anyone reaches for Netinstall.
 */
export interface DeviceMode {
  mode: string;
  hotspotAllowed: boolean;
  /** Versions device-mode will permit installing — it can block a downgrade. */
  allowedVersions: string | null;
}

export interface RouterCompatibility {
  ok: boolean;
  /** Blocking problems. Non-empty means provisioning must not run. */
  reasons: string[];
  /** Non-blocking observations worth showing the admin. */
  warnings: string[];
}

export interface RouterProfile {
  host: string;
  identity: string | null;
  boardName: string | null;
  architecture: string | null;
  platform: string | null;
  rosVersion: RosVersion;
  factorySoftware: string | null;
  uptime: string | null;
  memory: { freeBytes: number; totalBytes: number };
  storage: { freeBytes: number; totalBytes: number };
  packages: RouterPackage[];
  interfaces: RouterInterface[];
  addresses: RouterAddress[];
  wirelessStack: WirelessStack;
  /** null on RouterOS 6, which has no device-mode menu */
  deviceMode: DeviceMode | null;
  hotspotServers: { name: string; interface: string; profile: string; disabled: boolean }[];
  capabilities: RouterCapabilities;
  compatibility: RouterCompatibility;
  probedAt: string;
}

const rows = toRows;

function num(value: string | null): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function bool(value: string | null): boolean {
  return value === "true" || value === "yes";
}

const MIB = 1024 * 1024;

export function parseRosVersion(raw: string | null): RosVersion {
  const text = raw ?? "";
  // "7.23.2 (stable)" / "6.49.8 (long-term)" → 7.23.2 / 6.49.8
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  return {
    major: match ? Number(match[1]) : 0,
    minor: match ? Number(match[2]) : 0,
    patch: match?.[3] ? Number(match[3]) : 0,
    raw: text || "unknown",
  };
}

/**
 * Derive what the board supports.
 *
 * RouterOS 6 is treated as NOT supporting user-level `shared-users` / `rate-limit`.
 * That is deliberately conservative: it matches the hAP Lite behaviour documented in
 * §13.7 of the MikroTik guide, and being wrong in this direction is harmless — the
 * provisioner applies those limits at profile level instead. Being wrong in the other
 * direction breaks user creation outright.
 */
function deriveCapabilities(
  rosVersion: RosVersion,
  packages: RouterPackage[],
  hotspotMenuExists: boolean,
  hotspotLogin: boolean,
): RouterCapabilities {
  const v7 = rosVersion.major >= 7;
  const advancedTools = packages.find((p) => p.name === "advanced-tools");

  return {
    hotspot: hotspotMenuExists,
    userSharedUsers: v7,
    userRateLimit: v7,
    // fetch lives in the main bundle on v7, and on v6 unless advanced-tools is disabled
    toolFetch: v7 || !advancedTools || !advancedTools.disabled,
    hotspotLogin,
  };
}

/**
 * Asked with no arguments, a board with the command refuses the missing values and signs nobody
 * in; only a board without it says "no such command".
 */
async function answersLogin(conn: MikroTikConn): Promise<boolean> {
  try {
    await conn.write("/ip/hotspot/active/login");
    return true;
  } catch (err) {
    return !(err instanceof Error && /no such command/i.test(err.message));
  }
}

/**
 * Merge a fresh probe's capabilities with what is already cached, so a *measured* `false` is
 * never overwritten by a *guessed* `true`.
 *
 * `deriveCapabilities` can only infer user-level `rate-limit`/`shared-users` from the RouterOS
 * major version, and that inference is wrong on real boards — an hAP lite on 7.23.2 rejects both.
 * Only the self-test (`verify.ts`) can establish the truth, by trying. Without this latch every
 * re-provision would re-probe, guess `true` again, and throw that discovery away.
 *
 * One-way on purpose: false wins, because nothing but a real rejection ever sets it.
 */
export function mergeCapabilities(stored: unknown, probed: RouterCapabilities): RouterCapabilities {
  if (!stored || typeof stored !== "object") return probed;
  const prev = stored as Partial<RouterCapabilities>;
  return {
    ...probed,
    userRateLimit: prev.userRateLimit === false ? false : probed.userRateLimit,
    userSharedUsers: prev.userSharedUsers === false ? false : probed.userSharedUsers,
  };
}

/**
 * Probe a board and apply the latch in one step. **Use this, not `probeRouter`, wherever a stored
 * row exists** — building a dialect from a raw probe is how a measured capability gets forgotten.
 *
 * Every call site was open-coding `{ ...probed, capabilities: mergeCapabilities(...) }`, and on
 * 2026-08-12 one of them (`setup.ts`'s phase 1) was found not to. The consequence was subtle rather
 * than loud: phases 3-5 used merged capabilities and phase 6 used raw ones, so a single run held two
 * different views of the same board — the self-test sent parameters the board had already rejected,
 * retried, and re-"discovered" what was already in the database, on every run, forever.
 *
 * The rule was written down in CLAUDE.md before that happened. It was still missed, which is the
 * argument for a function rather than a longer comment.
 */
export async function probeRouterMerged(
  creds: Parameters<typeof probeRouter>[0],
  logger: Parameters<typeof probeRouter>[1],
  storedCapabilities: unknown,
): Promise<RouterProfile> {
  const probed = await probeRouter(creds, logger);
  return { ...probed, capabilities: mergeCapabilities(storedCapabilities, probed.capabilities) };
}

function assessCompatibility(profile: Omit<RouterProfile, "compatibility">): RouterCompatibility {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const { capabilities, architecture, rosVersion, storage, memory } = profile;

  if (!capabilities.hotspot) {
    const deviceMode = profile.deviceMode;

    if (deviceMode && !deviceMode.hotspotAllowed) {
      // Cheap fix — check this before anyone considers reflashing the board.
      reasons.push(
        `/ip hotspot is hidden because device-mode is "${deviceMode.mode}", which does not ` +
          `permit hotspot. Run: /system device-mode update mode=advanced — then confirm ` +
          `within 5 minutes by pressing the reset button or power-cycling the router, ` +
          `otherwise the change is discarded. No reinstall is needed.`,
      );
    } else {
      // RouterOS 7.20+ moved hotspot out of the core build on space-constrained
      // architectures (smips especially) and ships it as an "Extra package". The menu
      // being absent therefore usually means a missing .npk, NOT a dead-end board.
      const version = rosVersion.raw.split(" ")[0] ?? rosVersion.raw;
      reasons.push(
        `The hotspot subsystem is not installed${
          deviceMode
            ? ` (device-mode "${deviceMode.mode}" permits it, so that is not the cause)`
            : ""
        }. RouterOS ${version} ships hotspot as a separate Extra package on ` +
          `${architecture ?? "this architecture"}. Download ` +
          `hotspot-${version}-${architecture ?? "<arch>"}.npk from mikrotik.com/download — ` +
          `it must match the installed version EXACTLY, and from the same release channel — ` +
          `upload it to Files, then reboot.`,
      );
    }
  }

  if (capabilities.hotspot && !capabilities.hotspotLogin) {
    reasons.push(
      `RouterOS ${rosVersion.raw} has no /ip hotspot active login, which is how HashiFi signs ` +
        `a device in. Upgrade RouterOS.`,
    );
  }

  if (!capabilities.hotspot && storage.totalBytes > 0) {
    warnings.push(
      `${(storage.freeBytes / MIB).toFixed(1)} MiB of flash free — the hotspot .npk is small ` +
        `(a few hundred KB), so it should upload without freeing space first.`,
    );
  }

  if (capabilities.hotspot && profile.hotspotServers.length === 0) {
    warnings.push("No hotspot server is configured yet — provisioning will create one.");
  }

  if (!capabilities.toolFetch) {
    warnings.push(
      "/tool fetch is unavailable, so login.html cannot be pushed automatically. " +
        "Upload it manually via Files (§3.2).",
    );
  }

  if (rosVersion.major > 0 && rosVersion.major < 7) {
    warnings.push(
      "RouterOS 6 — device limit and speed caps will be applied at hotspot-profile level " +
        "rather than per user (§13.7).",
    );
  }

  if (storage.totalBytes > 0 && storage.freeBytes < 2 * MIB) {
    warnings.push(
      `Only ${(storage.freeBytes / MIB).toFixed(1)} MiB of flash free — too little to ` +
        `upload a firmware package for an in-place upgrade or downgrade.`,
    );
  }

  if (memory.totalBytes > 0 && memory.totalBytes <= 32 * MIB) {
    warnings.push(
      `Board has ${(memory.totalBytes / MIB).toFixed(0)} MB RAM — marginal for a paid ` +
        `hotspot with many concurrent users.`,
    );
  }

  if (profile.wirelessStack === "none") {
    warnings.push(
      "No wireless interfaces found — the hotspot must run on an ethernet/bridge " +
        "interface, or clients must arrive via a separate AP.",
    );
  }

  return { ok: reasons.length === 0, reasons, warnings };
}

/**
 * Connect, interrogate, disconnect. Read-only.
 *
 * Throws a typed `RouterError` if the device is unreachable or rejects our credentials;
 * a reachable-but-incompatible board resolves normally with `compatibility.ok === false`.
 */
export async function probeRouter(
  creds: RouterCredentials,
  logger: RouterLogger = new RouterLogger("probe"),
): Promise<RouterProfile> {
  const host = creds.host;
  let conn: MikroTikConn | null = null;

  try {
    conn = await logger.connect(host, () => connectToRouter(creds));
    const c = conn;

    const resource = rows(
      await logger.run({ host, command: "/system/resource/print" }, () =>
        c.write("/system/resource/print"),
      ),
    )[0];

    const identityRow = rows(
      await logger.run({ host, command: "/system/identity/print" }, () =>
        c.write("/system/identity/print"),
      ),
    )[0];

    const packages: RouterPackage[] = rows(
      await logger.run({ host, command: "/system/package/print" }, () =>
        c.write("/system/package/print"),
      ),
    ).map((p) => ({
      name: p.get("name") ?? "unknown",
      version: p.get("version") ?? "",
      disabled: bool(p.get("disabled")),
    }));

    const interfaces: RouterInterface[] = rows(
      await logger.run({ host, command: "/interface/print" }, () => c.write("/interface/print")),
    ).map((i) => ({
      name: i.get("name") ?? "unknown",
      type: i.get("type") ?? "unknown",
      running: bool(i.get("running")),
      disabled: bool(i.get("disabled")),
    }));

    const addresses: RouterAddress[] = rows(
      await logger.run({ host, command: "/ip/address/print" }, () => c.write("/ip/address/print")),
    ).map((a) => ({
      address: a.get("address") ?? "",
      interface: a.get("interface") ?? "",
      disabled: bool(a.get("disabled")),
    }));

    // The capability questions. `probe()` returns null instead of throwing when the
    // menu doesn't exist on this firmware — that null IS the answer.
    // RouterOS 6 has no device-mode menu — null there, which is fine.
    const deviceModeRow = rows(
      await logger.probe({ host, command: "/system/device-mode/print" }, () =>
        c.write("/system/device-mode/print"),
      ),
    )[0];

    const deviceMode: DeviceMode | null = deviceModeRow
      ? {
          mode: deviceModeRow.get("mode") ?? "unknown",
          // Absent field means the build doesn't gate hotspot — treat as allowed rather
          // than blaming device-mode for something it isn't doing.
          hotspotAllowed:
            deviceModeRow.get("hotspot") === null || bool(deviceModeRow.get("hotspot")),
          allowedVersions: deviceModeRow.get("allowed-versions") ?? null,
        }
      : null;

    const hotspotMenu = await logger.probe({ host, command: "/ip/hotspot/print" }, () =>
      c.write("/ip/hotspot/print"),
    );

    const wifiMenu = await logger.probe({ host, command: "/interface/wifi/print" }, () =>
      c.write("/interface/wifi/print"),
    );

    const wirelessMenu =
      wifiMenu === null
        ? await logger.probe({ host, command: "/interface/wireless/print" }, () =>
            c.write("/interface/wireless/print"),
          )
        : null;

    const wirelessStack: WirelessStack =
      wifiMenu !== null ? "wifi" : wirelessMenu !== null ? "wireless" : "none";

    const rosVersion = parseRosVersion(resource?.get("version"));
    const capabilities = deriveCapabilities(
      rosVersion,
      packages,
      hotspotMenu !== null,
      hotspotMenu !== null && (await answersLogin(c)),
    );

    const partial: Omit<RouterProfile, "compatibility"> = {
      host,
      identity: identityRow?.get("name") ?? null,
      boardName: resource?.get("board-name") ?? null,
      architecture: resource?.get("architecture-name") ?? null,
      platform: resource?.get("platform") ?? null,
      rosVersion,
      factorySoftware: resource?.get("factory-software") ?? null,
      uptime: resource?.get("uptime") ?? null,
      memory: {
        freeBytes: num(resource?.get("free-memory")),
        totalBytes: num(resource?.get("total-memory")),
      },
      storage: {
        freeBytes: num(resource?.get("free-hdd-space")),
        totalBytes: num(resource?.get("total-hdd-space")),
      },
      packages,
      interfaces,
      addresses,
      wirelessStack,
      deviceMode,
      hotspotServers: rows(hotspotMenu).map((h) => ({
        name: h.get("name") ?? "",
        interface: h.get("interface") ?? "",
        profile: h.get("profile") ?? "",
        disabled: bool(h.get("disabled")),
      })),
      capabilities,
      probedAt: new Date().toISOString(),
    };

    const profile: RouterProfile = { ...partial, compatibility: assessCompatibility(partial) };

    logger.summary(
      `${profile.boardName ?? "unknown board"} · RouterOS ${rosVersion.raw} · ` +
        `${profile.architecture ?? "?"} · hotspot=${capabilities.hotspot ? "yes" : "NO"} · ` +
        `${profile.compatibility.ok ? "COMPATIBLE" : "INCOMPATIBLE"}`,
      { capabilities, compatibility: profile.compatibility },
    );

    for (const reason of profile.compatibility.reasons) logger.error(`Blocking: ${reason}`);
    for (const warning of profile.compatibility.warnings) logger.warn(`Warning: ${warning}`);

    return profile;
  } finally {
    if (conn) await closeConnection(conn);
  }
}
