/**
 * Everything a provisioning run needs to know, derived once up front.
 *
 * Notably this resolves the backend's own LAN address by looking for a local interface
 * on the same subnet as the router. §10 of the MikroTik guide ("When the Laptop IP
 * Changes") exists because that address was hardcoded in four places; here it is
 * discovered at run time, so re-provisioning after an IP change is self-correcting.
 */

import { networkInterfaces } from "node:os";
import type { Router } from "../../generated/prisma/client.js";
import type { Dialect } from "./dialect.js";
import { intToIpv4, ipv4ToInt } from "./ipv4.js";
import type { RouterProfile } from "./probe.js";

type RouterRow = Router;

/**
 * The router fields the addressing plan actually depends on.
 *
 * Kept structural so the "Test connection" endpoint can preview the plan for a router
 * that has not been saved yet — there is no row to pass.
 */
export type HotspotPlanInput = Pick<
  RouterRow,
  "ipAddress" | "hotspotInterface" | "networkRange" | "hotspotGatewayIp" | "hotspotName" | "ssid"
>;

export interface HotspotPlan {
  interface: string;
  /** Type as `/interface print` reports it — `wlan`/`wifi` for a radio, else `ether`/`bridge`. */
  interfaceType: string;
  /** True when the hotspot interface is a radio we can enable and name. */
  interfaceIsRadio: boolean;
  /** Network name to assert, or null to leave whatever the radio already broadcasts. */
  ssid: string | null;
  /** e.g. "10.5.50.0/24" */
  network: string;
  /** address assigned to the router on the hotspot side, e.g. "10.5.50.1" */
  gatewayIp: string;
  /** CIDR form for /ip/address, e.g. "10.5.50.1/24" */
  gatewayCidr: string;
  /** e.g. "10.5.50.10-10.5.50.254" */
  poolRange: string;
  poolName: string;
  profileName: string;
  serverName: string;
  dnsServers: string;
}

export interface ProvisionContext {
  router: RouterRow;
  profile: RouterProfile;
  dialect: Dialect;
  endpoints: BackendEndpoints;
  hotspot: HotspotPlan;
  dryRun: boolean;
}

const DEFAULT_NETWORK = "10.5.50.0/24";
const DEFAULT_DNS = "8.8.8.8,8.8.4.4";

// ── IPv4 helpers ────────────────────────────────────────────────────────────

function ipToInt(ip: string): number {
  const value = ipv4ToInt(ip);
  if (value === null) throw new Error(`Invalid IPv4 address: ${ip}`);
  return value;
}

const intToIp = intToIpv4;

export function parseCidr(cidr: string): { networkInt: number; prefix: number; size: number } {
  const [addr, prefixRaw] = cidr.split("/");
  if (!addr || !prefixRaw) throw new Error(`Invalid CIDR: ${cidr}`);
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) {
    throw new Error(`Unsupported CIDR prefix /${prefixRaw} in ${cidr} — expected /8 to /30`);
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { networkInt: (ipToInt(addr) & mask) >>> 0, prefix, size: 2 ** (32 - prefix) };
}

/** Do two CIDRs share any address? Compared at the shorter (less specific) prefix. */
export function cidrsOverlap(a: string, b: string): boolean {
  try {
    const left = parseCidr(a);
    const right = parseCidr(b);
    const prefix = Math.min(left.prefix, right.prefix);
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return (left.networkInt & mask) >>> 0 === (right.networkInt & mask) >>> 0;
  } catch {
    return false;
  }
}

/** Same /24-style comparison used to find our own address on the router's subnet. */
function sameSubnet(a: string, b: string, prefix = 24): boolean {
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  try {
    return (ipToInt(a) & mask) >>> 0 === (ipToInt(b) & mask) >>> 0;
  } catch {
    return false;
  }
}

/**
 * The two ways a router relates to this API, which the purchased code treated as one address.
 *
 * - **Management**: where the router reaches the API, to fetch its portal pages and be pinged,
 *   and the source address the router accepts API connections from. In the cloud design this is
 *   the API's address inside the router-initiated tunnel; on a shared LAN it is the API's LAN
 *   address. Always an IPv4 address, because RouterOS firewall rules need one.
 * - **Portal**: the origin guests' browsers load the captive portal from, and so what the walled
 *   garden must let through before login. In production a public HTTPS host name, whose
 *   addresses change behind Cloudflare; on a shared LAN the management URL.
 */
export interface BackendEndpoints {
  management: { url: string; ip: string };
  portal: { origin: string; host: string; hostIsIp: boolean };
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Resolve both endpoints for a router at `routerHost`.
 *
 * `ROUTER_MANAGEMENT_URL` sets the management URL; without it, the local IPv4 that shares a
 * subnet with the router is used (the purchased LAN design). `PORTAL_ORIGIN` sets the portal
 * origin; without it, guests are sent to the management URL.
 */
export function resolveBackendEndpoints(routerHost: string): BackendEndpoints {
  const management = resolveManagementUrl(routerHost);
  const origin = portalOriginFor(management.url);
  const host = new URL(origin).hostname;
  return { management, portal: { origin, host, hostIsIp: IPV4.test(host) } };
}

/** The portal origin for a management URL: `PORTAL_ORIGIN`, or the management URL itself. */
export function portalOriginFor(managementUrl: string): string {
  return (process.env.PORTAL_ORIGIN ?? managementUrl).replace(/\/+$/, "");
}

function resolveManagementUrl(routerHost: string): { url: string; ip: string } {
  const explicit = process.env.ROUTER_MANAGEMENT_URL;
  if (explicit) {
    const url = explicit.replace(/\/+$/, "");
    const ip = new URL(url).hostname;
    if (!IPV4.test(ip)) {
      throw new Error(
        `ROUTER_MANAGEMENT_URL must use an IPv4 address (routers filter API access by it): ${url}`,
      );
    }
    return { url, ip };
  }

  const port = process.env.PORT ?? "8080";
  const candidates: string[] = [];

  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      candidates.push(addr.address);
    }
  }

  const match = candidates.find((ip) => sameSubnet(ip, routerHost));
  if (!match) {
    throw new Error(
      `Cannot determine this server's address on the router's network (${routerHost}). ` +
        `No local interface shares that subnet — check the backend machine's IP (§1), ` +
        `or set ROUTER_MANAGEMENT_URL explicitly.`,
    );
  }

  return { url: `http://${match}:${port}`, ip: match };
}

/**
 * Interface types that can host a hotspot clients associate to over the air.
 *
 * `wlan` is the legacy `/interface wireless` stack; `wifi` is wifiwave2 on RouterOS 7
 * (`wifiwave2` was the type name on 7.13 and earlier). Auto-detection covers radios ONLY
 * — see `resolveHotspotInterface`.
 */
const RADIO_INTERFACE_TYPES = new Set(["wlan", "wifi", "wifiwave2"]);

/** Would auto-detection consider an interface of this type? */
export function isRadioInterfaceType(type: string): boolean {
  return RADIO_INTERFACE_TYPES.has(type);
}

/**
 * Decide which interface the hotspot runs on, or refuse.
 *
 * There is deliberately **no fallback to a bridge**. An earlier version fell through to
 * the first enabled bridge, which on any normal build of this system is `bridgeLocal` —
 * the LAN. That put the hotspot gateway address and a captive portal onto the network the
 * backend and the ISP router live on. It also only matched type `wlan`, so every
 * wifiwave2 board (hAP ax², cAP ax) took that fallback rather than finding its radio.
 *
 * Boards with no radio at all (hEX, CRS) are legitimate, but they cannot be guessed for:
 * the admin must name the interface explicitly.
 */
export function resolveHotspotInterface(router: HotspotPlanInput, profile: RouterProfile): string {
  const { interfaces } = profile;
  const candidates = () =>
    interfaces.length
      ? interfaces.map((i) => `${i.name} (${i.type}${i.disabled ? ", disabled" : ""})`).join(", ")
      : "none — the probe found no interfaces at all";

  const explicit = router.hotspotInterface?.trim();

  if (explicit) {
    const found = interfaces.find((i) => i.name === explicit);
    if (!found) {
      throw new Error(
        `Hotspot interface "${explicit}" does not exist on this router. ` +
          `Available interfaces: ${candidates()}. Fix the Hotspot Interface field on the ` +
          `router, or clear it to auto-detect the radio.`,
      );
    }
    // A disabled *radio* is fine — the `hotspot-radio-enabled` step turns it on, and refusing
    // here would make provisioning abort on the very fault it is able to repair. Nothing
    // enables a disabled ethernet or bridge interface, so that case still has to stop.
    if (found.disabled && !RADIO_INTERFACE_TYPES.has(found.type)) {
      throw new Error(
        `Hotspot interface "${explicit}" is disabled, and it is not a radio (type ` +
          `"${found.type}") — provisioning has no step that can enable it. Enable it on the ` +
          `router first, or choose a different interface.`,
      );
    }
    assertNotManagementInterface(explicit, router, profile);
    return explicit;
  }

  // Prefer a radio that is already up; fall back to a disabled one, which provisioning enables.
  const radios = interfaces.filter((i) => RADIO_INTERFACE_TYPES.has(i.type));
  const radio = radios.find((i) => !i.disabled) ?? radios[0];
  if (!radio) {
    throw new Error(
      `No wireless interface found, so the hotspot interface cannot be auto-detected. Boards ` +
        `with no radio (hEX, CRS) can still run a hotspot, but you must set the Hotspot ` +
        `Interface field to the ethernet or bridge interface the clients arrive on. ` +
        `Available: ${candidates()}.`,
    );
  }

  assertNotManagementInterface(radio.name, router, profile);
  return radio.name;
}

/**
 * Refuse to put the hotspot on the interface we manage the router through.
 *
 * Doing so assigns the gateway address to that network and points a captive portal at it,
 * cutting the backend off from the router it just configured.
 */
function assertNotManagementInterface(
  iface: string,
  router: HotspotPlanInput,
  profile: RouterProfile,
): void {
  // No address rows means an older cached profile — don't block on missing data.
  if (profile.addresses.length === 0) return;

  const management = profile.addresses.find(
    (a) => !a.disabled && a.address.split("/")[0] === router.ipAddress,
  );
  if (!management || management.interface !== iface) return;

  throw new Error(
    `Refusing to provision: "${iface}" carries ${management.address}, the address this ` +
      `system manages the router on. Putting the hotspot there would place a captive ` +
      `portal on your LAN and cut the backend off. The hotspot needs its own interface — ` +
      `typically the radio, which must NOT be a bridge port.`,
  );
}

/** Derive the hotspot addressing plan from the router row, filling sane defaults. */
export function buildHotspotPlan(router: HotspotPlanInput, profile: RouterProfile): HotspotPlan {
  const network = router.networkRange?.includes("/") ? router.networkRange : DEFAULT_NETWORK;
  const { networkInt, prefix, size } = parseCidr(network);

  const gatewayIp = router.hotspotGatewayIp || intToIp(networkInt + 1);
  // Leave the low addresses free for static assignments; stop before the broadcast.
  const poolStart = intToIp(networkInt + 10);
  const poolEnd = intToIp(networkInt + size - 2);

  const iface = resolveHotspotInterface(router, profile);

  // A hotspot subnet overlapping an address the router already holds would collide with
  // that network's DHCP and NAT. Same class of mistake as choosing the wrong interface.
  //
  // Addresses on the hotspot interface itself are excluded: after a successful run that
  // is our own gateway address, and matching it would make re-provisioning throw.
  const clash = profile.addresses.find(
    (a) =>
      !a.disabled &&
      a.interface !== iface &&
      a.address.includes("/") &&
      cidrsOverlap(network, a.address),
  );
  if (clash) {
    throw new Error(
      `Hotspot network ${network} overlaps ${clash.address}, already configured on ` +
        `"${clash.interface}". Pick a Network Range that does not collide with the ` +
        `router's existing networks — the default ${DEFAULT_NETWORK} is usually safe.`,
    );
  }

  const interfaceType = profile.interfaces.find((i) => i.name === iface)?.type ?? "unknown";

  return {
    interface: iface,
    interfaceType,
    interfaceIsRadio: isRadioInterfaceType(interfaceType),
    ssid: router.ssid?.trim() || null,
    network,
    gatewayIp,
    gatewayCidr: `${gatewayIp}/${prefix}`,
    poolRange: `${poolStart}-${poolEnd}`,
    poolName: "wbs-hs-pool",
    profileName: "wbs-hsprof",
    serverName: router.hotspotName || "wbs-hotspot",
    dnsServers: DEFAULT_DNS,
  };
}

export function buildContext(
  router: RouterRow,
  profile: RouterProfile,
  dialect: Dialect,
  dryRun: boolean,
): ProvisionContext {
  return {
    router,
    profile,
    dialect,
    endpoints: resolveBackendEndpoints(router.ipAddress),
    hotspot: buildHotspotPlan(router, profile),
    dryRun,
  };
}
