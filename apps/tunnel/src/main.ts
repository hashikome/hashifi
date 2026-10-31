import { readFileSync } from "node:fs";
import { parsePeers, peerChanges, relayPath, relayResponse } from "./peers.js";

/**
 * The platform's end of the routers' management tunnel (ADR-0006). It runs on the host's network,
 * so the API's traffic to a router leaves through `wg0` from the platform's tunnel address, the
 * only one a router accepts. Peers come from the API, so adding a router needs no shell.
 */
const INTERFACE = "wg0";
const SYNC_MS = 20_000;

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "") throw new Error(`${name} is required`);
  return value;
}

const portalOrigin = required("PORTAL_ORIGIN");
const address = required("TUNNEL_ADDRESS");
const keyFile = required("TUNNEL_PRIVATE_KEY_FILE");
const syncSecret = readFileSync(required("TUNNEL_SYNC_SECRET_FILE"), "utf8").trim();
if (syncSecret === "") throw new Error("TUNNEL_SYNC_SECRET_FILE points to an empty secret file");
const port = process.env.TUNNEL_PORT ?? "51820";

function run(...command: string[]): string {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${command.slice(0, 2).join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

function bringUp(): void {
  // A restart finds the interface the last run left on the host.
  Bun.spawnSync(["ip", "link", "del", INTERFACE], { stderr: "ignore" });
  run("ip", "link", "add", INTERFACE, "type", "wireguard");
  run("ip", "address", "add", address, "dev", INTERFACE);
  run("wg", "set", INTERFACE, "listen-port", port, "private-key", keyFile);
  run("ip", "link", "set", INTERFACE, "up");
}

async function syncPeers(): Promise<void> {
  const response = await fetch(`${portalOrigin}/api/internal/tunnel-peers`, {
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${syncSecret}`, "User-Agent": "hashifi-tunnel" },
  });
  if (!response.ok) throw new Error(`Peer list: HTTP ${response.status}`);
  const wanted = parsePeers(await response.json());
  const output = run("wg", "show", INTERFACE, "peers");
  const { add, remove } = peerChanges(output === "" ? [] : output.split("\n"), wanted);
  for (const key of remove) run("wg", "set", INTERFACE, "peer", key, "remove");
  for (const peer of add) {
    run("wg", "set", INTERFACE, "peer", peer.publicKey, "allowed-ips", `${peer.address}/32`);
  }
}

bringUp();
// A failed sync keeps the tunnels up: the routers already connected are still right.
const sync = () =>
  syncPeers().catch((err: unknown) =>
    console.error(err instanceof Error ? err.message : "Peer sync failed"),
  );
await sync();
setInterval(sync, SYNC_MS);

// Reached only from the tunnel: it listens on the tunnel address alone.
Bun.serve({
  hostname: address.split("/")[0],
  port: 8080,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method !== "GET" || !relayPath(pathname)) {
      return new Response(null, { status: 404 });
    }
    const upstream = await fetch(`${portalOrigin}${pathname}`, {
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "hashifi-tunnel" },
    });
    return relayResponse(upstream);
  },
});
