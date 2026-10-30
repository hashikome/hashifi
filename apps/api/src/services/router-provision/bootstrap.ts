/**
 * Generate the manual bootstrap script — the four things provisioning cannot do for itself.
 *
 * Provisioning connects *through* the LAN address, the API service, the bridge and the radio,
 * so those must exist first. Until now that meant hand-typing docs/runbooks/router-onboarding.md Step 2,
 * whose radio line (`/interface wireless set wlan1 …`) is correct on legacy boards, wrong on
 * wifiwave2 and meaningless on a hEX — and the probe that could have told you which you have
 * cannot run until the API user it creates exists. This module removes that decision: the
 * script detects the board at run time on the router itself.
 *
 * Two constraints shape the output, both learned the hard way and both easy to regress:
 *
 *  1. **One statement per line.** Multi-line `do={ … }` blocks pasted into the WinBox
 *     terminal are unreliable. Every control-flow statement here is a single line, however
 *     long, so a paste is a sequence of independent commands.
 *
 *  2. **`:parse` for menus that may not exist.** `/interface wifi …` on a legacy board is not
 *     a runtime error to be caught — the command path may fail to resolve when the line is
 *     read, so guarding it with `:if` alone is not enough. Building the command as a string
 *     and running it through `:parse` inside the guarded branch defers resolution to the
 *     point where we already know the menu is there.
 */

import { randomBytes } from "node:crypto";
import { intToIpv4, ipv4ToInt } from "./ipv4.js";
import { type ManagementTunnel, tunnelLines } from "./tunnel.js";

export interface BootstrapInput {
  /** Becomes `/system identity` — also how the router names itself in Neighbors. */
  routerName: string;
  /** The router's LAN address, i.e. the address this backend will reach it on. */
  ipAddress: string;
  /** Prefix length for that address. Defaults to 24. */
  lanPrefix?: number;
  /** The ISP router / upstream gateway. Defaults to the first host of the router's subnet. */
  gatewayIp?: string;
  apiUsername: string;
  /** Left blank, a strong one is generated and returned in `resolved`. */
  apiPassword?: string;
  /** Optional — included only when set, so a re-paste never silently changes it. */
  adminPassword?: string;
  /** Defaults to the router name. */
  ssid?: string;
  /** The management tunnel to the platform, or null for a router the API reaches on its LAN. */
  tunnel: ManagementTunnel | null;
  /** The RouterOS API port the router listens on (`MIKROTIK_API_PORT`). */
  apiPort: number;
}

export interface BootstrapScript {
  script: string;
  warnings: string[];
  resolved: {
    routerName: string;
    ipAddress: string;
    lanCidr: string;
    gatewayIp: string;
    apiUsername: string;
    apiPassword: string;
    apiPort: number;
    ssid: string;
    /** True when we invented the password, so the UI knows to surface it for copying. */
    apiPasswordGenerated: boolean;
  };
}

const BRIDGE_NAME = "bridgeLocal";

/**
 * Quote a value for a RouterOS double-quoted string.
 *
 * `$` matters as much as `"` and `\` — RouterOS interpolates variables inside quotes, so an
 * unescaped `$` in a password silently produces a different password on the router than the
 * one stored in our database.
 */
export function rosQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
}

/** Password charset avoids quoting hazards entirely rather than relying on escaping. */
function generatePassword(length = 24): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_";
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

function firstHostOf(ip: string, prefix: number): string | null {
  const asInt = ipv4ToInt(ip);
  if (asInt === null) return null;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = (asInt & mask) >>> 0;
  const host = (network + 1) >>> 0;
  return intToIpv4(host);
}

function sameSubnet(a: string, b: string, prefix: number): boolean {
  const left = ipv4ToInt(a);
  const right = ipv4ToInt(b);
  if (left === null || right === null) return false;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (left & mask) >>> 0 === (right & mask) >>> 0;
}

/**
 * The radio stanza — the part of Step 2 that used to require knowing your hardware.
 *
 * The branch is decided from `/interface print`, which exists on every board: legacy radios report
 * `type=wlan`, wifiwave2 radios `wifi` on RouterOS 7.13+ and `wifiwave2` on 7.12 and older. Each
 * command is handed to `:parse` inside its own branch, so a board without the menu never has to
 * resolve its name — guarding with `:if` alone is not enough, because the command path can fail to
 * resolve when the line is *read* rather than when it runs.
 *
 * Each command is escaped a second time by `run()`, because it travels as a RouterOS string
 * containing RouterOS source. Getting this wrong corrupts SSIDs rather than failing loudly.
 *
 * ── Why this is one line per menu ──
 *
 * It used to be a single 1038-character statement: all three menus, their fallbacks and their
 * messages inlined, plus two `:local` lines feeding it. On 2026-08-12 that line silently failed on
 * an hAP lite — the RouterOS console's input line limit is ~1024 bytes, so the paste truncated it
 * mid-string. Every other step in the script applied; the radio was left disabled, and the only
 * evidence was a syntax error in output that had already scrolled away. `bootstrap.test.ts` now
 * caps every generated statement at 512 characters.
 *
 * Two rules came out of that, and both matter:
 *
 *   1. **Short.** Half the limit, so no SSID or router name can push a line over.
 *   2. **Self-contained.** No line may depend on a variable another line set. In the interactive
 *      console each pasted line is its own command, and relying on a `:local` surviving between
 *      them was the other candidate cause of the same failure. Every condition below re-reads
 *      `/interface find` instead.
 *
 * The final line is a real check rather than error-tracking: it asks whether a radio is still
 * disabled, so it reports the outcome the admin cares about instead of whether a command returned
 * without error.
 */
function radioLines(ssid: string): string[] {
  const q = rosQuote(ssid);

  const legacyCmd = `/interface wireless set [/interface find where type~"^wlan"] disabled=no mode=ap-bridge band=2ghz-b/g/n ssid="${q}"`;
  const wifiCmd = `/interface wifi set [/interface wifi find] disabled=no configuration.mode=ap configuration.ssid="${q}"`;
  const wave2Cmd = `/interface wifiwave2 set [/interface wifiwave2 find] disabled=no configuration.mode=ap configuration.ssid="${q}"`;

  /** `:parse` yields a function; `$f` invokes it. Both on one line, so no cross-line state. */
  const run = (cmd: string, menu: string) =>
    `:do {:local f [:parse "${rosQuote(cmd)}"]; $f} on-error={:put "${menu} rejected the radio command."}`;

  const when = (find: string, body: string) =>
    `:if ([:len [/interface find where ${find}]] > 0) do={${body}}`;

  return [
    when(`type~"^wlan"`, run(legacyCmd, "/interface wireless")),
    when(`type="wifi"`, run(wifiCmd, "/interface wifi")),
    when(`type="wifiwave2"`, run(wave2Cmd, "/interface wifiwave2")),
    `:if ([:len [/interface find where type~"^(wlan|wifi)"]] = 0) do={:put "No radio on this board. The hotspot must run on an ethernet or bridge interface - set Hotspot Interface on the router form."}`,
    `:if ([:len [/interface find where type~"^(wlan|wifi)" disabled=yes]] > 0) do={:put "Radio is still disabled - enable it by hand, then run Set up."}`,
  ];
}

/**
 * Control characters, which no value interpolated into the script may contain: the script is
 * pasted line by line into the RouterOS terminal, so a newline in any value (even inside the
 * banner comment, or a quoted string) ends that line and runs the rest as a command.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
export const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function buildBootstrapScript(input: BootstrapInput): BootstrapScript {
  // The request schema rejects these first; this holds for every caller.
  const values: [string, string | undefined][] = [
    ["routerName", input.routerName],
    ["ipAddress", input.ipAddress],
    ["gatewayIp", input.gatewayIp],
    ["apiUsername", input.apiUsername],
    ["apiPassword", input.apiPassword],
    ["adminPassword", input.adminPassword],
    ["ssid", input.ssid],
    ["tunnel.endpointHost", input.tunnel?.endpointHost],
    ["tunnel.routerAddress", input.tunnel?.routerAddress],
    ["tunnel.serverAddress", input.tunnel?.serverAddress],
    ["tunnel.routerPrivateKey", input.tunnel?.routerPrivateKey],
    ["tunnel.serverPublicKey", input.tunnel?.serverPublicKey],
  ];
  for (const [name, value] of values) {
    if (value !== undefined && CONTROL_CHARACTERS.test(value)) {
      throw new Error(`${name} cannot contain control characters`);
    }
  }

  const warnings: string[] = [];

  const routerName = input.routerName.trim() || "MikroTik";
  const ipAddress = input.ipAddress.trim();
  const lanPrefix = input.lanPrefix ?? 24;
  const ssid = (input.ssid?.trim() || routerName).slice(0, 32);
  const apiUsername = input.apiUsername.trim();
  const apiPasswordGenerated = !input.apiPassword;
  const apiPassword = input.apiPassword || generatePassword();
  const apiPort = input.apiPort;

  const derivedGateway = firstHostOf(ipAddress, lanPrefix);
  const gatewayIp = input.gatewayIp?.trim() || derivedGateway || "";

  if (!input.gatewayIp?.trim() && derivedGateway) {
    warnings.push(
      `No upstream gateway given, so ${derivedGateway} was assumed (the first address in ` +
        `${ipAddress}/${lanPrefix}). If your ISP router is on a different address, change it.`,
    );
  }
  if (gatewayIp && !sameSubnet(ipAddress, gatewayIp, lanPrefix)) {
    warnings.push(
      `Gateway ${gatewayIp} is not inside ${ipAddress}/${lanPrefix}. The router will not be ` +
        `able to reach it, and the default route will not work.`,
    );
  }
  if (apiPasswordGenerated) {
    warnings.push(
      "A strong API password was generated. Copy it into the API Password field on this form " +
        "before saving — it is not stored anywhere until you do.",
    );
  }
  if (!input.adminPassword?.trim()) {
    warnings.push(
      "No admin password given, so the script leaves it alone. A freshly reset MikroTik has a " +
        "blank admin password — set one before the router goes into service.",
    );
  }

  const lanCidr = `${ipAddress}/${lanPrefix}`;
  const lines: string[] = [
    `# == Bootstrap for "${routerName}" =========================================`,
    `#`,
    `# Paste into the MikroTik terminal (WinBox -> New Terminal) AFTER:`,
    `#     /system reset-configuration no-defaults=yes skip-backup=yes`,
    `#`,
    `# Sets up only what the billing system connects *through* and therefore cannot create`,
    `# for itself: the LAN address, the API service and its user, the bridge, and the radio.`,
    `# Everything else (hotspot, DHCP, firewall, walled garden, portal pages) is done by`,
    `# Provision in the admin panel afterwards.`,
    `#`,
    `# Safe to paste more than once; every step checks before it changes anything.`,
    ``,
    `# 1. Identity`,
    `/system identity set name="${rosQuote(routerName)}"`,
    ``,
  ];

  if (input.adminPassword?.trim()) {
    lines.push(
      `# 2. Admin password`,
      `/user set admin password="${rosQuote(input.adminPassword.trim())}"`,
      ``,
    );
  }

  lines.push(
    `# 3. Bridge every ethernet port. The port count differs per board (4 on an hAP lite,`,
    `#    5 on a hEX, 10 on an RB4011), so they are discovered rather than listed.`,
    `:if ([:len [/interface bridge find where name="${BRIDGE_NAME}"]] = 0) do={/interface bridge add name=${BRIDGE_NAME}}`,
    `:foreach e in=[/interface ethernet find] do={:local n [/interface ethernet get $e name]; :if ([:len [/interface bridge port find where interface=$n]] = 0) do={/interface bridge port add bridge=${BRIDGE_NAME} interface=$n}}`,
    ``,
    `# 4. A radio must NEVER be a bridge port - the hotspot puts its own gateway address`,
    `#    directly on that interface, and bridging it makes the addressing collide so the`,
    `#    portal never intercepts. Undo it if a previous config left one bridged.`,
    `:foreach p in=[/interface bridge port find] do={:local n [/interface bridge port get $p interface]; :if ($n ~ "^(wlan|wifi)") do={/interface bridge port remove $p; :put ("Removed " . $n . " from the bridge - the hotspot needs it unbridged.")}}`,
    ``,
    `# 5. A DHCP client cannot run on a bridge port. Some boards (CHR, and default configs)`,
    `#    keep one on ether1 even after a reset; remove it so its lease is not mistaken for`,
    `#    the LAN address below.`,
    `:foreach c in=[/ip dhcp-client find] do={:local i [/ip dhcp-client get $c interface]; :if ([:len [/interface bridge port find where interface=$i]] > 0) do={/ip dhcp-client remove $c; :put ("Removed the DHCP client on " . $i . " - it is now a bridge port.")}}`,
    ``,
    `# 6. LAN address and default route. Only static entries count: a DHCP lease is not ours.`,
    `:if ([:len [/ip address find where address="${lanCidr}" dynamic=no]] = 0) do={/ip address add address=${lanCidr} interface=${BRIDGE_NAME}}`,
  );

  if (gatewayIp) {
    lines.push(
      `:if ([:len [/ip route find where dst-address="0.0.0.0/0" gateway="${gatewayIp}" dynamic=no]] = 0) do={/ip route add dst-address=0.0.0.0/0 gateway=${gatewayIp}}`,
    );
  }

  lines.push(
    ``,
    ...(input.tunnel
      ? [
          `# 7. Management tunnel. The router dials the platform, so no port is opened at the`,
          `#    venue; the API is then reachable only from the platform, through the tunnel.`,
          ...tunnelLines(input.tunnel),
          ``,
        ]
      : []),
    `# 8. RouterOS API, and the account the billing system authenticates with`,
    input.tunnel
      ? `/ip service set api disabled=no port=${apiPort} address=${input.tunnel.serverAddress}/32`
      : `/ip service set api disabled=no port=${apiPort}`,
    `:if ([:len [/user find where name="${rosQuote(apiUsername)}"]] = 0) do={/user add name="${rosQuote(apiUsername)}" password="${rosQuote(apiPassword)}" group=full} else={/user set [/user find where name="${rosQuote(apiUsername)}"] password="${rosQuote(apiPassword)}" group=full}`,
    ``,
    `# 9. Radio. Legacy boards report interface type "wlan", wifiwave2 boards "wifi", so the`,
    `#    board decides this - you do not have to know which stack you have.`,
    ...radioLines(ssid),
    ``,
    `# 10. Prove the router can reach the internet. No replies here means nothing downstream`,
    `#    will work - usually the bridge MAC is not on the ISP router's whitelist.`,
    `:put "Bootstrap complete. Testing internet..."`,
    `/ping 8.8.8.8 count=3`,
  );

  return {
    script: `${lines.join("\n")}\n`,
    warnings,
    resolved: {
      routerName,
      ipAddress,
      lanCidr,
      gatewayIp,
      apiUsername,
      apiPassword,
      apiPort,
      ssid,
      apiPasswordGenerated,
    },
  };
}
