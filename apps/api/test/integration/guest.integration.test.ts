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
    linkLogin: "http://10.5.50.1/login",
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
}

beforeEach(() => routerConfirms(true));

describe("the guest portal", () => {
  test("context names the venue, what it sells, and a login page rebuilt from the router", async () => {
    const { router } = await setting();
    const reply = await post("/api/guest/context", {
      router: router.id,
      mac: MAC,
      ip: "10.5.50.20",
      linkLogin: "http://10.5.50.1/login?extra=1",
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      venueName: "Home",
      loginUrl: "http://10.5.50.1/login",
      packages: [{ name: "Day", priceTsh: "2000.00" }],
    });
  });

  test("a link-login that is not this router's is refused (finding 1)", async () => {
    const { router } = await setting();
    for (const linkLogin of [
      "javascript:alert(1)",
      "https://evil.example/login",
      "http://10.9.9.9/login",
      "not a url",
    ]) {
      const reply = await redeem(router.id, { linkLogin });
      expect({ linkLogin, code: reply.body.code }).toEqual({
        linkLogin,
        code: "UNKNOWN_LOGIN_PAGE",
      });
    }
    expect((await t.db.voucher.findFirstOrThrow()).status).toBe("unused");
  });

  test("a custom hotspot network's gateway is accepted, and the default then is not", async () => {
    const { router } = await setting();
    await t.db.router.update({ where: { id: router.id }, data: { networkRange: "10.7.0.0/24" } });
    expect((await redeem(router.id, { linkLogin: "http://10.7.0.1/login" })).status).toBe(200);
    const old = await redeem(router.id, { linkLogin: "http://10.5.50.1/login" });
    expect(old.body.code).toBe("UNKNOWN_LOGIN_PAGE");
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
    expect(done).toEqual({
      status: 200,
      body: {
        loginUrl: "http://10.5.50.1/login",
        code: "WIFI-TESTCODE",
        dst: "http://example.com/a?b=1",
      },
    });
    const active = await t.db.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
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

  test("session status needs the code, never just a MAC address", async () => {
    const { router } = await setting();
    await redeem(router.id);
    const reply = await post("/api/guest/session", { code: "wifi-testcode" });
    expect(reply.body).toMatchObject({
      active: true,
      data: { unlimited: true, usedBytes: 0 },
      time: { unlimited: false },
    });
    expect(JSON.stringify(reply.body)).not.toContain("WIFI-");
    expect((await post("/api/guest/session", { code: "WRONG" })).body.active).toBe(false);
    expect((await post("/api/guest/session", { mac: MAC })).status).toBe(400);
    const preflight = await fetch(`${api.url}/api/guest/session`, { method: "OPTIONS" });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("guessing codes at session status is limited too", async () => {
    const { router } = await setting();
    await redeem(router.id);
    for (let i = 0; i < 60; i++) await post("/api/guest/session", { code: `GUESS-${i}` });
    const right = await post("/api/guest/session", { code: "WIFI-TESTCODE" });
    expect(right.body.active).toBe(false);
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
    const refused = await fetch(`${api.url}/portal/hotspot-files/${router.id}/config.txt`);
    expect(refused.status).toBe(404);
  });
});
