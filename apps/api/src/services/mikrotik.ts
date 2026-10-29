import { RouterOSAPI } from "routeros";
import { minutesToRosUptime } from "../utils/duration.js";

const CONNECT_TIMEOUT = Number(process.env.MIKROTIK_CONNECT_TIMEOUT ?? 10);

export type MikroTikConn = RouterOSAPI;

/**
 * How this API reaches a router's RouterOS API: the management target, which is not
 * necessarily the router's address on its venue LAN (`routers.ipAddress`).
 */
export interface RouterCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface CreateHotspotUserOptions {
  code: string;
  deviceLimit: number;
  downloadSpeedMbps: number;
  uploadSpeedMbps: number | null;
  /** null or -1 = unlimited */
  dataLimitGb: number | null;
  /** Whole minutes. null or 0 = unlimited */
  durationMinutes: number | null;
  /**
   * Hotspot **user profile** to put the voucher on, or null for the router's `default`.
   *
   * Set this on a board that rejects per-user `rate-limit`/`shared-users` — the limits ride on the
   * profile instead. `ensureHotspotUserProfile` must have created it first.
   */
  profileName?: string | null;
}

/**
 * The per-package user profile name.
 *
 * Derived from the package **id**, never its name, so renaming a package does not orphan the profile
 * it is already using. `/ip hotspot user profile` has no `comment` field — measured, it rejects the
 * parameter outright — so the `wbs-` prefix is the only idempotency tag available here, which is the
 * documented exception in CLAUDE.md.
 *
 * The full UUID makes the name 44 characters. Verified accepted and read back unchanged on an hAP
 * lite (7.23.2), and it keeps the name greppable against the `packages` table, which matters because
 * there is no comment field to annotate.
 */
export function userProfileNameForPackage(packageId: string): string {
  return `wbs-pkg-${packageId}`;
}

/**
 * The throttled twin of the per-package profile.
 *
 * Throttling swaps a voucher between these two profiles rather than writing `rate-limit` onto the
 * user, because the hAP lite (smips, 7.23.2) rejects `rate-limit` on `/ip hotspot user` outright —
 * `unknown parameter` — while accepting it on a profile (§13.7). The old throttle path used the
 * rejected form, so on that board it could never take effect and retried forever.
 *
 * It must be a *second* profile, not an edit of the first: `wbs-pkg-<id>` is shared by every
 * voucher on the package, so throttling one customer by editing it would throttle all of them.
 *
 * Prefixed rather than suffixed so it is exactly as long as `wbs-pkg-<uuid>` — 44 characters, the
 * length already verified as accepted and read back unchanged on the hAP lite. A `-thr` suffix
 * would have been 48 and untested, and this is not a thing worth discovering on a live router at a
 * peak-hour boundary.
 */
export function throttledProfileNameForPackage(packageId: string): string {
  return `wbs-thr-${packageId}`;
}

/**
 * Create or update the per-package user profile that carries the limits a board will not accept on
 * the user itself.
 *
 * **Why per package and not per router.** Provisioning used to create a single router-level
 * `wbs-hs-users` profile carrying `shared-users=1` and no rate-limit at all — and nothing was ever
 * assigned to it, because `createHotspotUser` never sent `=profile=`. So on a board that rejects
 * per-user `rate-limit` every voucher sat on `default` with no speed cap from either mechanism. One
 * profile per router could not have fixed it either: two packages on the same router need different
 * speeds.
 *
 * Idempotent, and updates in place — a package whose speed is edited should change the cap for
 * vouchers already issued against it, which is what a `set` on the existing profile does.
 */
export async function ensureHotspotUserProfile(
  conn: MikroTikConn,
  opts: {
    name: string;
    /** RouterOS `rate-limit`, e.g. "2M/10M" (up/down). null leaves the profile uncapped. */
    rateLimit: string | null;
    /** Simultaneous devices per voucher. */
    sharedUsers: number;
  },
): Promise<void> {
  const params = [`=shared-users=${Math.max(1, opts.sharedUsers)}`];
  if (opts.rateLimit) params.push(`=rate-limit=${opts.rateLimit}`);

  const existing = (await conn.write("/ip/hotspot/user/profile/print", [
    `?name=${opts.name}`,
  ])) as Record<string, string>[];

  if (existing[0]?.[".id"]) {
    await conn.write("/ip/hotspot/user/profile/set", [`=.id=${existing[0][".id"]}`, ...params]);
  } else {
    await conn.write("/ip/hotspot/user/profile/add", [`=name=${opts.name}`, ...params]);
  }

  // Read back. `add`/`set` returning without error is not proof, and a voucher pointing at a
  // profile that does not exist is rejected by the router — so this failing loudly here is much
  // better than every voucher push failing afterwards.
  const readBack = (await conn.write("/ip/hotspot/user/profile/print", [
    `?name=${opts.name}`,
  ])) as Record<string, string>[];
  if (!readBack[0]) {
    throw new Error(
      `Hotspot user profile "${opts.name}" was accepted by the router but is not present in ` +
        `/ip/hotspot/user/profile — vouchers on it would have no speed limit.`,
    );
  }
}

/** RouterOS `rate-limit` for a package, or null when it has no speed cap. */
export function rateLimitFor(pkg: {
  downloadSpeedMbps: number;
  uploadSpeedMbps: number | null;
}): string | null {
  if (!pkg.downloadSpeedMbps || pkg.downloadSpeedMbps <= 0) return null;
  const up = pkg.uploadSpeedMbps ?? pkg.downloadSpeedMbps;
  return `${up}M/${pkg.downloadSpeedMbps}M`;
}

/** A package is throttleable only if it says what to throttle *to*. */
export function packageCanThrottle(pkg: { throttledDownloadMbps: number | null }): boolean {
  return pkg.throttledDownloadMbps !== null && pkg.throttledDownloadMbps > 0;
}

/**
 * RouterOS `rate-limit` for a package's throttled state, or null when it has none configured.
 *
 * Mirrors the upload fallback of `rateLimitFor`: an unset throttled upload means "throttle upload
 * to the same figure as download", not "leave upload uncapped".
 */
export function throttledRateLimitFor(pkg: {
  throttledDownloadMbps: number | null;
  throttledUploadMbps: number | null;
}): string | null {
  if (!packageCanThrottle(pkg)) return null;
  const down = pkg.throttledDownloadMbps as number;
  const up = pkg.throttledUploadMbps ?? down;
  return `${up}M/${down}M`;
}

export interface MikroTikActiveClient {
  id: string;
  user: string;
  mac: string;
  ip: string;
  uptime: string;
  idleTime: string;
  bytesIn: number;
  bytesOut: number;
}

export async function connectToRouter(creds: RouterCredentials): Promise<MikroTikConn> {
  const conn = new RouterOSAPI({
    host: creds.host,
    user: creds.username,
    password: creds.password,
    port: creds.port,
    timeout: CONNECT_TIMEOUT,
    keepalive: false,
  });

  const timeoutMs = CONNECT_TIMEOUT * 1000;
  await Promise.race([
    conn.connect(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Connection to ${creds.host}:${creds.port} timed out after ${CONNECT_TIMEOUT}s`,
            ),
          ),
        timeoutMs,
      ),
    ),
  ]);

  return conn;
}

export async function closeConnection(conn: MikroTikConn): Promise<void> {
  try {
    await conn.close();
  } catch {
    // ignore close errors — connection may already be gone
  }
}

export async function hotspotUserExists(conn: MikroTikConn, code: string): Promise<boolean> {
  const result = await conn.write("/ip/hotspot/user/print", [`?name=${code}`]);
  return Array.isArray(result) && result.length > 0;
}

/**
 * What this board accepts on `/ip/hotspot/user/add`.
 *
 * When known (cached by the capability probe) we send exactly the supported params.
 * When null — an un-probed router — we stay optimistic and strip params on rejection,
 * which is the pre-probe behaviour and still correct, just a round-trip slower.
 */
export interface HotspotUserCapabilities {
  userRateLimit: boolean;
  userSharedUsers: boolean;
}

const OPTIONAL_PARAM_PREFIXES = ["=rate-limit=", "=shared-users="];

export async function createHotspotUser(
  conn: MikroTikConn,
  opts: CreateHotspotUserOptions,
  caps: HotspotUserCapabilities | null = null,
): Promise<void> {
  const params: string[] = [`=name=${opts.code}`, `=password=${opts.code}`];

  if (opts.dataLimitGb !== null && opts.dataLimitGb > 0) {
    params.push(`=limit-bytes-total=${opts.dataLimitGb * 1_073_741_824}`);
  }
  if (opts.durationMinutes !== null && opts.durationMinutes > 0) {
    // Minutes, not hours: a 30-minute voucher must not be enforced as an hour. limit-uptime is
    // [Nd]HH:MM:SS, so the router can express it exactly.
    params.push(`=limit-uptime=${minutesToRosUptime(opts.durationMinutes)}`);
  }
  /*
   * The profile carries the limits this board will not accept on the user.
   *
   * Sent BEFORE the optional params, because the retry-without-optionals fallback below strips
   * those and must not strip this — the profile is the only thing capping speed on such a board.
   */
  if (opts.profileName) params.push(`=profile=${opts.profileName}`);

  const rateLimit = rateLimitFor(opts);
  if ((caps?.userRateLimit ?? true) && rateLimit) {
    params.push(`=rate-limit=${rateLimit}`);
  }
  // Previously captured and silently dropped — device limits never reached the router.
  if ((caps?.userSharedUsers ?? true) && opts.deviceLimit > 0) {
    params.push(`=shared-users=${opts.deviceLimit}`);
  }

  try {
    await conn.write("/ip/hotspot/user/add", params);
  } catch (err) {
    const msg = String(err);
    const optional = params.filter((p) => OPTIONAL_PARAM_PREFIXES.some((x) => p.startsWith(x)));

    if (msg.includes("unknown parameter") && optional.length > 0) {
      console.warn(
        `[MikroTik] Router rejected ${optional.map((p) => p.split("=")[1]).join(", ")} — ` +
          `retrying without. Probe this router to avoid the extra round-trip.`,
      );
      await conn.write(
        "/ip/hotspot/user/add",
        params.filter((p) => !OPTIONAL_PARAM_PREFIXES.some((x) => p.startsWith(x))),
      );
    } else {
      throw err;
    }
  }

  // Read back: `add` returning without error is not proof the user exists.
  if (!(await hotspotUserExists(conn, opts.code))) {
    throw new Error(
      `Hotspot user "${opts.code}" was accepted by the router but is not present in ` +
        `/ip/hotspot/user — the router did not actually grant access.`,
    );
  }
}

/**
 * Move an existing hotspot user onto `profileName` if it is not already there.
 *
 * Needed because the push paths skip a voucher that already exists, so without this the fix would
 * only ever apply to *new* vouchers — every code already on a router would keep sitting on
 * `default` with no speed cap, forever. Returns true when it actually changed something, so the
 * caller can log a repair rather than silently mutating live config.
 */
export async function ensureHotspotUserProfileAssigned(
  conn: MikroTikConn,
  code: string,
  profileName: string,
  /**
   * Profiles that are also correct and must be left alone — in practice the package's throttled
   * twin. Without this, a voucher that the live monitor has throttled would be yanked back to full
   * speed by the next voucher push, because a repair pass cannot tell "wrong profile" from
   * "deliberately throttled right now".
   */
  alsoAcceptable: readonly string[] = [],
): Promise<boolean> {
  const result = await conn.write("/ip/hotspot/user/print", [`?name=${code}`]);
  if (!Array.isArray(result) || result.length === 0) return false;
  const row = result[0] as Record<string, string>;
  if (!row[".id"]) return false;
  if (row.profile === profileName || alsoAcceptable.includes(row.profile ?? "")) return false;
  await conn.write("/ip/hotspot/user/set", [`=.id=${row[".id"]}`, `=profile=${profileName}`]);
  return true;
}

/*
 * `setHotspotUserRateLimit` used to live here and drove throttling. It is gone deliberately.
 *
 * It wrote `=rate-limit=` onto `/ip hotspot user`, which the hAP lite (smips, 7.23.2) rejects with
 * `unknown parameter` (§13.7) — the same reason `createHotspotUser` puts limits on a profile. So it
 * could not work on the hardware this system runs on, and because the caller only recorded success
 * after the write returned, it re-sent the rejected command on every 5s poll forever.
 *
 * Throttling now swaps the voucher between `wbs-pkg-<id>` and `wbs-pkg-<id>-thr` via
 * `ensureHotspotUserProfileAssigned`. Do not reintroduce a per-user rate-limit write for it.
 */

export async function kickHotspotSession(conn: MikroTikConn, code: string): Promise<void> {
  const result = await conn.write("/ip/hotspot/active/print", [`?user=${code}`]);
  if (!Array.isArray(result) || result.length === 0) return;
  const id: string | undefined = result[0][".id"];
  if (!id) return;
  await conn.write("/ip/hotspot/active/remove", [`=.id=${id}`]);
}

export async function removeHotspotUser(conn: MikroTikConn, code: string): Promise<void> {
  const result = await conn.write("/ip/hotspot/user/print", [`?name=${code}`]);
  if (!Array.isArray(result) || result.length === 0) return;
  const rosId: string | undefined = result[0][".id"];
  if (!rosId) return;
  await conn.write("/ip/hotspot/user/remove", [`=.id=${rosId}`]);
}

export async function getSystemUptimeSeconds(conn: MikroTikConn): Promise<number> {
  const result = await conn.write("/system/resource/print");
  const raw: string = Array.isArray(result) && result[0] ? String(result[0].uptime ?? "") : "";
  if (!raw) return 0;
  let s = 0;
  const w = raw.match(/(\d+)w/);
  if (w) s += parseInt(w[1], 10) * 604800;
  const d = raw.match(/(\d+)d/);
  if (d) s += parseInt(d[1], 10) * 86400;
  const h = raw.match(/(\d+)h/);
  if (h) s += parseInt(h[1], 10) * 3600;
  const m = raw.match(/(\d+)m/);
  if (m) s += parseInt(m[1], 10) * 60;
  const sec = raw.match(/(\d+)s/);
  if (sec) s += parseInt(sec[1], 10);
  return s;
}

export async function getActiveClients(conn: MikroTikConn): Promise<MikroTikActiveClient[]> {
  const result = await conn.write("/ip/hotspot/active/print");
  if (!Array.isArray(result)) return [];
  return result.map((r) => ({
    id: String(r[".id"] ?? ""),
    user: String(r.user ?? ""),
    mac: String(r["mac-address"] ?? ""),
    ip: String(r.address ?? ""),
    uptime: String(r.uptime ?? "0s"),
    idleTime: String(r["idle-time"] ?? "0s"),
    bytesIn: Number(r["bytes-in"] ?? 0),
    bytesOut: Number(r["bytes-out"] ?? 0),
  }));
}
