import { describe, expect, test } from "bun:test";
import { addStaff } from "../../src/staff/add-staff.js";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();
const api = useApi();

async function admin(): Promise<Client> {
  await addStaff(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, "admin@example.com");
  return c;
}

async function manager(email: string): Promise<{ client: Client; id: string }> {
  const { id } = await addStaff(t.db, { email, name: email, role: "manager" });
  const client = browser(api);
  expect((await signInWithCode(api, client, email)).status).toBe(200);
  return { client, id };
}

let macs = 0;

/**
 * Two venues, a manager for the first, and one phone seen at both: 1 GB down at the manager's
 * venue, 4 GB at the other, connected now only at the other.
 */
async function world() {
  const own = await manager("own@example.com");
  const mine = await t.db.venue.create({ data: { name: "Home", city: "Dar", operatorId: own.id } });
  const theirs = await t.db.venue.create({ data: { name: "Other", city: "Arusha" } });
  macs += 1;
  const mac = `AA:BB:CC:00:00:${String(macs).padStart(2, "0")}`;
  const phone = await t.db.device.create({ data: { macAddress: mac, deviceName: "Pixel" } });
  const only = await t.db.device.create({ data: { macAddress: `${mac.slice(0, -2)}FF` } });
  const voucher = await t.db.voucher.create({
    data: {
      venueId: theirs.id,
      code: `LIVE-${macs}`,
      status: "active",
      durationMinutes: 60,
      priceTsh: "1000",
    },
  });
  const session = (
    venueId: string,
    deviceId: string,
    status: "connected" | "disconnected",
    gb: number,
  ) =>
    t.db.wifiSession.create({
      data: {
        venueId,
        deviceId,
        macAddress: mac,
        status,
        downloadBytes: BigInt(gb) * 1_073_741_824n,
        ...(status === "connected" ? { voucherId: voucher.id } : {}),
      },
    });
  const atMine = await session(mine.id, phone.id, "disconnected", 1);
  const atTheirs = await session(theirs.id, phone.id, "connected", 4);
  await session(theirs.id, only.id, "disconnected", 2);
  return { own, mine, theirs, phone, only, atMine, atTheirs };
}

type Body = Record<string, unknown>;

describe("devices", () => {
  test("a manager sees a device only as their venues saw it", async () => {
    const w = await world();
    const list = (await w.own.client.request("GET", "/api/devices")).body as {
      devices: Body[];
      stats: Body;
    };
    expect(list.devices.map((d) => d.id)).toEqual([w.phone.id]);
    expect(list.devices[0]).toMatchObject({
      downloadBytes: 1_073_741_824,
      // Connected, but at someone else's venue.
      isOnline: false,
      deviceName: "Pixel",
    });
    expect(list.stats).toEqual({ total: 1, online: 0, offline: 1, blocked: 0 });
    expect((await w.own.client.request("GET", `/api/devices/${w.only.id}`)).status).toBe(404);

    const all = (await (await admin()).request("GET", "/api/devices")).body as {
      devices: Body[];
      stats: Body;
    };
    expect(all.stats).toEqual({ total: 2, online: 1, offline: 1, blocked: 0 });
    const phone = all.devices.find((d) => d.id === w.phone.id);
    expect(phone).toMatchObject({ downloadBytes: 5 * 1_073_741_824, isOnline: true });
  });

  test("search and status filters, a page at a time", async () => {
    const w = await world();
    const c = await admin();
    const online = (await c.request("GET", "/api/devices?status=online")).body as {
      devices: Body[];
    };
    expect(online.devices.map((d) => d.id)).toEqual([w.phone.id]);
    const found = (await c.request("GET", "/api/devices?search=pixel")).body as { devices: Body[] };
    expect(found.devices.map((d) => d.id)).toEqual([w.phone.id]);
    const page = (await c.request("GET", "/api/devices?limit=1")).body as {
      devices: Body[];
      nextBefore: string;
    };
    expect(page.devices).toHaveLength(1);
    const next = (await c.request("GET", `/api/devices?limit=1&before=${page.nextBefore}`))
      .body as { devices: Body[]; nextBefore: string | null };
    expect(next.devices).toHaveLength(1);
    expect(next.nextBefore).toBeNull();
  });

  test("blocking ends the device's sessions everywhere; only admins block or delete", async () => {
    const w = await world();
    const path = `/api/devices/${w.phone.id}`;
    expect(
      (await w.own.client.request("PUT", `${path}/status`, { status: "blocked" })).status,
    ).toBe(403);
    expect((await w.own.client.request("DELETE", path)).status).toBe(403);

    const c = await admin();
    const blocked = await c.request("PUT", `${path}/status`, { status: "blocked" });
    expect(blocked.body).toMatchObject({ device: { status: "blocked", isOnline: false } });
    expect(
      await t.db.wifiSession.findUniqueOrThrow({ where: { id: w.atTheirs.id } }),
    ).toMatchObject({ status: "terminated", terminationReason: "device_blocked" });
    const stats = ((await c.request("GET", "/api/devices")).body as { stats: Body }).stats;
    expect(stats).toEqual({ total: 2, online: 0, offline: 1, blocked: 1 });

    expect((await c.request("PUT", `${path}/status`, { status: "active" })).body).toMatchObject({
      device: { status: "active" },
    });
    expect((await c.request("DELETE", path)).status).toBe(204);
    // The sessions stay, unlinked from the forgotten device.
    expect(await t.db.wifiSession.count({ where: { deviceId: null } })).toBe(2);
    const actions = (await t.db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(["device_blocked", "device_unblocked", "device_deleted"]);
    expect(JSON.stringify(await t.db.auditLog.findMany())).not.toContain("AA:BB");
  });
});

describe("sessions", () => {
  test("a manager lists and reads only their venues' sessions, with totals over them", async () => {
    const w = await world();
    const list = (await w.own.client.request("GET", "/api/sessions")).body as {
      sessions: Body[];
      stats: Body;
    };
    expect(list.sessions.map((s) => s.id)).toEqual([w.atMine.id]);
    expect(list.stats).toEqual({
      total: 1,
      connected: 0,
      uploadBytes: 0,
      downloadBytes: 1_073_741_824,
    });
    expect(list.sessions[0]).toMatchObject({ venueName: "Home", deviceId: w.phone.id });
    expect((await w.own.client.request("GET", `/api/sessions/${w.atTheirs.id}`)).status).toBe(404);

    const c = await admin();
    const connected = (await c.request("GET", "/api/sessions?status=connected")).body as {
      sessions: Body[];
      stats: Body;
    };
    expect(connected.sessions).toHaveLength(1);
    expect(connected.sessions[0]).toMatchObject({ voucherCode: expect.stringMatching(/^LIVE-/) });
    const byDevice = (await c.request("GET", `/api/sessions?deviceId=${w.phone.id}`)).body as {
      stats: Body;
    };
    expect(byDevice.stats).toMatchObject({ total: 2, downloadBytes: 5 * 1_073_741_824 });
  });

  test("terminating ends a connected session once, within the manager's venues", async () => {
    const w = await world();
    const theirs = await w.own.client.request("POST", `/api/sessions/${w.atTheirs.id}/terminate`);
    expect(theirs.status).toBe(404);

    const live = await t.db.wifiSession.create({
      data: {
        venueId: w.mine.id,
        deviceId: w.phone.id,
        macAddress: "AA:BB:CC:00:00:99",
        status: "connected",
        startedAt: new Date(Date.now() - 90_000),
      },
    });
    const ended = await w.own.client.request("POST", `/api/sessions/${live.id}/terminate`);
    expect(ended.status).toBe(200);
    expect(ended.body).toMatchObject({
      session: { status: "terminated", terminationReason: "staff_disconnect" },
    });
    const seconds = (ended.body as { session: { durationSeconds: number } }).session
      .durationSeconds;
    expect(seconds).toBeGreaterThanOrEqual(89);
    const again = await w.own.client.request("POST", `/api/sessions/${live.id}/terminate`);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "SESSION_NOT_ACTIVE" });
    expect((await t.db.auditLog.findMany()).map((a) => a.action)).toEqual(["session_terminated"]);
  });
});
