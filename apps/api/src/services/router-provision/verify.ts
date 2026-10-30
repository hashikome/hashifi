/**
 * Post-provision proof — "is this hotspot actually serving customers?"
 *
 * Onboarding used to hand you a five-item checklist to work through with a phone, under the
 * heading "do not trust the green ticks alone". That suspicion was right: every provisioning step
 * verifies its own write, so a green run only proves the configuration reads back as asked — not
 * that a device can associate, get an address, and be let online.
 *
 * Most of that checklist is machine-checkable, and this checks it. What is left needs a real
 * radio and a real browser, so it is returned as `manual` rather than quietly omitted.
 *
 * The important one is the **voucher round-trip**: creating a hotspot user, reading it back and
 * removing it exercises the exact path every sale depends on, including the per-board parameter
 * differences `dialect.ts` exists to absorb. It is the only check here that writes, it is
 * short-lived and harmless (a 1-second uptime limit and a random password), and if the cleanup
 * ever fails it says so loudly with the name to remove by hand.
 */

import { randomBytes } from "node:crypto";
import {
  closeConnection,
  connectToRouter,
  type MikroTikConn,
  type RouterCredentials,
} from "../mikrotik.js";
import { RouterUnsupportedError } from "../mikrotik-errors.js";
import type { RouterLogger } from "../router-log.js";
import type { BackendEndpoints, HotspotPlan } from "./context.js";
import type { Dialect } from "./dialect.js";
import { hotspotUserParams } from "./dialect.js";
import { PORTAL_FILES, renderPortalFile, routerPathFor } from "./portal-files.js";
import type { RouterCapabilities } from "./probe.js";
// Same check/report shape as readiness.ts on purpose: one frontend component renders both.
import type { ReadinessCheck, ReadinessStatus } from "./readiness.js";
import { RosClient, rowId } from "./ros-client.js";

export interface VerifyReport {
  /** False when something proves the hotspot is not serving. */
  ok: boolean;
  checks: ReadinessCheck[];
  /** What a machine cannot prove — still needs a phone. */
  manual: string[];
  /**
   * Capabilities the write test proved wrong, for the caller to persist. `deriveCapabilities`
   * can only guess these from the RouterOS version; this is the board actually answering.
   */
  discovered: Partial<RouterCapabilities> | null;
  summary: { pass: number; warn: number; fail: number; skipped: number };
}

export interface VerifyInput {
  routerId: string;
  dialect: Dialect;
  plan: HotspotPlan;
  endpoints: BackendEndpoints;
  /** Create-and-remove a throwaway hotspot user. On by default. */
  includeWriteTest?: boolean;
}

const yes = (v: string | null) => v === "true" || v === "yes";

const MANUAL_CHECKS = [
  "Connect a phone to the SSID and confirm it gets an address in the hotspot range.",
  "Confirm the captive portal appears and shows your branded page.",
  "Redeem a real voucher and confirm alogin.html reaches “You’re connected” — it runs a live internet reachability check (§18).",
  "Confirm the countdown and data-remaining display tick down.",
];

// ── Checks ──────────────────────────────────────────────────────────────────

async function hotspotServerCheck(ros: RosClient, plan: HotspotPlan): Promise<ReadinessCheck> {
  const base = { id: "hotspot-server-running", title: "Hotspot server is running" };
  const row = await ros.findByName("/ip/hotspot", plan.serverName);

  if (!row) {
    return {
      ...base,
      status: "fail",
      detail: `No hotspot server named "${plan.serverName}" exists.`,
      fix: "Run Set up again — the hotspot-server step did not take effect.",
    };
  }
  if (yes(row.get("disabled"))) {
    return {
      ...base,
      status: "fail",
      detail: `"${plan.serverName}" exists but is disabled.`,
      fix: `/ip hotspot enable [find name=${plan.serverName}]`,
    };
  }
  // RouterOS flags a server whose profile, pool or interface does not resolve. It looks
  // configured and serves nobody.
  if (yes(row.get("invalid"))) {
    return {
      ...base,
      status: "fail",
      detail: `"${plan.serverName}" is marked invalid by RouterOS — its profile, pool or interface does not resolve.`,
      fix: "Check /ip hotspot print detail for the reason, then run Set up again.",
    };
  }
  return {
    ...base,
    status: "pass",
    detail: `"${plan.serverName}" is enabled on ${row.get("interface") ?? plan.interface}.`,
  };
}

/**
 * `invalid=yes` on a DHCP server is NOT on its own proof that clients get no address.
 *
 * On `/interface wireless` in AP mode, the interface's `running` property tracks *associated
 * clients*, not whether the radio is transmitting — an idle AP that is beaconing perfectly well
 * reports `running=false`. RouterOS's DHCP server consults that same property and marks itself
 * `invalid` with `.about="Interface not running"`. So a freshly provisioned hotspot that nobody
 * has connected to yet always looks broken, and the moment a phone associates it validates
 * itself. Measured on an hAP lite (7.23.2): `/interface wireless monitor` said `status=running-ap,
 * channel=2412/20/gn(18dBm)` while the interface row said `running=false` and this check said the
 * hotspot would not serve. A phone then associated, got a lease and loaded the portal.
 *
 * This is the same trap that produced a false positive in `radioBroadcastingCheck` — which is why
 * that one asserts `mode`, not `running`. Here the reason must come from RouterOS itself
 * (`.about`) plus the radio's real state, because the flag alone cannot tell "broken" from "idle".
 *
 * `hotspot-radio-running-check` in `steps.ts` sets `disable-running-check=yes` so the flag stops
 * lying in the first place; this branch stays for boards provisioned before that step existed.
 */
async function dhcpServerCheck(
  ros: RosClient,
  dialect: Dialect,
  plan: HotspotPlan,
): Promise<ReadinessCheck> {
  const base = { id: "dhcp-server-running", title: "Clients can be given an address" };
  const row = await ros.findByName("/ip/dhcp-server", "wbs-hs-dhcp");

  if (!row) {
    return {
      ...base,
      status: "fail",
      detail: "The hotspot DHCP server is missing.",
      fix: "Run Set up again — the dhcp-server step did not take effect.",
    };
  }
  if (yes(row.get("disabled"))) {
    return {
      ...base,
      status: "fail",
      detail: "The hotspot DHCP server is disabled.",
      fix: "Without it a phone associates to the SSID and never gets an address. Run Set up again.",
    };
  }
  if (yes(row.get("invalid"))) {
    const about = row.get(".about") ?? "";
    const idleRadio =
      /not running/i.test(about) &&
      plan.interfaceIsRadio &&
      (await radioIsOnAir(ros, dialect, plan));

    if (idleRadio) {
      return {
        ...base,
        status: "warn",
        detail:
          `RouterOS marks the DHCP server invalid ("${about}"), but the radio is on the air and ` +
          `simply has no clients yet.`,
        fix:
          `On a wireless AP the interface reports running=false until a device associates, and the ` +
          `DHCP server copies that flag. It validates itself as soon as a phone connects — confirm ` +
          `by connecting one. Run Set up to apply disable-running-check=yes and stop the flag lying.`,
      };
    }
    return {
      ...base,
      status: "fail",
      detail: `The hotspot DHCP server is marked invalid${about ? ` ("${about}")` : ""}.`,
      fix: "Without it a phone associates to the SSID and never gets an address. Run Set up again.",
    };
  }
  return { ...base, status: "pass", detail: "Hotspot DHCP server is enabled and valid." };
}

/**
 * Is the radio actually transmitting? `monitor` reports the true state (`running-ap` on a legacy
 * AP), unlike the interface row's `running`. Any failure here answers "cannot tell", so a monitor
 * that is unavailable never converts a real DHCP problem into a warning.
 */
async function radioIsOnAir(ros: RosClient, dialect: Dialect, plan: HotspotPlan): Promise<boolean> {
  if (!dialect.radio) return false;
  const rows = await ros.tryExec(`${dialect.radio.menu}/monitor`, [
    `=numbers=${plan.interface}`,
    "=once=",
  ]);
  return rows?.some((r) => /running/i.test(r.get("status") ?? "")) ?? false;
}

async function radioBroadcastingCheck(
  ros: RosClient,
  dialect: Dialect,
  plan: HotspotPlan,
): Promise<ReadinessCheck> {
  const base = { id: "radio-broadcasting", title: "SSID is on the air" };

  if (!plan.interfaceIsRadio || !dialect.radio) {
    return {
      ...base,
      status: "skipped",
      detail: `The hotspot runs on "${plan.interface}", which is not a radio — clients arrive over the wire or via a separate AP.`,
    };
  }

  const row = await ros.findByName(dialect.radio.menu, plan.interface);
  if (!row) {
    return {
      ...base,
      status: "skipped",
      detail: `"${plan.interface}" not listed in ${dialect.radio.menu}.`,
    };
  }
  if (yes(row.get("disabled"))) {
    return {
      ...base,
      status: "fail",
      detail: `"${plan.interface}" is disabled, so no device can see the network.`,
      fix: "Run Set up again — the hotspot-radio-enabled step did not take effect.",
    };
  }

  // Deliberately NOT checking `running`. On a MikroTik AP that flag tracks whether a client is
  // currently associated, not whether the radio is transmitting — an idle hotspot with nobody
  // connected reports running=false, which is normal. Verified on an hAP lite in ap-bridge mode
  // with 0 clients. Treating it as a fault would warn on every quiet router.
  const ssid = row.get(dialect.radio.ssidField) ?? row.get("ssid");
  const mode = row.get(dialect.radio.modeField) ?? row.get("mode");
  const associated = await ros.tryPrint(`${dialect.radio.menu}/registration-table`);

  const wrongMode = mode !== null && mode !== dialect.radio.modeValue;
  if (wrongMode) {
    return {
      ...base,
      status: "fail",
      detail: `"${plan.interface}" is in "${mode}" mode, not "${dialect.radio.modeValue}".`,
      fix: "A radio that is not an access point cannot accept clients. Run Set up again.",
    };
  }

  return {
    ...base,
    status: "pass",
    detail:
      `"${plan.interface}" is enabled in ${mode ?? dialect.radio.modeValue} mode` +
      `${ssid ? `, broadcasting "${ssid}"` : ""}` +
      `${associated ? `, ${associated.length} device(s) associated` : ""}.`,
  };
}

async function loginModeCheck(ros: RosClient, plan: HotspotPlan): Promise<ReadinessCheck> {
  const base = { id: "login-mode", title: "Login method is HTTP-PAP" };
  const row = await ros.findByName("/ip/hotspot/profile", plan.profileName);

  if (!row) {
    return { ...base, status: "fail", detail: `Hotspot profile "${plan.profileName}" is missing.` };
  }
  const loginBy = row.get("login-by") ?? "";
  if (!loginBy.includes("http-pap") || !loginBy.includes("mac-cookie")) {
    return {
      ...base,
      status: "fail",
      detail: `login-by is "${loginBy}", not http-pap and mac-cookie.`,
      fix:
        "Without http-pap every login fails with 'password is not chap encrypted' (§11, §2.2); " +
        "without mac-cookie a device cannot come back without its code. Run Set up again.",
    };
  }
  return { ...base, status: "pass", detail: `login-by is "${loginBy}".` };
}

async function portalFilesCheck(
  ros: RosClient,
  portalOrigin: string,
  routerId: string,
): Promise<ReadinessCheck> {
  const base = { id: "portal-files", title: "Portal pages are on the router, complete" };
  const wrong: string[] = [];

  for (const name of PORTAL_FILES) {
    const path = routerPathFor(name);
    const [row] = await ros.print("/file", [`?name=${path}`]);
    if (!row) {
      wrong.push(`${name} is missing`);
      continue;
    }
    const expected = Buffer.byteLength(
      await renderPortalFile(name, portalOrigin, routerId),
      "utf8",
    );
    const actual = Number(row.get("size") ?? 0);
    if (actual !== expected) wrong.push(`${name} is ${actual} bytes, expected ${expected}`);
  }

  if (wrong.length > 0) {
    return {
      ...base,
      status: "fail",
      detail: `${wrong.join("; ")}.`,
      fix:
        "Usually an older copy of the page left over from a previous install — customers would " +
        "see the stale portal. It can also mean truncation in transit, which is what RouterOS's " +
        "/file add contents= does to multi-byte UTF-8 (provisioning uses /tool fetch to avoid " +
        "that). Either way: run Set up again with the backend reachable from the router.",
    };
  }
  return {
    ...base,
    status: "pass",
    detail: `${PORTAL_FILES.length} pages present at the expected byte length.`,
  };
}

async function walledGardenCheck(
  ros: RosClient,
  portal: BackendEndpoints["portal"],
): Promise<ReadinessCheck> {
  const base = { id: "walled-garden", title: "Portal reachable before login" };
  const field = portal.hostIsIp ? "dst-address" : "dst-host";
  const rows = await ros.print("/ip/hotspot/walled-garden/ip", [`?${field}=${portal.host}`]);
  // RouterOS marks a host-name entry invalid when the name does not resolve.
  const accepting = rows.filter(
    (r) => r.get("action") === "accept" && !yes(r.get("disabled")) && !yes(r.get("invalid")),
  );

  if (accepting.length === 0) {
    return {
      ...base,
      status: "fail",
      detail: `Nothing lets an unauthenticated client reach ${portal.host}.`,
      fix:
        "The portal page itself is served from the backend, so without this the captive " +
        "portal never loads (§4). Run Set up again.",
    };
  }
  return { ...base, status: "pass", detail: `${portal.host} is allowed before login.` };
}

/** Informational: nobody has connected yet on a fresh install, and that is not a fault. */
async function activityCheck(ros: RosClient): Promise<ReadinessCheck> {
  const base = { id: "activity", title: "Client activity" };
  const leases = await ros.tryPrint("/ip/dhcp-server/lease");
  const active = await ros.tryPrint("/ip/hotspot/active");

  if (leases === null && active === null) {
    return { ...base, status: "skipped", detail: "Could not read leases or active users." };
  }
  const leaseCount = leases?.length ?? 0;
  const activeCount = active?.length ?? 0;

  if (leaseCount === 0 && activeCount === 0) {
    return {
      ...base,
      status: "warn",
      detail: "No DHCP leases and no logged-in users yet.",
      fix: "Expected on a router nobody has connected to. Connect a phone to confirm end to end.",
    };
  }
  return {
    ...base,
    status: "pass",
    detail: `${leaseCount} DHCP lease(s), ${activeCount} logged-in user(s).`,
  };
}

/** Params a board may reject, in the same order `createHotspotUser` drops them. */
const OPTIONAL_USER_PARAMS = ["=rate-limit=", "=shared-users="];

/**
 * The one that proves sales will work: create a hotspot user, read it back, remove it.
 *
 * `hotspotUserParams` is used rather than a bare add, so the per-board parameter differences are
 * exercised exactly as a real voucher exercises them — and it mirrors `createHotspotUser`'s
 * fallback, retrying without the optional params when the board rejects them. Without that
 * mirroring this check would report a failure on a router where sales actually succeed.
 *
 * When the fallback fires, the board has just told us something the read-only probe cannot know:
 * `deriveCapabilities` guesses user-level `rate-limit`/`shared-users` purely from the RouterOS
 * major version, and that guess is wrong on at least one real board (an hAP lite on 7.23.2
 * rejects `rate-limit` outright). The discovered truth is returned so the caller can correct the
 * cached capabilities — otherwise every voucher sold on that router pays for a failed round-trip
 * first.
 */
async function voucherRoundTripCheck(
  ros: RosClient,
  dialect: Dialect,
): Promise<{ check: ReadinessCheck; discovered: Partial<RouterCapabilities> | null }> {
  const base = { id: "voucher-round-trip", title: "A voucher can be created and read back" };
  const code = `wbs-selftest-${randomBytes(4).toString("hex")}`;
  const params = hotspotUserParams(dialect, {
    code,
    deviceLimit: 1,
    downloadSpeedMbps: 1,
    uploadSpeedMbps: 1,
    limitBytesTotal: null,
    // Useless to anyone even in the instant it exists.
    limitUptime: "00:00:01",
  });

  let rejected: string[] = [];
  let discovered: Partial<RouterCapabilities> | null = null;
  let created = false;

  /**
   * The profile the throwaway voucher rides when the board will not take limits on the user.
   *
   * This is the part that was missing. Every check here verified *configuration* — that a command
   * was accepted and read back — and none verified *enforcement*. So a run reported `ok: true` on a
   * router where `createHotspotUser` never sent `=profile=`, every voucher sat on `default`, and
   * customers got uncapped speed. Reading a command back is not the same as a limit being in force.
   *
   * Creating our own profile rather than inspecting a real package's keeps the check self-contained
   * and removable, while still exercising the whole mechanism: create profile → assign it to a user
   * → read the user back → confirm the profile it points at actually carries a cap.
   */
  const testProfile = `wbs-selftest-p-${randomBytes(3).toString("hex")}`;
  let profileCreated = false;

  const ensureTestProfile = async (): Promise<void> => {
    if (profileCreated) return;
    await ros.add("/ip/hotspot/user/profile", [
      `=name=${testProfile}`,
      "=rate-limit=1M/1M",
      "=shared-users=1",
    ]);
    profileCreated = true;
  };

  /**
   * What we are actually about to send — NOT what the board turns out to accept.
   *
   * Once the capabilities are latched to false, `hotspotUserParams` stops emitting these, so the
   * add succeeds first try and `rejected` stays empty. Reporting "pass" from that alone told the
   * admin the throwaway voucher carried "speed and device limits" when the command demonstrably
   * had neither — a false reassurance, and worse than the false alarm it replaced, because the
   * first run's amber warning was the only place the shared-limit consequence was ever stated.
   */
  const optionalSent = params.filter((p) => OPTIONAL_USER_PARAMS.some((x) => p.startsWith(x)));

  try {
    // Already known to need the profile route (capabilities latched false on an earlier run).
    if (optionalSent.length === 0) {
      await ensureTestProfile();
      params.push(`=profile=${testProfile}`);
    }

    try {
      await ros.add("/ip/hotspot/user", params);
    } catch (err) {
      const optional = params.filter((p) => OPTIONAL_USER_PARAMS.some((x) => p.startsWith(x)));
      if (!(err instanceof RouterUnsupportedError) || optional.length === 0) throw err;

      rejected = optional.map((p) => p.split("=")[1] ?? p);
      discovered = {
        ...(rejected.includes("rate-limit") ? { userRateLimit: false } : {}),
        ...(rejected.includes("shared-users") ? { userSharedUsers: false } : {}),
      };
      // Learned it only now — so put the cap on a profile before retrying, exactly as
      // `router-sync.ts` does for a real voucher.
      await ensureTestProfile();
      await ros.add("/ip/hotspot/user", [
        ...params.filter((p) => !OPTIONAL_USER_PARAMS.some((x) => p.startsWith(x))),
        `=profile=${testProfile}`,
      ]);
    }
    created = true;

    const readBack = await ros.findByName("/ip/hotspot/user", code);
    if (!readBack) {
      return {
        discovered,
        check: {
          ...base,
          status: "fail",
          detail: "The user was accepted but reading it back found nothing.",
          fix:
            "`add` returning without error is not proof the user exists. Vouchers sold on this " +
            "router would take payment and never grant access. Check /ip hotspot user print.",
        },
      };
    }

    /*
     * Is a speed cap actually IN FORCE on that user? Two ways it can be, and it must be one of
     * them — otherwise the voucher works and the customer gets the whole uplink.
     */
    const userRateLimit = readBack.get("rate-limit")?.trim() || null;
    const onProfile = readBack.get("profile")?.trim() || null;
    const profileRow = onProfile
      ? await ros.findByName("/ip/hotspot/user/profile", onProfile)
      : null;
    const profileRateLimit = profileRow?.get("rate-limit")?.trim() || null;
    const capInForce = userRateLimit ?? profileRateLimit;

    // Clean up before reporting, so a failure verdict does not also leave litter behind.
    await ros.remove("/ip/hotspot/user", rowId(readBack));
    created = false;
    const leftBehind = (await ros.findByName("/ip/hotspot/user", code)) !== null;

    if (leftBehind) {
      return {
        discovered,
        check: {
          ...base,
          status: "warn",
          detail: `Created and read back, but the test user "${code}" could not be removed.`,
          fix: `Remove it by hand: /ip hotspot user remove [find name=${code}]`,
        },
      };
    }

    /*
     * The check this whole function existed without.
     *
     * A voucher with no cap from either mechanism is not a warning — it is the router handing a
     * paying customer unlimited bandwidth, and it reported `ok: true` for a whole day.
     */
    if (!capInForce) {
      return {
        discovered,
        check: {
          ...base,
          status: "fail",
          detail:
            `The voucher was created and read back, but it has NO speed limit — neither on the ` +
            `user nor on its profile ("${onProfile ?? "default"}").`,
          fix:
            `Every voucher sold on this router would get the full uplink. This board does not ` +
            `accept rate-limit on a hotspot user, so the cap has to ride a per-package user ` +
            `profile — check that router-sync is sending =profile= and that ` +
            `/ip hotspot user profile print shows a wbs-pkg-* entry with a rate-limit.`,
        },
      };
    }

    if (rejected.length > 0) {
      return {
        discovered,
        check: {
          ...base,
          status: "warn",
          detail:
            `Vouchers work and are capped at ${capInForce} via the profile, but this board ` +
            `rejects ${rejected.join(" and ")} on a hotspot user.`,
          fix:
            `Limits ride a per-package user profile instead (§13.7), so every voucher on one ` +
            `package shares its cap. The cached capabilities have been corrected, so future ` +
            `vouchers skip the rejected attempt.`,
        },
      };
    }

    if (optionalSent.length === 0) {
      return {
        discovered,
        check: {
          ...base,
          status: "warn",
          detail:
            `Vouchers work and are capped at ${capInForce} via the profile ` +
            `"${onProfile}", not on the voucher itself.`,
          fix:
            `Expected on this board — it takes no per-user rate-limit, so the cap lives on a ` +
            `per-package profile (§13.7) and is shared by every voucher on that package. ` +
            `Nothing to fix.`,
        },
      };
    }

    return {
      discovered,
      check: {
        ...base,
        status: "pass",
        detail: `Created a throwaway voucher capped at ${capInForce} on the user itself, read it back, removed it.`,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      discovered,
      check: {
        ...base,
        status: "fail",
        detail: `Voucher creation failed: ${message}`,
        fix: created
          ? `Every sale on this router would fail. A test user "${code}" may be left behind — ` +
            `remove it with /ip hotspot user remove [find name=${code}]`
          : "Every sale on this router would fail the moment a customer pays.",
      },
    };
  } finally {
    /*
     * Remove the throwaway profile on every path, including the failure ones above.
     *
     * It has to go after the user, since RouterOS refuses to remove a profile a user still points
     * at. Best-effort: a leftover `wbs-selftest-p-*` is cosmetic, and letting a cleanup error mask
     * the real verdict would be much worse — that verdict is the whole point of the check.
     */
    if (profileCreated) {
      const row = await ros.findByName("/ip/hotspot/user/profile", testProfile);
      if (row) {
        try {
          await ros.remove("/ip/hotspot/user/profile", rowId(row));
        } catch {
          /* leave it; the verdict matters more */
        }
      }
    }
  }
}

// ── Runner ──────────────────────────────────────────────────────────────────

export async function verifyRouter(ros: RosClient, input: VerifyInput): Promise<VerifyReport> {
  const { routerId, dialect, plan, endpoints, includeWriteTest = true } = input;

  const checks: ReadinessCheck[] = [];

  // Sequential — one API connection, and a 32 MB board is no place for concurrency.
  checks.push(await hotspotServerCheck(ros, plan));
  checks.push(await dhcpServerCheck(ros, dialect, plan));
  checks.push(await radioBroadcastingCheck(ros, dialect, plan));
  checks.push(await loginModeCheck(ros, plan));
  checks.push(await portalFilesCheck(ros, endpoints.portal.origin, routerId));
  checks.push(await walledGardenCheck(ros, endpoints.portal));
  checks.push(await activityCheck(ros));

  let discovered: Partial<RouterCapabilities> | null = null;

  if (includeWriteTest) {
    const result = await voucherRoundTripCheck(ros, dialect);
    checks.push(result.check);
    discovered = result.discovered;
  } else {
    checks.push({
      id: "voucher-round-trip",
      title: "A voucher can be created and read back",
      status: "skipped",
      detail: "Skipped — this is the only check that writes to the router.",
      fix: "Run it to prove that selling a voucher on this router actually grants access.",
    });
  }

  const count = (s: ReadinessStatus) => checks.filter((c) => c.status === s).length;
  const summary = {
    pass: count("pass"),
    warn: count("warn"),
    fail: count("fail"),
    skipped: count("skipped"),
  };

  return { ok: summary.fail === 0, checks, manual: MANUAL_CHECKS, discovered, summary };
}

/** Connect, verify, disconnect — for callers that don't already hold a `RosClient`. */
export async function probeVerify(
  creds: RouterCredentials,
  logger: RouterLogger,
  input: VerifyInput,
): Promise<VerifyReport> {
  let conn: MikroTikConn | null = null;
  try {
    conn = await logger.connect(creds.host, () => connectToRouter(creds));
    return await verifyRouter(new RosClient(conn, logger, creds.host), input);
  } finally {
    if (conn) await closeConnection(conn);
  }
}
