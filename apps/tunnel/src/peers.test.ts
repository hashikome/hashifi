import { describe, expect, test } from "bun:test";
import { parsePeers, peerChanges, relayPath } from "./peers.js";

const key = (c: string) => `${c.repeat(43)}=`;

describe("the tunnel's peers", () => {
  test("only the difference changes, so a live router's tunnel is left alone", () => {
    const wanted = [
      { publicKey: key("a"), address: "10.88.0.2" },
      { publicKey: key("b"), address: "10.88.0.3" },
    ];
    expect(peerChanges([key("a"), key("c")], wanted)).toEqual({
      add: [wanted[1]],
      remove: [key("c")],
    });
  });

  test("a value that could reach a command line is refused", () => {
    expect(() =>
      parsePeers({ peers: [{ publicKey: "x; rm -rf /", address: "10.88.0.2" }] }),
    ).toThrow();
    expect(() => parsePeers({ peers: [{ publicKey: key("a"), address: "1; reboot" }] })).toThrow();
    expect(() => parsePeers(null)).toThrow();
    expect(parsePeers({ peers: [] })).toEqual([]);
  });

  test("only a router's own pages pass through", () => {
    expect(relayPath(`/portal/hotspot-files/${"a".repeat(36)}/login.html`)).toBe(true);
    expect(relayPath("/api/me")).toBe(false);
    expect(relayPath(`/portal/hotspot-files/${"a".repeat(36)}/../../api/me`)).toBe(false);
  });
});
