import { describe, expect, test } from "bun:test";
import { dialectFor } from "./dialect.js";
import type { RouterProfile } from "./probe.js";

/**
 * `dialect.ts` is the ONLY place version/stack command differences belong, so this suite pins the
 * differences that were learned from real hardware rather than from documentation.
 */

const profile = (over: Partial<RouterProfile> = {}): RouterProfile =>
  ({
    identity: "test",
    boardName: "hAP lite",
    version: "7.23.2 (stable)",
    architecture: "smips",
    versionMajor: 7,
    versionMinor: 23,
    wirelessStack: "wireless",
    interfaces: [],
    addresses: [],
    capabilities: { hotspot: true, toolFetch: true, userRateLimit: true, userSharedUsers: true },
    warnings: [],
    compatibility: "compatible",
    ...over,
  }) as unknown as RouterProfile;

describe("radio menus per wireless stack", () => {
  test("legacy boards use /interface wireless with top-level properties", () => {
    const d = dialectFor(profile({ wirelessStack: "wireless" }));
    expect(d.radio).toEqual({
      menu: "/interface/wireless",
      ssidField: "ssid",
      modeField: "mode",
      // ap-bridge, not `ap` — `ap` is a legacy alias that does not bridge clients.
      modeValue: "ap-bridge",
      runningCheckField: "disable-running-check",
    });
  });

  test("wifiwave2 boards nest them under configuration.*", () => {
    const d = dialectFor(profile({ wirelessStack: "wifi" }));
    expect(d.radio).toEqual({
      menu: "/interface/wifi",
      ssidField: "configuration.ssid",
      modeField: "configuration.mode",
      modeValue: "ap",
      // No equivalent property on this stack.
      runningCheckField: null,
    });
  });

  test("a board with no radio has no radio dialect", () => {
    // hEX, CRS — the hotspot then runs on ethernet or a bridge the admin names explicitly.
    expect(dialectFor(profile({ wirelessStack: undefined })).radio).toBeNull();
  });
});

describe("disable-running-check", () => {
  /**
   * Only legacy `/interface wireless` has this. It matters because on that stack an AP in
   * `ap-bridge` mode reports `running=false` while it is beaconing to nobody, `/ip dhcp-server`
   * copies that flag into its own `invalid`, and a perfectly working hotspot reads as broken until
   * the first phone associates. Measured on an hAP lite (7.23.2) on 2026-08-12.
   */
  test("is offered on legacy wireless and withheld on wifiwave2", () => {
    expect(dialectFor(profile({ wirelessStack: "wireless" })).radio?.runningCheckField).toBe(
      "disable-running-check",
    );
    expect(dialectFor(profile({ wirelessStack: "wifi" })).radio?.runningCheckField).toBeNull();
  });
});

describe("user-level limits come from measured capabilities, not the version", () => {
  /**
   * `deriveCapabilities` guesses these from the RouterOS major version and that guess is wrong on
   * real hardware — an hAP lite on 7.23.2 rejects BOTH. `dialectFor` must read the capabilities,
   * never re-derive from the version, or the measured truth is discarded here.
   */
  test("a v7 board that rejects both is respected", () => {
    const d = dialectFor(
      profile({
        capabilities: {
          hotspot: true,
          toolFetch: true,
          userRateLimit: false,
          userSharedUsers: false,
        },
      } as Partial<RouterProfile>),
    );
    expect(d.userRateLimit).toBe(false);
    expect(d.userSharedUsers).toBe(false);
    expect(d.limitsAtProfileLevel).toBe(true);
  });

  test("a board that accepts both applies limits per user", () => {
    const d = dialectFor(profile());
    expect(d.userRateLimit).toBe(true);
    expect(d.userSharedUsers).toBe(true);
    expect(d.limitsAtProfileLevel).toBe(false);
  });
});
