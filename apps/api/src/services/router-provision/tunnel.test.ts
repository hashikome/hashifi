import { describe, expect, test } from "bun:test";
import { buildBootstrapScript } from "./bootstrap.js";
import { generateWireguardKeyPair, type ManagementTunnel, TUNNEL_INTERFACE } from "./tunnel.js";

const keys = generateWireguardKeyPair();
const server = generateWireguardKeyPair();

const TUNNEL: ManagementTunnel = {
  routerPrivateKey: keys.privateKey,
  routerAddress: "10.88.0.2/24",
  serverPublicKey: server.publicKey,
  serverAddress: "10.88.0.1",
  // A long host name, so the line-length check is meaningful.
  endpointHost: `${"tunnel".repeat(8)}.platform.hashikome.com`,
  endpointPort: 51820,
};

const script = buildBootstrapScript({
  routerName: "A".repeat(60),
  ipAddress: "192.168.0.161",
  gatewayIp: "192.168.0.1",
  apiUsername: "hashifi",
  apiPort: 8728,
  apiPassword: "p".repeat(64),
  tunnel: TUNNEL,
}).script;

const statements = script
  .split("\n")
  .filter((l) => l.trim() !== "" && !l.trimStart().startsWith("#"));

describe("WireGuard keys", () => {
  test("are 32-byte keys in the base64 form wg prints", () => {
    for (const key of [keys.privateKey, keys.publicKey]) {
      expect(key).toMatch(/^[A-Za-z0-9+/]{43}=$/);
      expect(Buffer.from(key, "base64")).toHaveLength(32);
    }
  });

  test("differ on every call", () => {
    expect(generateWireguardKeyPair().privateKey).not.toBe(keys.privateKey);
  });
});

describe("the bootstrap brings the management tunnel up", () => {
  test("every statement still fits the console's line limit", () => {
    for (const line of statements) expect(line.length).toBeLessThanOrEqual(512);
  });

  test("creates the interface, its address and the platform peer", () => {
    expect(script).toContain(`/interface wireguard add name=${TUNNEL_INTERFACE}`);
    expect(script).toContain(`/ip address add address=10.88.0.2/24 interface=${TUNNEL_INTERFACE}`);
    expect(script).toContain(`public-key="${server.publicKey}"`);
    expect(script).toContain("allowed-address=10.88.0.1/32");
  });

  test("keeps the NAT mapping open, because only the router can open the path", () => {
    expect(script).toContain("persistent-keepalive=25s");
  });

  test("accepts API connections only from the platform's tunnel address", () => {
    expect(script).toContain("/ip service set api disabled=no port=8728 address=10.88.0.1/32");
  });

  test("is safe to paste twice: each tunnel statement checks first or only sets values", () => {
    for (const line of statements.filter((l) => l.includes(TUNNEL_INTERFACE))) {
      expect(
        line.startsWith(":if ([:len [") || line.startsWith("/interface wireguard peers set"),
      ).toBe(true);
    }
  });

  test("a router reached on its LAN gets no tunnel and an unrestricted API", () => {
    const lan = buildBootstrapScript({
      routerName: "lan",
      ipAddress: "192.168.0.161",
      apiUsername: "hashifi",
      apiPort: 8728,
      apiPassword: "x".repeat(24),
      tunnel: null,
    }).script;
    expect(lan).not.toContain("wireguard");
    expect(lan).toContain("/ip service set api disabled=no port=8728\n");
  });
});
