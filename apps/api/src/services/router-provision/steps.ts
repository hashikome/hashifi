/**
 * Provisioning expressed as data: an ordered list of idempotent steps.
 *
 * Every step answers two questions independently — "is this already correct?" (`check`)
 * and "make it correct" (`apply`). The orchestrator re-runs `check` after `apply` as the
 * verification pass, so a step that lies about success fails the run.
 *
 * Idempotency contract: every object we create is tagged `comment="wbs:<step-id>"`, or
 * carries a `wbs-` name for menus without comments. We only ever match our own tag, so
 * rules a human added by hand are never modified or duplicated — the failure mode the
 * MikroTik guide warns about in §4, §5 and §12.
 */

import { RouterError, RouterUnsupportedError } from "../mikrotik-errors.js";
import type { ProvisionContext } from "./context.js";
import type { RadioDialect } from "./dialect.js";
import { PORTAL_FILES, renderPortalFile, routerPathFor } from "./portal-files.js";
import { type RosClient, type RosRow, rowId, tagFor } from "./ros-client.js";

/** The board's radio dialect. Radio steps apply only to boards that have one. */
function radioOf(ctx: ProvisionContext): RadioDialect {
  const radio = ctx.dialect.radio;
  if (!radio) throw new Error("This board has no radio; radio steps do not apply");
  return radio;
}

/** The radio's running-check property. The running-check step applies only where it exists. */
function runningCheckFieldOf(ctx: ProvisionContext): string {
  const field = radioOf(ctx).runningCheckField;
  if (field === null) throw new Error("This radio has no running-check property");
  return field;
}

export interface StepScope {
  ros: RosClient;
  ctx: ProvisionContext;
}

export interface ProvisionStep {
  id: string;
  title: string;
  /** A failed critical step aborts the run; non-critical steps are recorded and skipped. */
  critical: boolean;
  appliesTo(ctx: ProvisionContext): boolean;
  /** true = already in the desired state, nothing to do */
  check(scope: StepScope): Promise<boolean>;
  apply(scope: StepScope): Promise<void>;
}

const yes = (v: string | null) => v === "true" || v === "yes";

/** Ensure a comment-tagged rule exists in a list menu, creating it if missing. */
async function ensureTaggedRule(
  ros: RosClient,
  menu: string,
  stepId: string,
  params: string[],
): Promise<void> {
  const existing = await ros.findByTag(menu, stepId);
  const withTag = [...params, `=comment=${tagFor(stepId)}`];
  if (existing?.get(".id")) {
    await ros.set(menu, rowId(existing), params);
    return;
  }
  await ros.add(menu, withTag);
}

/**
 * Add a firewall rule at the **top** of its list, which is where it has to be to matter: the
 * hotspot's own rules reject unauthenticated traffic, so a permit placed after them never runs.
 *
 * `=place-before=0` is what this used to send, and it aborted a whole Set up on a freshly reset
 * board with `no such item`. Measured on an hAP lite: `place-before` needs an item that exists —
 * an `.id` works and lands the rule at position 0, an index past the end is rejected. On a clean
 * board this step runs moments after the hotspot server is created, before RouterOS has populated
 * its dynamic rules, so there is no rule at index 0 to place before and the add fails. The same
 * command succeeds on a second run, which is exactly how it passed the first clean-board test and
 * still broke the second.
 *
 * So: resolve the current first rule's real `.id`, and when the list is genuinely empty just add.
 * A rule that is first in an empty list is first either way — being unable to name a predecessor
 * is not a reason to fail a critical step.
 */
export async function addRuleFirst(
  ros: RosClient,
  menu: string,
  stepId: string,
  params: string[],
): Promise<void> {
  const tagged = [...params, `=comment=${tagFor(stepId)}`];
  const [first] = await ros.print(menu);

  if (first?.get(".id")) {
    await ros.add(menu, [...tagged, `=place-before=${first.get(".id")}`]);
    return;
  }

  /*
   * Empty list: add, then move to the top on the next pass.
   *
   * Appending is not enough on its own. On a clean board this runs before RouterOS has
   * materialised the hotspot's dynamic rules, so the list is briefly empty — and the dynamic
   * `forward jump` rules it adds a moment later land ABOVE our static accept, leaving it dead last
   * where the hotspot's own reject can pre-empt it. Measured: our rule ended at index 15 of 16.
   *
   * `ruleAheadOfHotspotRules` below is what puts it right: the step's `check` fails while the rule is not
   * first, so the next apply moves it, and phase 5's re-check proves it stuck.
   */
  await ros.add(menu, tagged);
}

/**
 * Will our tagged rule be evaluated ahead of the hotspot's dynamic rules?
 *
 * Position is part of "already correct" for these rules, not just existence: an accept below the
 * hotspot's own reject never runs, and nothing else in the system would notice.
 *
 * Boards differ in how that is achieved:
 *
 * - On an hAP lite a static rule moved above the dynamic ones stayed there (index 15 to 0).
 * - On RouterOS 7.25 (CHR, router sim, 2026-10-29) a running hotspot keeps its dynamic rules first
 *   whatever static rules do. It inserts them directly above its disabled placeholder rule,
 *   "place hotspot rules here", each time it starts: a rule above the placeholder is evaluated
 *   first from the hotspot's next start, and a move above the dynamic rules is ignored.
 *
 * So the rule is ahead when it is above the first dynamic rule, or above the placeholder. Until the
 * hotspot next starts the walled garden still lets clients reach the backend, because its return
 * precedes the reject. Both firewall steps need this, which is why the criterion is a position
 * relative to the hotspot's rules and never "first in the list": two rules demanding index 0 would
 * shove each other on every run and the re-check could never come back clean.
 */
const HOTSPOT_PLACEHOLDER = "place hotspot rules here";

function dynamicIndex(rows: RosRow[]): number {
  const i = rows.findIndex((r) => yes(r.get("dynamic")));
  return i === -1 ? rows.length : i;
}

export async function ruleAheadOfHotspotRules(
  ros: RosClient,
  menu: string,
  stepId: string,
): Promise<boolean> {
  const rows = await ros.print(menu);
  const mine = rows.findIndex((r) => r.get("comment") === tagFor(stepId));
  if (mine === -1) return false;
  const placeholder = rows.findIndex((r) => r.get("comment") === HOTSPOT_PLACEHOLDER);
  return mine < dynamicIndex(rows) || (placeholder !== -1 && mine < placeholder);
}

/**
 * A freshly started hotspot adds its dynamic rules and placeholder a moment after the server is
 * created, and above any rule placed before them (CHR 7.25, router sim). Placing our rule first
 * left it below the placeholder and failed the read-back. Returns the menu once the hotspot's
 * rules exist, or as it stands when they never appear within `waitMs`.
 */
const HOTSPOT_RULES_WAIT_MS = 10_000;

async function hotspotRulesPresent(
  ros: RosClient,
  menu: string,
  waitMs: number,
): Promise<RosRow[]> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const rows = await ros.print(menu);
    const present = rows.some(
      (r) => yes(r.get("dynamic")) || r.get("comment") === HOTSPOT_PLACEHOLDER,
    );
    if (present || Date.now() >= deadline) return rows;
    await new Promise((done) => setTimeout(done, 250));
  }
}

/** Move our tagged rule above the hotspot's placeholder, or above the dynamic rules without one. */
export async function moveRuleAheadOfHotspotRules(
  ros: RosClient,
  menu: string,
  stepId: string,
  waitMs = HOTSPOT_RULES_WAIT_MS,
): Promise<void> {
  const rows = await hotspotRulesPresent(ros, menu, waitMs);
  if (await ruleAheadOfHotspotRules(ros, menu, stepId)) return;
  const mine = rows.find((r) => r.get("comment") === tagFor(stepId));
  const target =
    rows.find((r) => r.get("comment") === HOTSPOT_PLACEHOLDER) ?? rows[dynamicIndex(rows)];
  if (!mine || !target?.get(".id")) return;
  await ros.exec(`${menu}/move`, [`=numbers=${rowId(mine)}`, `=destination=${rowId(target)}`]);
}

/** Compare a row's fields against what we want; missing/differing → needs apply. */
function matches(row: RosRow | null, expected: Record<string, string>): boolean {
  if (!row) return false;
  return Object.entries(expected).every(([key, value]) => row.get(key) === value);
}

// ── Steps ───────────────────────────────────────────────────────────────────

const identity: ProvisionStep = {
  id: "identity",
  title: "Set router identity",
  critical: false,
  appliesTo: () => true,
  async check({ ros, ctx }) {
    const [row] = await ros.print("/system/identity");
    return row?.get("name") === ctx.router.name;
  },
  async apply({ ros, ctx }) {
    await ros.setSingleton("/system/identity", [`=name=${ctx.router.name}`]);
  },
};

const dns: ProvisionStep = {
  id: "dns",
  title: "Configure DNS servers (§16.2)",
  critical: true,
  appliesTo: () => true,
  async check({ ros, ctx }) {
    const [row] = await ros.print("/ip/dns");
    return row?.get("servers") === ctx.hotspot.dnsServers && yes(row?.get("allow-remote-requests"));
  },
  async apply({ ros, ctx }) {
    await ros.setSingleton("/ip/dns", [
      `=servers=${ctx.hotspot.dnsServers}`,
      "=allow-remote-requests=yes",
    ]);
  },
};

/**
 * The one step that removes configuration it did not create.
 *
 * The idempotency contract elsewhere is "only ever match our own `wbs:` tag", so a rule a
 * human added by hand is never touched. This step breaks that rule deliberately and narrowly:
 * it removes a bridge port, and only ever the one for the interface the admin explicitly
 * designated as the hotspot interface.
 *
 * It has to. The hotspot puts its gateway address directly on that interface; if the
 * interface is also a bridge port the addressing collides and the hotspot silently never
 * intercepts — the single most common way this system is misconfigured, and one that produces
 * no error anywhere. Leaving it alone would mean every other step reporting success on a
 * router no customer can use.
 */
const hotspotInterfaceUnbridged: ProvisionStep = {
  id: "hotspot-interface-unbridged",
  title: "Remove the hotspot interface from any bridge (§17.1)",
  critical: true,
  appliesTo: (ctx) => ctx.profile.capabilities.hotspot,
  async check({ ros, ctx }) {
    const ports = await ros.print("/interface/bridge/port", [
      `?interface=${ctx.hotspot.interface}`,
    ]);
    return ports.length === 0;
  },
  async apply({ ros, ctx }) {
    const ports = await ros.print("/interface/bridge/port", [
      `?interface=${ctx.hotspot.interface}`,
    ]);
    for (const port of ports) {
      if (!port.get(".id")) continue;
      ros.logger.warn(
        `Removing "${ctx.hotspot.interface}" from bridge "${port.get("bridge") ?? "?"}" — the ` +
          `hotspot assigns ${ctx.hotspot.gatewayCidr} directly to it, and a bridged ` +
          `interface makes that addressing collide.`,
      );
      await ros.remove("/interface/bridge/port", rowId(port));
    }
  },
};

/**
 * Enable the radio. Critical, because a disabled radio means no client can associate — and
 * nothing else in the run would notice.
 *
 * Only `disabled` is asserted here. It is the one property both stacks report identically,
 * so the post-apply `check` is a real verification rather than a guess. The SSID is a separate,
 * non-critical step for exactly that reason.
 */
const hotspotRadioEnabled: ProvisionStep = {
  id: "hotspot-radio-enabled",
  title: "Enable the hotspot radio",
  critical: true,
  appliesTo: (ctx) =>
    ctx.profile.capabilities.hotspot && ctx.hotspot.interfaceIsRadio && ctx.dialect.radio !== null,
  async check({ ros, ctx }) {
    const menu = radioOf(ctx).menu;
    const row = await ros.findByName(menu, ctx.hotspot.interface);
    return row !== null && !yes(row.get("disabled"));
  },
  async apply({ ros, ctx }) {
    const { menu, modeField, modeValue } = radioOf(ctx);
    const row = await ros.findByName(menu, ctx.hotspot.interface);
    if (!row?.get(".id")) {
      throw new Error(
        `Radio "${ctx.hotspot.interface}" is not present in ${menu}. The board reports it as ` +
          `type "${ctx.hotspot.interfaceType}" but ${menu} does not list it — the wireless ` +
          `stack was detected wrongly, or the interface was renamed.`,
      );
    }
    await ros.set(menu, rowId(row), ["=disabled=no", `=${modeField}=${modeValue}`]);
  },
};

/**
 * Assert the SSID, when one is stored. Non-critical: the property is nested differently per
 * stack and boards have been known to report it back under a different key, which would make
 * the post-apply check fail on a radio that is actually fine. A wrong network name is a
 * cosmetic problem; aborting the run over it is not.
 */
const hotspotRadioSsid: ProvisionStep = {
  id: "hotspot-radio-ssid",
  title: "Set the SSID customers see",
  critical: false,
  appliesTo: (ctx) =>
    ctx.profile.capabilities.hotspot &&
    ctx.hotspot.interfaceIsRadio &&
    ctx.dialect.radio !== null &&
    ctx.hotspot.ssid !== null,
  async check({ ros, ctx }) {
    const { menu, ssidField } = radioOf(ctx);
    const row = await ros.findByName(menu, ctx.hotspot.interface);
    if (!row) return false;
    // Some builds report the flattened key, others the bare one — accept either.
    const current = row.get(ssidField) ?? row.get("ssid");
    return current === ctx.hotspot.ssid;
  },
  async apply({ ros, ctx }) {
    const { menu, ssidField } = radioOf(ctx);
    const row = await ros.findByName(menu, ctx.hotspot.interface);
    if (!row?.get(".id")) return;
    await ros.set(menu, rowId(row), [`=${ssidField}=${ctx.hotspot.ssid}`]);
  },
};

/**
 * Stop the radio's `running` flag tracking associated clients, so the DHCP server stops reporting
 * itself invalid on a hotspot nobody has connected to yet.
 *
 * On legacy `/interface wireless` in AP mode, `running` is false while the radio beacons happily to
 * an empty room — `monitor` says `status=running-ap` at the same moment. `/ip dhcp-server` copies
 * that flag into its own `invalid`, with `.about="Interface not running"`. Measured on an hAP lite
 * (7.23.2) straight after a clean provision: the hotspot served a phone correctly, but every read
 * of the router said clients could not be given an address. Anyone opening WinBox sees a red
 * `invalid` on a working hotspot and starts changing things.
 *
 * Non-critical, and deliberately so: this only changes how a flag *reports*, never whether the
 * hotspot works. A board that rejects the property must not abort a run over it — the DHCP server
 * is equally functional either way, and `verify.ts` reads the radio's real state regardless.
 */
const hotspotRadioRunningCheck: ProvisionStep = {
  id: "hotspot-radio-running-check",
  title: "Stop the radio reporting itself as not running",
  critical: false,
  appliesTo: (ctx) =>
    ctx.profile.capabilities.hotspot &&
    ctx.hotspot.interfaceIsRadio &&
    ctx.dialect.radio !== null &&
    ctx.dialect.radio.runningCheckField !== null,
  async check({ ros, ctx }) {
    const { menu } = radioOf(ctx);
    const row = await ros.findByName(menu, ctx.hotspot.interface);
    return row !== null && yes(row.get(runningCheckFieldOf(ctx)));
  },
  async apply({ ros, ctx }) {
    const { menu } = radioOf(ctx);
    const row = await ros.findByName(menu, ctx.hotspot.interface);
    if (!row?.get(".id")) return;
    await ros.set(menu, rowId(row), [`=${runningCheckFieldOf(ctx)}=yes`]);
  },
};

const hotspotPool: ProvisionStep = {
  id: "hotspot-pool",
  title: "Create hotspot DHCP address pool",
  critical: true,
  appliesTo: (ctx) => ctx.profile.capabilities.hotspot,
  async check({ ros, ctx }) {
    const row = await ros.findByName("/ip/pool", ctx.hotspot.poolName);
    return matches(row, { ranges: ctx.hotspot.poolRange });
  },
  async apply({ ros, ctx }) {
    const row = await ros.findByName("/ip/pool", ctx.hotspot.poolName);
    if (row?.get(".id")) {
      await ros.set("/ip/pool", rowId(row), [`=ranges=${ctx.hotspot.poolRange}`]);
      return;
    }
    await ros.add("/ip/pool", [
      `=name=${ctx.hotspot.poolName}`,
      `=ranges=${ctx.hotspot.poolRange}`,
    ]);
  },
};

const hotspotGatewayAddress: ProvisionStep = {
  id: "hotspot-gateway-address",
  title: "Assign gateway address on the hotspot interface",
  critical: true,
  // No `interface !== ""` guard: `resolveHotspotInterface` aborts the whole run rather
  // than yielding an empty name, so a skip here can no longer hide a missing hotspot.
  appliesTo: (ctx) => ctx.profile.capabilities.hotspot,
  async check({ ros, ctx }) {
    const rows = await ros.print("/ip/address", [`?interface=${ctx.hotspot.interface}`]);
    return rows.some((r) => r.get("address") === ctx.hotspot.gatewayCidr);
  },
  async apply({ ros, ctx }) {
    await ensureTaggedRule(ros, "/ip/address", "hotspot-gateway-address", [
      `=address=${ctx.hotspot.gatewayCidr}`,
      `=interface=${ctx.hotspot.interface}`,
    ]);
  },
};

const dhcpServer: ProvisionStep = {
  id: "dhcp-server",
  title: "Create hotspot DHCP server",
  critical: true,
  appliesTo: (ctx) => ctx.profile.capabilities.hotspot,
  async check({ ros, ctx }) {
    const row = await ros.findByName("/ip/dhcp-server", "wbs-hs-dhcp");
    return (
      matches(row, {
        interface: ctx.hotspot.interface,
        "address-pool": ctx.hotspot.poolName,
      }) && !yes(row?.get("disabled") ?? null)
    );
  },
  async apply({ ros, ctx }) {
    const params = [
      `=interface=${ctx.hotspot.interface}`,
      `=address-pool=${ctx.hotspot.poolName}`,
      "=lease-time=1h",
      "=disabled=no",
    ];
    const row = await ros.findByName("/ip/dhcp-server", "wbs-hs-dhcp");
    if (row?.get(".id")) {
      await ros.set("/ip/dhcp-server", rowId(row), params);
      return;
    }
    await ros.add("/ip/dhcp-server", ["=name=wbs-hs-dhcp", ...params]);
  },
};

const dhcpNetwork: ProvisionStep = {
  id: "dhcp-network",
  title: "Configure DHCP network (gateway + DNS for clients)",
  critical: true,
  appliesTo: (ctx) => ctx.profile.capabilities.hotspot,
  async check({ ros, ctx }) {
    const row = await ros.findByTag("/ip/dhcp-server/network", "dhcp-network");
    return matches(row, {
      address: ctx.hotspot.network,
      gateway: ctx.hotspot.gatewayIp,
    });
  },
  async apply({ ros, ctx }) {
    await ensureTaggedRule(ros, "/ip/dhcp-server/network", "dhcp-network", [
      `=address=${ctx.hotspot.network}`,
      `=gateway=${ctx.hotspot.gatewayIp}`,
      `=dns-server=${ctx.hotspot.gatewayIp}`,
    ]);
  },
};

const hotspotProfile: ProvisionStep = {
  id: "hotspot-profile",
  title: "Create hotspot profile with HTTP-PAP login (§2.2)",
  critical: true,
  appliesTo: (ctx) => ctx.profile.capabilities.hotspot,
  async check({ ros, ctx }) {
    const row = await ros.findByName("/ip/hotspot/profile", ctx.hotspot.profileName);
    // login-by is the one that silently breaks auth if wrong — see §11.
    return matches(row, {
      "hotspot-address": ctx.hotspot.gatewayIp,
      "login-by": "http-pap",
      "html-directory": "hotspot",
    });
  },
  async apply({ ros, ctx }) {
    const params = [
      `=hotspot-address=${ctx.hotspot.gatewayIp}`,
      "=login-by=http-pap",
      "=html-directory=hotspot",
      "=use-radius=no",
    ];
    const row = await ros.findByName("/ip/hotspot/profile", ctx.hotspot.profileName);
    if (row?.get(".id")) {
      await ros.set("/ip/hotspot/profile", rowId(row), params);
      return;
    }
    await ros.add("/ip/hotspot/profile", [`=name=${ctx.hotspot.profileName}`, ...params]);
  },
};

/*
 * There is deliberately NO step creating a hotspot user profile here.
 *
 * There used to be — `hotspot-user-profile` created one router-level `wbs-hs-users` carrying
 * `shared-users=1` and no rate-limit, and nothing was ever assigned to it, because
 * `createHotspotUser` did not send `=profile=`. On a board that rejects per-user `rate-limit` that
 * meant every voucher sat on `default` with no cap from either mechanism, while a Set up run
 * reported `ok: true`.
 *
 * A router-level profile could not have fixed it either: two packages on one router need different
 * speeds. Limits now ride a per-package profile (`wbs-pkg-<packageId>`) created by
 * `router-sync.ts` at voucher-push time, because provisioning does not know which packages a venue
 * sells and packages change independently of routers.
 *
 * A `wbs-hs-users` left over from an earlier provision is inert and safe to delete by hand.
 */

const hotspotServer: ProvisionStep = {
  id: "hotspot-server",
  title: "Create and enable the hotspot server",
  critical: true,
  appliesTo: (ctx) => ctx.profile.capabilities.hotspot,
  async check({ ros, ctx }) {
    const row = await ros.findByName("/ip/hotspot", ctx.hotspot.serverName);
    return (
      matches(row, {
        interface: ctx.hotspot.interface,
        profile: ctx.hotspot.profileName,
        "address-pool": ctx.hotspot.poolName,
      }) && !yes(row?.get("disabled") ?? null)
    );
  },
  async apply({ ros, ctx }) {
    const params = [
      `=interface=${ctx.hotspot.interface}`,
      `=profile=${ctx.hotspot.profileName}`,
      `=address-pool=${ctx.hotspot.poolName}`,
      "=disabled=no",
    ];
    const row = await ros.findByName("/ip/hotspot", ctx.hotspot.serverName);
    if (row?.get(".id")) {
      await ros.set("/ip/hotspot", rowId(row), params);
      return;
    }
    await ros.add("/ip/hotspot", [`=name=${ctx.hotspot.serverName}`, ...params]);
  },
};

/**
 * A portal host name goes in `dst-host`: RouterOS resolves it and keeps a pass-through rule per
 * address, which is what a Cloudflare-fronted origin needs (measured on CHR 7.25: both of a
 * proxied name's addresses appeared as dynamic rules). An IPv4 origin goes in `dst-address`.
 */
function walledGardenField(ctx: ProvisionContext): "dst-host" | "dst-address" {
  return ctx.endpoints.portal.hostIsIp ? "dst-address" : "dst-host";
}

const walledGarden: ProvisionStep = {
  id: "walled-garden-backend",
  title: "Walled garden — allow backend before login (§4)",
  critical: true,
  appliesTo: (ctx) => ctx.profile.capabilities.hotspot,
  async check({ ros, ctx }) {
    const row = await ros.findByTag("/ip/hotspot/walled-garden/ip", "walled-garden-backend");
    return matches(row, { [walledGardenField(ctx)]: ctx.endpoints.portal.host, action: "accept" });
  },
  async apply({ ros, ctx }) {
    // RouterOS refuses to turn an address entry into a host-name entry ("use either dst-host or
    // dst-address, not both"), so an entry of the other kind is replaced rather than set.
    const existing = await ros.findByTag("/ip/hotspot/walled-garden/ip", "walled-garden-backend");
    const otherField = walledGardenField(ctx) === "dst-host" ? "dst-address" : "dst-host";
    if (existing?.get(".id") && existing.get(otherField)) {
      await ros.remove("/ip/hotspot/walled-garden/ip", rowId(existing));
    }
    await ensureTaggedRule(ros, "/ip/hotspot/walled-garden/ip", "walled-garden-backend", [
      `=${walledGardenField(ctx)}=${ctx.endpoints.portal.host}`,
      "=action=accept",
    ]);
  },
};

const firewallForward: ProvisionStep = {
  id: "firewall-forward-backend",
  title: "Firewall — hotspot clients → backend (§5)",
  critical: true,
  appliesTo: (ctx) => ctx.profile.capabilities.hotspot,
  async check({ ros, ctx }) {
    const row = await ros.findByTag("/ip/firewall/filter", "firewall-forward-backend");
    // A host-name portal is let through by the walled garden alone, and this rule needs an
    // address: correct is "absent", which also clears the rule left from an IPv4 portal.
    if (!ctx.endpoints.portal.hostIsIp) return row === null;
    const correct = matches(row, {
      chain: "forward",
      "src-address": ctx.hotspot.network,
      "dst-address": ctx.endpoints.portal.host,
      action: "accept",
    });
    // Position counts: an accept below the hotspot's reject never runs.
    return (
      correct &&
      (await ruleAheadOfHotspotRules(ros, "/ip/firewall/filter", "firewall-forward-backend"))
    );
  },
  async apply({ ros, ctx }) {
    const existing = await ros.findByTag("/ip/firewall/filter", "firewall-forward-backend");
    if (!ctx.endpoints.portal.hostIsIp) {
      if (existing?.get(".id")) await ros.remove("/ip/firewall/filter", rowId(existing));
      return;
    }
    const params = [
      "=chain=forward",
      `=src-address=${ctx.hotspot.network}`,
      `=dst-address=${ctx.endpoints.portal.host}`,
      "=action=accept",
    ];
    // Must precede the hotspot's own reject rules, or hotspot clients never reach the backend
    // and the portal cannot load at all.
    if (existing?.get(".id")) {
      await ros.set("/ip/firewall/filter", rowId(existing), params);
      await moveRuleAheadOfHotspotRules(ros, "/ip/firewall/filter", "firewall-forward-backend");
      return;
    }
    await addRuleFirst(ros, "/ip/firewall/filter", "firewall-forward-backend", params);
    await moveRuleAheadOfHotspotRules(ros, "/ip/firewall/filter", "firewall-forward-backend");
  },
};

const firewallInput: ProvisionStep = {
  id: "firewall-input-backend",
  title: "Firewall — backend → router API (§5.1)",
  critical: true,
  appliesTo: () => true,
  async check({ ros, ctx }) {
    const row = await ros.findByTag("/ip/firewall/filter", "firewall-input-backend");
    const correct = matches(row, {
      chain: "input",
      "src-address": ctx.endpoints.management.ip,
      action: "accept",
    });
    return (
      correct &&
      (await ruleAheadOfHotspotRules(ros, "/ip/firewall/filter", "firewall-input-backend"))
    );
  },
  async apply({ ros, ctx }) {
    const existing = await ros.findByTag("/ip/firewall/filter", "firewall-input-backend");
    const params = [
      "=chain=input",
      `=src-address=${ctx.endpoints.management.ip}`,
      "=action=accept",
    ];
    if (existing?.get(".id")) {
      await ros.set("/ip/firewall/filter", rowId(existing), params);
      await moveRuleAheadOfHotspotRules(ros, "/ip/firewall/filter", "firewall-input-backend");
      return;
    }
    await addRuleFirst(ros, "/ip/firewall/filter", "firewall-input-backend", params);
    await moveRuleAheadOfHotspotRules(ros, "/ip/firewall/filter", "firewall-input-backend");
  },
};

const natMasquerade: ProvisionStep = {
  id: "nat-masquerade",
  title: "NAT — masquerade hotspot subnet (§6)",
  critical: true,
  appliesTo: (ctx) => ctx.profile.capabilities.hotspot,
  async check({ ros, ctx }) {
    const rows = await ros.print("/ip/firewall/nat", ["?action=masquerade"]);
    // Accept a pre-existing hand-made masquerade for this subnet — §6 says not to duplicate.
    return rows.some(
      (r) => r.get("src-address") === ctx.hotspot.network || r.get("src-address") === null,
    );
  },
  async apply({ ros, ctx }) {
    await ensureTaggedRule(ros, "/ip/firewall/nat", "nat-masquerade", [
      "=chain=srcnat",
      `=src-address=${ctx.hotspot.network}`,
      "=action=masquerade",
    ]);
  },
};

const ipBinding: ProvisionStep = {
  id: "ip-binding-backend",
  title: "IP binding — bypass hotspot for the backend (§16.3)",
  critical: false,
  appliesTo: (ctx) => ctx.profile.capabilities.hotspot,
  async check({ ros, ctx }) {
    const row = await ros.findByTag("/ip/hotspot/ip-binding", "ip-binding-backend");
    return matches(row, { address: ctx.endpoints.management.ip, type: "bypassed" });
  },
  async apply({ ros, ctx }) {
    await ensureTaggedRule(ros, "/ip/hotspot/ip-binding", "ip-binding-backend", [
      `=address=${ctx.endpoints.management.ip}`,
      "=type=bypassed",
    ]);
  },
};

const portalFiles: ProvisionStep = {
  id: "portal-files",
  title: "Upload the portal pages — login, alogin, status (§3, §18)",
  critical: true,
  appliesTo: (ctx) => ctx.profile.capabilities.hotspot && ctx.dialect.fileWrite !== "manual",
  async check({ ros, ctx }) {
    for (const name of PORTAL_FILES) {
      const path = routerPathFor(name);
      const [row] = await ros.print("/file", [`?name=${path}`]);
      if (!row) return false;
      const rendered = await renderPortalFile(name, ctx.endpoints.portal.origin);
      if (Number(row.get("size") ?? 0) !== Buffer.byteLength(rendered, "utf8")) return false;
    }
    return true;
  },
  async apply({ ros, ctx }) {
    for (const name of PORTAL_FILES) {
      const path = routerPathFor(name);
      const contents = await renderPortalFile(name, ctx.endpoints.portal.origin);
      const [existing] = await ros.print("/file", [`?name=${path}`]);

      if (ctx.dialect.fileWrite === "file-contents") {
        // Last-resort path only — `contents=` silently truncates multi-byte UTF-8.
        // See the comment in dialect.ts; nothing selects this by default.
        try {
          if (existing?.get(".id")) {
            await ros.set("/file", rowId(existing), [`=contents=${contents}`]);
          } else {
            await ros.add("/file", [`=name=${path}`, `=contents=${contents}`]);
          }
          continue;
        } catch (err) {
          if (!(err instanceof RouterUnsupportedError)) throw err;
        }
      }

      // The router pulls the file from the backend — byte-exact, and the backend IP is
      // templated in server-side at fetch time.
      await ros.exec("/tool/fetch", [
        `=url=${ctx.endpoints.management.url}/portal/hotspot-files/${name}`,
        `=dst-path=${path}`,
        "=mode=http",
      ]);
    }
  },
};

const customCommands: ProvisionStep = {
  id: "custom-commands",
  title: "Run per-router custom commands",
  critical: false,
  appliesTo: (ctx) => Boolean(ctx.router.provisioningCommand?.trim()),
  // No way to know whether an arbitrary command already ran — always execute.
  async check() {
    return false;
  },
  async apply({ ros, ctx }) {
    const lines = (ctx.router.provisioningCommand ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    for (const line of lines) {
      const [command, ...params] = line.split(/\s+/);
      if (!command) continue;
      await ros.exec(command.replace(/\s+/g, "/"), params);
    }
  },
};

/** Ordered — later steps depend on earlier ones (pool before server, profile before server). */
export const PROVISION_STEPS: ProvisionStep[] = [
  identity,
  dns,
  // Prepare the interface before building anything on it: un-bridge it, then bring the radio
  // up, so the gateway address that follows lands somewhere that can actually serve clients.
  hotspotInterfaceUnbridged,
  hotspotRadioEnabled,
  hotspotRadioSsid,
  // Before the DHCP steps: it is the DHCP server that copies the flag this fixes.
  hotspotRadioRunningCheck,
  hotspotPool,
  hotspotGatewayAddress,
  dhcpServer,
  dhcpNetwork,
  hotspotProfile,
  hotspotServer,
  walledGarden,
  firewallForward,
  firewallInput,
  natMasquerade,
  ipBinding,
  portalFiles,
  customCommands,
];

export { RouterError };
