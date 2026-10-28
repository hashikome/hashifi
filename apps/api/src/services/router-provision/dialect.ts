/**
 * Board/firmware differences, in one place.
 *
 * The rest of the provisioner is written against logical operations ("set the SSID",
 * "write a file"); this module decides which RouterOS commands actually implement them
 * on the board in front of us. When a new MikroTik generation changes a menu path, this
 * is the only file that should need editing.
 */

import type { RouterProfile } from "./probe.js";

export type FileWriteStrategy = "file-contents" | "tool-fetch" | "manual";

/**
 * How to talk to this board's radio.
 *
 * The two stacks disagree on more than the menu path: legacy takes `ssid=` and
 * `mode=ap-bridge` as top-level properties, wifiwave2 nests them under `configuration.`.
 * Steps ask for "set the SSID" and this decides what that means.
 */
export interface RadioDialect {
  menu: string;
  /** Property holding the network name — `ssid` or `configuration.ssid`. */
  ssidField: string;
  /** Property/value that puts the radio into access-point mode. */
  modeField: string;
  modeValue: string;
  /**
   * Property that stops the interface's `running` flag tracking associated clients, or null where
   * the stack has no such knob. Legacy `/interface wireless` in AP mode reports `running=false`
   * while it is beaconing to nobody, and `/ip dhcp-server` copies that flag and marks itself
   * `invalid` — a working hotspot that reads as broken until the first phone connects. wifiwave2
   * has no equivalent property, hence nullable.
   */
  runningCheckField: string | null;
}

export interface Dialect {
  /** Menu for radio interfaces, or null on boards with no wireless (hEX, CRS…) */
  wirelessMenu: string | null;
  /** null on boards with no radio — the hotspot then runs on ethernet/bridge. */
  radio: RadioDialect | null;
  /** How to get login.html onto the device */
  fileWrite: FileWriteStrategy;
  /** `=shared-users=` accepted on /ip/hotspot/user/add */
  userSharedUsers: boolean;
  /** `=rate-limit=` accepted on /ip/hotspot/user/add */
  userRateLimit: boolean;
  /**
   * When per-user limits are unsupported, the same caps are applied to the hotspot
   * *user profile* instead — coarser, but it's what RouterOS 6 offers (§13.7).
   */
  limitsAtProfileLevel: boolean;
}

export function dialectFor(profile: RouterProfile): Dialect {
  const { capabilities, wirelessStack } = profile;

  const wirelessMenu =
    wirelessStack === "wifi"
      ? "/interface/wifi"
      : wirelessStack === "wireless"
        ? "/interface/wireless"
        : null;

  const radio: RadioDialect | null =
    wirelessStack === "wifi"
      ? {
          menu: "/interface/wifi",
          ssidField: "configuration.ssid",
          modeField: "configuration.mode",
          modeValue: "ap",
          runningCheckField: null,
        }
      : wirelessStack === "wireless"
        ? {
            menu: "/interface/wireless",
            ssidField: "ssid",
            modeField: "mode",
            // ap-bridge, not `ap` — `ap` is a legacy alias that does not bridge clients.
            modeValue: "ap-bridge",
            runningCheckField: "disable-running-check",
          }
        : null;

  // ALWAYS prefer /tool fetch, on every version.
  //
  // RouterOS 7 does accept `/file/add contents=...`, but it SILENTLY TRUNCATES: pushing a
  // 19,321-byte alogin.html landed 18,651 bytes with no error reported. The loss tracks the
  // multi-byte UTF-8 characters in the page (∞, …, —), which `contents=` does not round
  // trip. A fetch transfers bytes exactly — verified against a 135,313-byte package.
  //
  // `file-contents` is kept only as an explicit last resort; nothing selects it by default.
  const fileWrite: FileWriteStrategy = capabilities.toolFetch ? "tool-fetch" : "manual";

  return {
    wirelessMenu,
    radio,
    fileWrite,
    userSharedUsers: capabilities.userSharedUsers,
    userRateLimit: capabilities.userRateLimit,
    limitsAtProfileLevel: !capabilities.userRateLimit,
  };
}

/** Build the params for `/ip/hotspot/user/add`, omitting whatever this board rejects. */
export function hotspotUserParams(
  dialect: Dialect,
  opts: {
    code: string;
    deviceLimit: number;
    downloadSpeedMbps: number;
    uploadSpeedMbps: number | null;
    limitBytesTotal: number | null;
    limitUptime: string | null;
  },
): string[] {
  const params = [`=name=${opts.code}`, `=password=${opts.code}`];

  if (opts.limitBytesTotal !== null) params.push(`=limit-bytes-total=${opts.limitBytesTotal}`);
  if (opts.limitUptime !== null) params.push(`=limit-uptime=${opts.limitUptime}`);

  if (dialect.userRateLimit && opts.downloadSpeedMbps > 0) {
    const up = opts.uploadSpeedMbps ?? opts.downloadSpeedMbps;
    params.push(`=rate-limit=${up}M/${opts.downloadSpeedMbps}M`);
  }

  if (dialect.userSharedUsers && opts.deviceLimit > 0) {
    params.push(`=shared-users=${opts.deviceLimit}`);
  }

  return params;
}
