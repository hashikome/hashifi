import { beforeEach, describe, expect, test } from "bun:test";
import { RouterSync } from "../../src/services/router-sync.js";
import { useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();
const api = useApi({ ROUTER_MANAGEMENT_URL: "http://10.0.2.2:8080" });

const MAC = "AA:BB:CC:00:00:01";

async function setting(deviceLimit = 1) {
  const venue = await t.db.venue.create({ data: { name: "Home", city: "Dar" } });
  const router = await t.db.router.create({
    data: { venueId: venue.id, name: "Lobby", ipAddress: "192.168.88.2" },
  });
  const pkg = await t.db.package.create({
    data: {
      name: "Day",
      durationMinutes: 1440,
      downloadSpeedMbps: 10,
      priceTsh: 2000,
      deviceLimit,
    },
  });
  const voucher = await t.db.voucher.create({
    data: {
      venueId: venue.id,
      packageId: pkg.id,
      code: "WIFI-TESTCODE",
      durationMinutes: 1440,
      priceTsh: 2000,
    },
  });
  return { venue, router, pkg, voucher };
}

function post(path: string, body: unknown) {
  return fetch(`${api.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));
}

function redeem(routerId: string, changes: Record<string, unknown> = {}) {
  return post("/api/guest/redeem", {
    router: routerId,
    mac: MAC,
    ip: "10.5.50.20",
    code: "wifi-testcode",
    ...changes,
  });
}

/** The router answers as told: no real router in these tests. */
function routerConfirms(ok: boolean) {
  const sync = api.app.get(RouterSync);
  sync.ensureVoucher = async () => ({
    attempted: 1,
    succeeded: ok ? 1 : 0,
    failures: ok ? [] : [{ router: "Lobby", error: "unreachable" }],
  });
  sync.deviceOnNetwork = async () => true;
  sync.signInDevice = async () => true;
}

beforeEach(() => routerConfirms(true));

describe("the guest portal", () => {
  test("context names the venue and what it sells", async () => {
    const { router } = await setting();
    const reply = await post("/api/guest/context", {
      router: router.id,
      mac: MAC,
      ip: "10.5.50.20",
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      venueName: "Home",
      packages: [{ name: "Day", priceTsh: "2000.00" }],
    });
  });

  test("a device the router does not see is refused before the voucher's clock starts", async () => {
    const { router, voucher } = await setting();
    const sync = api.app.get(RouterSync);
    sync.deviceOnNetwork = async () => false;
    const absent = await redeem(router.id);
    expect(absent.status).toBe(400);
    expect(absent.body.code).toBe("DEVICE_NOT_ON_NETWORK");
    sync.deviceOnNetwork = async () => null;
    expect((await redeem(router.id)).body.code).toBe("ROUTER_NOT_CONFIRMED");
    expect(await t.db.voucher.findUniqueOrThrow({ where: { id: voucher.id } })).toMatchObject({
      status: "unused",
      activatedAt: null,
    });
  });

  test("a wrong code never reaches the router", async () => {
    const { router } = await setting();
    const sync = api.app.get(RouterSync);
    let asked = 0;
    sync.deviceOnNetwork = async () => {
      asked += 1;
      return true;
    };
    await redeem(router.id, { code: "WRONG" });
    expect(asked).toBe(0);
  });

  test("the voucher goes active only once the router reports the device online", async () => {
    const { router, voucher } = await setting();
    const sync = api.app.get(RouterSync);
    sync.signInDevice = async () => false;
    const refused = await redeem(router.id);
    expect(refused.status).toBe(503);
    expect(refused.body.code).toBe("ROUTER_NOT_CONFIRMED");
    const row = await t.db.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(row.status).toBe("pending_activation");
    let signedIn: unknown = null;
    sync.signInDevice = async (_router, client) => {
      signedIn = client;
      return true;
    };
    expect((await redeem(router.id)).status).toBe(200);
    expect(signedIn).toEqual({ user: "WIFI-TESTCODE", ip: "10.5.50.20", mac: MAC });
  });

  test("redeeming starts the voucher only once the router confirms it", async () => {
    const { router, voucher } = await setting();
    routerConfirms(false);
    const waiting = await redeem(router.id);
    expect(waiting.status).toBe(503);
    expect(waiting.body.code).toBe("ROUTER_NOT_CONFIRMED");
    const pending = await t.db.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(pending.status).toBe("pending_activation");

    routerConfirms(true);
    const done = await redeem(router.id, { linkOrig: "http://example.com/a?code=WIFI-X&b=1" });
    const active = await t.db.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(done).toEqual({
      status: 200,
      body: { dst: "http://example.com/a?b=1", expiresAt: active.expiresAt?.toISOString() },
    });
    expect(active.status).toBe("active");
    expect(active.activatedAt).toEqual(pending.activatedAt);
    const hours = ((active.expiresAt?.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(await t.db.wifiSession.count()).toBe(0);
  });

  test("a voucher from another venue is refused before its clock starts", async () => {
    const { voucher } = await setting();
    const other = await t.db.venue.create({ data: { name: "Other", city: "Arusha" } });
    const elsewhere = await t.db.router.create({
      data: { venueId: other.id, name: "Elsewhere", ipAddress: "192.168.1.2" },
    });
    const reply = await redeem(elsewhere.id);
    expect(reply.body.code).toBe("INVALID_VOUCHER");
    expect((await t.db.voucher.findUniqueOrThrow({ where: { id: voucher.id } })).status).toBe(
      "unused",
    );
  });

  test("finished vouchers say why", async () => {
    const { router, voucher } = await setting();
    for (const [status, code] of [
      ["revoked", "VOUCHER_REVOKED"],
      ["used", "VOUCHER_USED"],
      ["expired", "VOUCHER_EXPIRED"],
    ] as const) {
      await t.db.voucher.update({ where: { id: voucher.id }, data: { status } });
      expect((await redeem(router.id)).body.code).toBe(code);
    }
  });

  test("the device limit holds, also for two devices at once; a known device returns", async () => {
    const { router } = await setting(1);
    const replies = await Promise.all([
      redeem(router.id, { mac: "AA:BB:CC:00:00:02" }),
      redeem(router.id, { mac: "AA:BB:CC:00:00:03" }),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 403]);
    expect(replies.find((r) => r.status === 403)?.body.code).toBe("DEVICE_LIMIT_REACHED");
    expect(await t.db.voucherDevice.count()).toBe(1);
    const winner = await t.db.device.findFirstOrThrow({
      where: { vouchers: { some: {} } },
    });
    expect((await redeem(router.id, { mac: winner.macAddress })).status).toBe(200);
  });

  test("a blocked device is refused, and a MAC address is compared whatever its case", async () => {
    const { router } = await setting();
    await t.db.device.create({ data: { macAddress: MAC, status: "blocked" } });
    const reply = await redeem(router.id, { mac: MAC.toLowerCase() });
    expect(reply.status).toBe(403);
    expect(reply.body.code).toBe("DEVICE_BLOCKED");
  });

  test("wrong codes are limited per device, without counting right ones", async () => {
    const { router } = await setting();
    for (let i = 0; i < 10; i++) {
      expect((await redeem(router.id, { code: `WRONG-${i}` })).status).toBe(400);
    }
    const limited = await redeem(router.id, { code: "WRONG-X" });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("TOO_MANY_ATTEMPTS");
    const other = await redeem(router.id, { mac: "AA:BB:CC:00:00:09" });
    expect(other.status).toBe(200);
  });

  test("an unknown router and malformed values are refused", async () => {
    const reply = await redeem("01a18895-f25f-7622-b47d-8a428187786f");
    expect(reply.status).toBe(404);
    const { router } = await setting();
    expect((await redeem(router.id, { mac: "<script>" })).status).toBe(400);
    expect((await redeem(router.id, { ip: "x" })).status).toBe(400);
  });

  test("session status answers for a device on a voucher, and never with its code", async () => {
    const { router } = await setting();
    const session = (mac: string, id: string = router.id) =>
      post("/api/guest/session", { router: id, mac });
    expect((await session(MAC)).body.active).toBe(false);
    await redeem(router.id);
    const reply = await session(MAC);
    expect(reply.body).toMatchObject({
      active: true,
      data: { unlimited: true, usedBytes: 0 },
      time: { unlimited: false },
    });
    expect(JSON.stringify(reply.body)).not.toContain("WIFI-");
    expect((await session("02:00:00:00:00:01")).body.active).toBe(false);
    const elsewhere = await t.db.venue.create({ data: { name: "Other", city: "Arusha" } });
    const other = await t.db.router.create({
      data: { name: "Other", ipAddress: "10.9.0.1", venueId: elsewhere.id },
    });
    expect((await session(MAC, other.id)).body.active).toBe(false);
    expect((await post("/api/guest/session", { code: "WIFI-TESTCODE" })).status).toBe(400);
    const preflight = await fetch(`${api.url}/api/guest/session`, { method: "OPTIONS" });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("a router's pages carry its id and the portal's address, and nothing secret", async () => {
    const { router } = await setting();
    const page = await fetch(`${api.url}/portal/hotspot-files/${router.id}/login.html`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`/portal/login#router=${router.id}`);
    expect(html).not.toContain("?mac=");
    expect(html).not.toContain("__ROUTER_ID__");
    expect(html).toContain("$(link-orig-esc)");
    expect(html).not.toContain("<form");
    const status = await fetch(`${api.url}/portal/hotspot-files/${router.id}/status.html`);
    expect(await status.text()).toContain(`router: "${router.id}"`);
    const refused = await fetch(`${api.url}/portal/hotspot-files/${router.id}/config.txt`);
    expect(refused.status).toBe(404);
  });
});
