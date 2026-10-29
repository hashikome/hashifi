import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { SecretBox } from "../../src/crypto/secret-box.js";
import { TunnelAllocator } from "../../src/routers/tunnel-allocator.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();
const box = new SecretBox(randomBytes(32));

async function routers(count: number): Promise<string[]> {
  const venue = await t.db.venue.create({ data: { name: "Venue", city: "Arusha" } });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = await t.db.router.create({
      data: { venueId: venue.id, name: `r${i}`, ipAddress: `192.168.0.${10 + i}` },
    });
    ids.push(r.id);
  }
  return ids;
}

describe("tunnel allocation", () => {
  test("each router gets its own address after the platform's, and keeps it", async () => {
    const allocator = new TunnelAllocator(t.db, box, { network: "10.88.0.0/16" });
    expect(allocator.platformAddress).toBe("10.88.0.1");
    const [a, b] = await routers(2);
    if (!a || !b) throw new Error("no routers");
    const first = await allocator.allocate(a);
    const second = await allocator.allocate(b);
    expect([first.routerAddress, second.routerAddress]).toEqual(["10.88.0.2", "10.88.0.3"]);
    // Regenerating the bootstrap returns the same keys, so the pasted key stays valid.
    const again = await allocator.allocate(a);
    expect(again).toEqual(first);
  });

  test("the private key is stored sealed, never in clear", async () => {
    const [id] = await routers(1);
    if (!id) throw new Error("no router");
    const tunnel = await new TunnelAllocator(t.db, box, { network: "10.88.0.0/16" }).allocate(id);
    const row = await t.db.router.findUniqueOrThrow({ where: { id } });
    expect(row.tunnelPrivateKeyEncrypted).toMatch(/^v1:/);
    expect(row.tunnelPrivateKeyEncrypted).not.toContain(tunnel.routerPrivateKey);
    expect(box.open(row.tunnelPrivateKeyEncrypted ?? "")).toBe(tunnel.routerPrivateKey);
  });

  test("concurrent allocations never share an address", async () => {
    const allocator = new TunnelAllocator(t.db, box, { network: "10.88.0.0/16" });
    const ids = await routers(8);
    const tunnels = await Promise.all(ids.map((id) => allocator.allocate(id)));
    expect(new Set(tunnels.map((x) => x.routerAddress)).size).toBe(8);
  });

  test("a full network says so", async () => {
    // A /29 holds .2 to .6 for routers.
    const allocator = new TunnelAllocator(t.db, box, { network: "10.99.0.0/29" });
    const ids = await routers(6);
    for (const id of ids.slice(0, 5)) await allocator.allocate(id);
    const last = ids[5];
    if (!last) throw new Error("no router");
    await expect(allocator.allocate(last)).rejects.toThrow(/full/);
  });
});
