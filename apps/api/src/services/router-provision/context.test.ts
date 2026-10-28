import { describe, expect, test } from "bun:test";
import { buildHotspotPlan, isRadioInterfaceType, resolveHotspotInterface } from "./context.js";
import type { RouterProfile } from "./probe.js";

/**
 * The LAN-hijack guard.
 *
 * `resolveHotspotInterface` once matched only interface type `wlan` and fell through to the first
 * enabled bridge. Every wifiwave2 board reports type `wifi`, so on all of them the hotspot gateway
 * and a captive portal landed on `bridgeLocal` — the LAN. Refusing to provision is always the right
 * answer here, because a wrong interface is worse than no hotspot.
 */

type Iface = { name: string; type: string; disabled: boolean };

const profileWith = (
  interfaces: Iface[],
  addresses: { address: string; interface: string }[] = [],
): RouterProfile =>
  ({
    identity: "test",
    boardName: "hAP lite",
    version: "7.23.2 (stable)",
    architecture: "smips",
    versionMajor: 7,
    versionMinor: 23,
    wirelessStack: interfaces.some((i) => i.type === "wlan") ? "wireless" : "wifi",
    interfaces,
    addresses,
    capabilities: {
      hotspot: true,
      toolFetch: true,
      userRateLimit: true,
      userSharedUsers: true,
    },
    warnings: [],
    compatibility: "compatible",
  }) as unknown as RouterProfile;

const router = (over: Record<string, unknown> = {}) =>
  ({
    ipAddress: "192.168.0.161",
    hotspotInterface: null,
    networkRange: null,
    hotspotGatewayIp: null,
    hotspotName: null,
    ssid: null,
    ...over,
  }) as Parameters<typeof resolveHotspotInterface>[0];

describe("radio interface types", () => {
  test.each(["wlan", "wifi", "wifiwave2"])("%s is a radio", (type: string) => {
    expect(isRadioInterfaceType(type)).toBe(true);
  });

  test.each(["ether", "bridge", "loopback", "vlan", "pwr-line"])(
    "%s is not a radio",
    (type: string) => {
      expect(isRadioInterfaceType(type)).toBe(false);
    },
  );
});

describe("resolveHotspotInterface", () => {
  test("picks the legacy radio", () => {
    const p = profileWith([
      { name: "ether1", type: "ether", disabled: false },
      { name: "bridgeLocal", type: "bridge", disabled: false },
      { name: "wlan1", type: "wlan", disabled: false },
    ]);
    expect(resolveHotspotInterface(router(), p)).toBe("wlan1");
  });

  test.each(["wifi", "wifiwave2"])("picks a %s radio, never the bridge", (type: string) => {
    // The original bug: type was not `wlan`, so it fell through to `bridgeLocal` and put a
    // captive portal on the LAN.
    const p = profileWith([
      { name: "bridgeLocal", type: "bridge", disabled: false },
      { name: "wifi1", type, disabled: false },
    ]);
    expect(resolveHotspotInterface(router(), p)).toBe("wifi1");
  });

  test("accepts a disabled radio — provisioning enables it", () => {
    const p = profileWith([
      { name: "bridgeLocal", type: "bridge", disabled: false },
      { name: "wlan1", type: "wlan", disabled: true },
    ]);
    expect(resolveHotspotInterface(router(), p)).toBe("wlan1");
  });

  test("prefers an enabled radio over a disabled one", () => {
    const p = profileWith([
      { name: "wlan1", type: "wlan", disabled: true },
      { name: "wlan2", type: "wlan", disabled: false },
    ]);
    expect(resolveHotspotInterface(router(), p)).toBe("wlan2");
  });

  test("refuses to guess on a board with no radio", () => {
    // hEX, CRS. The admin must name an interface; a bridge fallback would be the LAN.
    const p = profileWith([
      { name: "ether1", type: "ether", disabled: false },
      { name: "bridgeLocal", type: "bridge", disabled: false },
    ]);
    expect(() => resolveHotspotInterface(router(), p)).toThrow();
  });

  test("never falls back to a bridge even when one is the only enabled interface", () => {
    const p = profileWith([{ name: "bridgeLocal", type: "bridge", disabled: false }]);
    expect(() => resolveHotspotInterface(router(), p)).toThrow();
  });

  test("honours an explicitly named interface", () => {
    const p = profileWith([
      { name: "ether5", type: "ether", disabled: false },
      { name: "wlan1", type: "wlan", disabled: false },
    ]);
    expect(resolveHotspotInterface(router({ hotspotInterface: "ether5" }), p)).toBe("ether5");
  });

  test("a typo'd interface name is rejected and the real names are listed", () => {
    const p = profileWith([{ name: "wlan1", type: "wlan", disabled: false }]);
    try {
      resolveHotspotInterface(router({ hotspotInterface: "wlan0" }), p);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("wlan1");
    }
  });

  test("refuses the interface carrying the router's management address", () => {
    // Putting the hotspot there cuts off the API connection managing the router.
    const p = profileWith(
      [
        { name: "bridgeLocal", type: "bridge", disabled: false },
        { name: "wlan1", type: "wlan", disabled: false },
      ],
      [{ address: "192.168.0.161/24", interface: "bridgeLocal" }],
    );
    expect(() => resolveHotspotInterface(router({ hotspotInterface: "bridgeLocal" }), p)).toThrow();
  });

  test("refuses a disabled non-radio — nothing can enable an ethernet port", () => {
    const p = profileWith([
      { name: "ether5", type: "ether", disabled: true },
      { name: "wlan1", type: "wlan", disabled: false },
    ]);
    expect(() => resolveHotspotInterface(router({ hotspotInterface: "ether5" }), p)).toThrow();
  });
});

describe("buildHotspotPlan", () => {
  const radioProfile = profileWith(
    [
      { name: "bridgeLocal", type: "bridge", disabled: false },
      { name: "wlan1", type: "wlan", disabled: false },
    ],
    [{ address: "192.168.0.161/24", interface: "bridgeLocal" }],
  );

  test("defaults to 10.5.50.0/24 with a matching gateway and pool", () => {
    const plan = buildHotspotPlan(router(), radioProfile);
    expect(plan.network).toBe("10.5.50.0/24");
    expect(plan.gatewayIp).toBe("10.5.50.1");
    expect(plan.gatewayCidr).toBe("10.5.50.1/24");
    expect(plan.poolRange).toBe("10.5.50.10-10.5.50.254");
    expect(plan.interface).toBe("wlan1");
    expect(plan.interfaceIsRadio).toBe(true);
  });

  test("rejects a network overlapping an address the router already holds", () => {
    // The router is on 192.168.0.161/24; a hotspot there would collide with the management LAN.
    expect(() => buildHotspotPlan(router({ networkRange: "192.168.0.0/24" }), radioProfile)).toThrow();
  });

  test("allows a network that overlaps only the hotspot interface's own address", () => {
    // Re-provisioning must stay idempotent: the gateway we assigned last time is not a conflict.
    const p = profileWith(
      [
        { name: "bridgeLocal", type: "bridge", disabled: false },
        { name: "wlan1", type: "wlan", disabled: false },
      ],
      [
        { address: "192.168.0.161/24", interface: "bridgeLocal" },
        { address: "10.5.50.1/24", interface: "wlan1" },
      ],
    );
    expect(() => buildHotspotPlan(router({ networkRange: "10.5.50.0/24" }), p)).not.toThrow();
  });

  test("carries the SSID through when one is stored, and null when not", () => {
    expect(buildHotspotPlan(router({ ssid: "VenueWiFi" }), radioProfile).ssid).toBe("VenueWiFi");
    expect(buildHotspotPlan(router(), radioProfile).ssid).toBeNull();
  });
});
