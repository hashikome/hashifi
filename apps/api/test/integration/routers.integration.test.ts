import { describe, expect, test } from "bun:test";
import { addStaff } from "../../src/staff/add-staff.js";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();
// Nothing listens on port 9, so a router here is unreachable at once.
const api = useApi({ MIKROTIK_API_PORT: "9", MIKROTIK_CONNECT_TIMEOUT: "2" });

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

async function venue(operatorId: string | null = null) {
  return t.db.venue.create({
    data: { name: "Home", city: "Dar es Salaam", region: "Dar es Salaam", operatorId },
  });
}

const ROUTER = { name: "Lobby", ipAddress: "127.0.0.1", apiUsername: "hashifi" };

type Body = Record<string, unknown>;
const routerOf = (reply: { body: unknown }) => (reply.body as { router: Body }).router;

describe("routers", () => {
  test("an admin adds, reads, replaces and deletes a router; no secret leaves", async () => {
    const c = await admin();
    const v = await venue();
    const created = await c.request("POST", "/api/routers", {
      ...ROUTER,
      venueId: v.id,
      apiPassword: "s3cret-Pass",
      macAddress: "aa-bb-cc-dd-ee-ff",
      provisioningCommand: "/system note set note=hi",
    });
    expect(created.status).toBe(201);
    const router = routerOf(created);
    expect(router).toMatchObject({
      venueName: "Home",
      hasApiPassword: true,
      macAddress: "AA:BB:CC:DD:EE:FF",
      status: "offline",
      provisioningCommand: "/system note set note=hi",
    });
    const id = String(router.id);

    // Left empty, the stored password is kept.
    const replaced = await c.request("PUT", `/api/routers/${id}`, {
      ...ROUTER,
      venueId: v.id,
      name: "Lobby 2",
      apiPassword: "",
    });
    expect(routerOf(replaced)).toMatchObject({ name: "Lobby 2", hasApiPassword: true });

    for (const reply of [
      created,
      replaced,
      await c.request("GET", "/api/routers"),
      await c.request("GET", `/api/routers/${id}`),
    ]) {
      const text = JSON.stringify(reply.body);
      expect(text).not.toContain("s3cret-Pass");
      expect(text).not.toContain("Encrypted");
      expect(text).not.toContain("v1:");
    }

    const moved = await c.request("PUT", `/api/routers/${id}`, {
      ...ROUTER,
      venueId: (await venue()).id,
    });
    expect(moved.status).toBe(400);
    expect(moved.body).toMatchObject({ details: { venueId: expect.any(String) } });

    expect((await c.request("DELETE", `/api/routers/${id}`)).status).toBe(204);
    expect((await c.request("GET", `/api/routers/${id}`)).status).toBe(404);
  });

  test("status, versions and tunnels cannot be set by a request", async () => {
    const c = await admin();
    const v = await venue();
    const created = await c.request("POST", "/api/routers", {
      ...ROUTER,
      venueId: v.id,
      status: "online",
      tunnelAddress: "10.88.0.9",
      rosVersion: "7.99",
    });
    expect(routerOf(created)).toMatchObject({
      status: "offline",
      tunnelAddress: null,
      rosVersion: null,
    });
  });

  test("a manager sees only their venues' routers, and nothing that changes one", async () => {
    const own = await manager("own@example.com");
    const other = await manager("other@example.com");
    const mine = await t.db.router.create({
      data: { ...ROUTER, venueId: (await venue(own.id)).id, provisioningCommand: "/x" },
    });
    const theirs = await t.db.router.create({
      data: { ...ROUTER, venueId: (await venue(other.id)).id },
    });

    const list = await own.client.request("GET", "/api/routers");
    const routers = (list.body as { routers: Body[] }).routers;
    expect(routers.map((r) => r.id)).toEqual([mine.id]);
    expect(routers[0]?.provisioningCommand).toBeNull();
    const filtered = await own.client.request("GET", `/api/routers?venueId=${theirs.venueId}`);
    expect((filtered.body as { routers: Body[] }).routers).toEqual([]);
    expect((await own.client.request("GET", `/api/routers/${theirs.id}`)).status).toBe(404);

    for (const [method, path] of [
      ["POST", "/api/routers"],
      ["PUT", `/api/routers/${mine.id}`],
      ["DELETE", `/api/routers/${mine.id}`],
      ["POST", `/api/routers/${mine.id}/sync`],
      ["POST", `/api/routers/${mine.id}/bootstrap-script`],
      ["POST", `/api/routers/${mine.id}/probe`],
      ["POST", `/api/routers/${mine.id}/verify`],
      ["POST", `/api/routers/${mine.id}/setup`],
      ["POST", `/api/routers/${mine.id}/provision`],
      ["GET", `/api/routers/${mine.id}/provision/latest`],
      ["POST", "/api/routers/test-connection"],
    ] as const) {
      const reply = await own.client.request(method, path, method === "GET" ? null : {});
      expect({ method, path, status: reply.status }).toEqual({ method, path, status: 403 });
    }
  });

  test("the backlog counts only the caller's venues", async () => {
    const own = await manager("own@example.com");
    const mine = await venue(own.id);
    const theirs = await venue();
    const now = new Date();
    for (const venueId of [mine.id, theirs.id, theirs.id]) {
      await t.db.voucher.create({
        data: {
          venueId,
          code: `CODE${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          status: "pending_activation",
          activatedAt: now,
          durationMinutes: 60,
          priceTsh: "1000",
        },
      });
    }
    const backlog = await own.client.request("GET", "/api/routers/provisioning-backlog");
    expect(backlog.body).toEqual({ stuckVouchers: 1, unprovisionedPayments: 0 });
    const all = await (await admin()).request("GET", "/api/routers/provisioning-backlog");
    expect(all.body).toEqual({ stuckVouchers: 3, unprovisionedPayments: 0 });
  });

  test("the bootstrap script keeps one API password, and has no tunnel without one configured", async () => {
    const c = await admin();
    const v = await venue();
    const id = String(
      routerOf(await c.request("POST", "/api/routers", { ...ROUTER, venueId: v.id })).id,
    );
    const first = await c.requestWith("POST", `/api/routers/${id}/bootstrap-script`, "{}", {
      Origin: "http://localhost:4000",
      "Content-Type": "application/json",
    });
    expect(first.status).toBe(200);
    const script = first.body as {
      script: string;
      tunnel: boolean;
      resolved: { apiPassword: string; apiPasswordGenerated: boolean };
    };
    expect(script.tunnel).toBe(false);
    expect(script.resolved.apiPassword.length).toBeGreaterThan(15);
    expect(script.script).toContain(script.resolved.apiPassword);

    const second = (await c.request("POST", `/api/routers/${id}/bootstrap-script`, {})).body as {
      resolved: { apiPassword: string };
    };
    expect(second.resolved.apiPassword).toBe(script.resolved.apiPassword);
    expect(routerOf(await c.request("GET", `/api/routers/${id}`)).hasApiPassword).toBe(true);
  });

  test("a router that cannot be reached is a 502 naming why, within the connect timeout", async () => {
    const c = await admin();
    const v = await venue();
    const router = await t.db.router.create({ data: { ...ROUTER, venueId: v.id } });
    const noCredentials = await c.request("POST", `/api/routers/${router.id}/probe`, {});
    expect(noCredentials.body).toMatchObject({ code: "ROUTER_NO_CREDENTIALS" });

    await c.request("PUT", `/api/routers/${router.id}`, {
      ...ROUTER,
      venueId: v.id,
      apiPassword: "pw",
    });
    const started = Date.now();
    const probe = await c.request("POST", `/api/routers/${router.id}/probe`, {});
    expect(probe.status).toBe(502);
    expect(probe.body).toMatchObject({ code: "ROUTER_UNREACHABLE" });
    expect(Date.now() - started).toBeLessThan(5_000);

    const tested = await c.request("POST", "/api/routers/test-connection", {
      ipAddress: "127.0.0.1",
      apiUsername: "hashifi",
      apiPassword: "pw",
    });
    expect(tested.status).toBe(200);
    expect(tested.body).toMatchObject({ ok: false, kind: "unreachable" });
  });

  test("testing a connection needs every credential: none is taken from a saved router", async () => {
    const c = await admin();
    const v = await venue();
    const router = await t.db.router.create({ data: { ...ROUTER, venueId: v.id } });
    const reply = await c.request("POST", "/api/routers/test-connection", {
      routerId: router.id,
      ipAddress: "203.0.113.50",
      apiUsername: "hashifi",
    });
    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ details: { apiPassword: expect.any(String) } });
  });
});
