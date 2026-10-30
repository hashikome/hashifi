/**
 * Readiness checks — "will provisioning actually work on this router, and if not, what do I
 * type to fix it?"
 *
 * The probe answers a narrower question: *can* this board run a hotspot. That leaves the
 * failures that have nothing to do with the board and everything to do with the site, each of
 * which used to surface as a cryptic mid-run error or, worse, as a green run and a phone that
 * cannot get online:
 *
 *   - the router has no internet (usually its bridge MAC is not on the ISP router's whitelist)
 *   - the router cannot reach the backend, which is a hard precondition for `portal-files`
 *     because the *router* fetches the pages over HTTP — the `critical: true` step that fails
 *     last, after everything else has already been written
 *   - the hotspot interface is a bridge port, so the gateway address collides and the portal
 *     silently never intercepts
 *   - FastTrack is on, so authenticated clients bypass the hotspot entirely
 *   - hand-made, untagged hotspot config is already present, which is why a dry run on a
 *     "working" router reports a pile of things to create
 *
 * Every check carries a `fix` the admin can act on. Read-only throughout: prints, plus `/ping`,
 * which is an action but changes no configuration.
 */

import {
  closeConnection,
  connectToRouter,
  type MikroTikConn,
  type RouterCredentials,
} from "../mikrotik.js";
import type { RouterLogger } from "../router-log.js";
import type { HotspotPlan } from "./context.js";
import type { RouterProfile } from "./probe.js";
import { RosClient, type RosRow, WBS_TAG } from "./ros-client.js";

export type ReadinessStatus = "pass" | "warn" | "fail" | "skipped";

export interface ReadinessCheck {
  id: string;
  title: string;
  status: ReadinessStatus;
  /** What we found. */
  detail: string;
  /** What to do about it — only set when there is something to do. */
  fix?: string;
}

export interface ReadinessReport {
  /** False when any check failed — provisioning would not produce a working hotspot. */
  ok: boolean;
  checks: ReadinessCheck[];
  summary: { pass: number; warn: number; fail: number; skipped: number };
}

export interface ReadinessInput {
  profile: RouterProfile;
  /** The resolved plan, or null when `buildHotspotPlan` refused. */
  plan: HotspotPlan | null;
  planError: string | null;
  /** The API's management address as the router sees it, or null when it could not be resolved. */
  managementIp: string | null;
  managementError: string | null;
}

/** A ping that hangs would hang the whole readiness run. */
const PING_TIMEOUT_MS = 15_000;
const PING_COUNT = 2;

function isTagged(row: RosRow): boolean {
  return (
    (row.get("comment") ?? "").startsWith(`${WBS_TAG}:`) ||
    (row.get("name") ?? "").startsWith(`${WBS_TAG}-`)
  );
}

/**
 * `/ping` streams one `!re` per reply and carries running totals on each. Read the totals off
 * the last row where possible, and fall back to counting rows that came back with a time.
 */
export function pingTotals(rows: RosRow[]): { sent: number; received: number } {
  const last = rows[rows.length - 1] ?? null;
  const total = (field: string): number | null => {
    const raw = last?.get(field) ?? null;
    if (raw === null) return null;
    const count = Number(raw);
    return Number.isFinite(count) ? count : null;
  };
  const sent = total("sent");
  return {
    sent: sent !== null && sent > 0 ? sent : rows.length,
    received: total("received") ?? rows.filter((r) => r.get("time") !== null).length,
  };
}

async function ping(
  ros: RosClient,
  address: string,
): Promise<{ sent: number; received: number } | null> {
  const rows = await Promise.race([
    ros.tryExec("/ping", [`=address=${address}`, `=count=${PING_COUNT}`]),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), PING_TIMEOUT_MS)),
  ]);
  return rows === null ? null : pingTotals(rows);
}

// ── Individual checks ───────────────────────────────────────────────────────

function hotspotPackageCheck(profile: RouterProfile): ReadinessCheck {
  if (profile.capabilities.hotspot) {
    return {
      id: "hotspot-package",
      title: "Hotspot subsystem present",
      status: "pass",
      detail: `/ip hotspot is available on RouterOS ${profile.rosVersion.raw}.`,
    };
  }
  return {
    id: "hotspot-package",
    title: "Hotspot subsystem present",
    status: "fail",
    detail: "/ip hotspot does not exist on this board, so no hotspot can be created.",
    // assessCompatibility already writes the precise instructions, including the exact .npk
    // filename or the device-mode command. Don't duplicate that prose here.
    fix: profile.compatibility.reasons[0],
  };
}

async function internetCheck(ros: RosClient): Promise<ReadinessCheck> {
  const base = { id: "internet", title: "Router can reach the internet" };
  const result = await ping(ros, "8.8.8.8");

  if (result === null) {
    return {
      ...base,
      status: "skipped",
      detail: "/ping is unavailable or did not answer in time.",
      fix: "Run /ping 8.8.8.8 count=3 on the router by hand and confirm you get replies.",
    };
  }
  if (result.received === 0) {
    return {
      ...base,
      status: "fail",
      detail: `${result.sent} pings to 8.8.8.8, none returned.`,
      fix:
        "The router has no internet, so paying customers would get nothing. Usually the " +
        "bridgeLocal MAC is not on the ISP router's whitelist (§17.2). Check the default " +
        "route and DNS too: /ip route print, /ip dns print.",
    };
  }
  if (result.received < result.sent) {
    return {
      ...base,
      status: "warn",
      detail: `${result.received}/${result.sent} pings to 8.8.8.8 returned — packet loss.`,
      fix: "Intermittent uplink. Worth resolving before the site goes live.",
    };
  }
  return { ...base, status: "pass", detail: `${result.received}/${result.sent} pings to 8.8.8.8.` };
}

async function backendReachableCheck(
  ros: RosClient,
  backendIp: string | null,
  backendError: string | null,
): Promise<ReadinessCheck> {
  const base = { id: "backend-reachable", title: "Router can reach this backend" };

  if (!backendIp) {
    return {
      ...base,
      status: "fail",
      detail: backendError ?? "The backend's address on the router's network is unknown.",
      fix:
        "Provisioning cannot template the portal pages without this. Put the backend on the " +
        "router's subnet, or set ROUTER_MANAGEMENT_URL explicitly.",
    };
  }

  const result = await ping(ros, backendIp);
  if (result === null) {
    return {
      ...base,
      status: "skipped",
      detail: `/ping is unavailable, so reachability of ${backendIp} was not tested.`,
      fix: `Run /ping ${backendIp} count=3 on the router by hand.`,
    };
  }
  if (result.received === 0) {
    return {
      ...base,
      status: "fail",
      detail: `${result.sent} pings to the backend at ${backendIp}, none returned.`,
      fix:
        `The 'Upload the portal pages' step will fail: the router fetches those pages ` +
        `over HTTP from the backend, so it must be able to reach ${backendIp}. Check the ` +
        `backend machine is running and that its firewall allows the router in.`,
    };
  }
  return {
    ...base,
    status: "pass",
    detail: `${result.received}/${result.sent} pings to the backend at ${backendIp}.`,
  };
}

async function hotspotInterfaceCheck(
  ros: RosClient,
  profile: RouterProfile,
  plan: HotspotPlan | null,
  planError: string | null,
): Promise<ReadinessCheck> {
  const base = { id: "hotspot-interface", title: "Hotspot interface is usable" };

  if (!plan) {
    return {
      ...base,
      status: "fail",
      detail: "No hotspot interface could be settled on.",
      fix: planError ?? "Set the Hotspot Interface field on the router.",
    };
  }

  const ports = await ros.print("/interface/bridge/port", [`?interface=${plan.interface}`]);
  if (ports.length > 0) {
    const bridge = ports[0]?.get("bridge") ?? "a bridge";
    return {
      ...base,
      status: "warn",
      detail: `"${plan.interface}" is currently a port of ${bridge}.`,
      fix:
        `Provisioning removes it automatically (the hotspot puts ${plan.gatewayCidr} directly ` +
        `on that interface, and a bridged interface makes the addressing collide so the portal ` +
        `never intercepts). Nothing to do by hand — just be aware it will change.`,
    };
  }

  if (profile.interfaces.find((i) => i.name === plan.interface)?.disabled) {
    return {
      ...base,
      status: "warn",
      detail: `"${plan.interface}" is currently disabled.`,
      fix: "Provisioning enables it (hotspot-radio-enabled). Nothing to do by hand.",
    };
  }

  return {
    ...base,
    status: "pass",
    detail:
      `Hotspot will run on "${plan.interface}" (${plan.interfaceType})` +
      `${plan.interfaceIsRadio ? ", a radio" : ""}, unbridged, with ${plan.gatewayCidr}.`,
  };
}

async function fastTrackCheck(ros: RosClient): Promise<ReadinessCheck> {
  const base = { id: "fasttrack", title: "FastTrack not bypassing the hotspot" };
  const rows = await ros.tryPrint("/ip/firewall/filter", ["?action=fasttrack-connection"]);

  if (rows === null) {
    return { ...base, status: "skipped", detail: "Could not read /ip/firewall/filter." };
  }

  const active = rows.filter((r) => r.get("disabled") !== "true" && r.get("disabled") !== "yes");
  if (active.length === 0) {
    return { ...base, status: "pass", detail: "No enabled FastTrack rule." };
  }
  return {
    ...base,
    status: "fail",
    detail: `${active.length} enabled FastTrack rule(s) in /ip firewall filter.`,
    fix:
      "FastTracked connections skip the hotspot, so clients get internet without logging in " +
      "and their usage is never counted. Disable the rule: " +
      "/ip firewall filter disable [find action=fasttrack-connection]",
  };
}

/**
 * Hand-made hotspot config the provisioner cannot manage.
 *
 * Steps only ever match their own `wbs:` tag, so untagged objects are neither adopted nor
 * modified — provisioning builds its own alongside them. That is safe but confusing: it is why
 * a dry run against an apparently working router reports a pile of things to create.
 */
async function untaggedConfigCheck(ros: RosClient): Promise<ReadinessCheck> {
  const base = { id: "untagged-config", title: "No conflicting hand-made hotspot config" };

  // RouterOS ships these, so they are not evidence of hand configuration.
  const builtIn = new Set(["default", "default-dhcp", "hs-default"]);
  const menus: [string, string][] = [
    ["/ip/hotspot", "hotspot server"],
    ["/ip/hotspot/profile", "hotspot profile"],
    ["/ip/hotspot/walled-garden/ip", "walled-garden IP entry"],
    ["/ip/hotspot/ip-binding", "IP binding"],
    ["/ip/dhcp-server", "DHCP server"],
  ];

  const found: string[] = [];
  let readable = false;

  for (const [menu, label] of menus) {
    const rows = await ros.tryPrint(menu);
    if (rows === null) continue;
    readable = true;
    for (const row of rows) {
      if (isTagged(row)) continue;
      const name = row.get("name");
      if (name && builtIn.has(name)) continue;
      found.push(
        `${label} "${name ?? row.get("dst-address") ?? row.get("address") ?? row.get(".id")}"`,
      );
    }
  }

  if (!readable) {
    return { ...base, status: "skipped", detail: "Hotspot menus could not be read." };
  }
  if (found.length === 0) {
    return {
      ...base,
      status: "pass",
      detail: "Nothing untagged that provisioning would clash with.",
    };
  }
  return {
    ...base,
    status: "warn",
    detail: `${found.length} object(s) not created by this system: ${found.slice(0, 8).join(", ")}${
      found.length > 8 ? `, and ${found.length - 8} more` : ""
    }.`,
    fix:
      "Provisioning will not touch or adopt these — it creates its own wbs- objects beside " +
      "them, which is why a dry run reports so much to create. Two of them serving the same " +
      "interface will conflict. On a router that was set up by hand, prefer resetting it " +
      "(docs/runbooks/router-onboarding.md Step 1) so provisioning owns the whole configuration.",
  };
}

// ── Runner ──────────────────────────────────────────────────────────────────

export async function checkReadiness(
  ros: RosClient,
  input: ReadinessInput,
): Promise<ReadinessReport> {
  const { profile, plan, planError, managementIp, managementError } = input;

  const checks: ReadinessCheck[] = [hotspotPackageCheck(profile)];

  // Sequential on purpose: these share one API connection, and a MikroTik with 32 MB of RAM
  // is not somewhere to fire concurrent commands for the sake of a second's latency.
  checks.push(await internetCheck(ros));
  checks.push(await backendReachableCheck(ros, managementIp, managementError));

  if (profile.capabilities.hotspot) {
    checks.push(await hotspotInterfaceCheck(ros, profile, plan, planError));
    checks.push(await fastTrackCheck(ros));
    checks.push(await untaggedConfigCheck(ros));
  }

  const count = (s: ReadinessStatus) => checks.filter((c) => c.status === s).length;
  const summary = {
    pass: count("pass"),
    warn: count("warn"),
    fail: count("fail"),
    skipped: count("skipped"),
  };

  return { ok: summary.fail === 0, checks, summary };
}

/**
 * Connect, run the checks, disconnect.
 *
 * `probeRouter` manages its own connection and has already closed it by the time a caller has
 * a profile to hand us, so this opens a second one rather than threading it through.
 */
export async function probeReadiness(
  creds: RouterCredentials,
  logger: RouterLogger,
  input: ReadinessInput,
): Promise<ReadinessReport> {
  let conn: MikroTikConn | null = null;
  try {
    conn = await logger.connect(creds.host, () => connectToRouter(creds));
    return await checkReadiness(new RosClient(conn, logger, creds.host), input);
  } finally {
    if (conn) await closeConnection(conn);
  }
}
