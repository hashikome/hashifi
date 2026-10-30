import { describe, expect, test } from "bun:test";
import { addStaff } from "../../src/staff/add-staff.js";
import {
  browser,
  type Client,
  enrollAuthenticatorFor,
  FRONTEND_ORIGIN,
  signInWithCode,
  useApi,
} from "./api.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();
const api = useApi();

/** A signed-in admin with an authenticator app. */
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

const VENUE = { name: "Home", city: "Dar es Salaam", region: "Dar es Salaam" };

describe("venues", () => {
  test("nobody signed in gets 401, and an admin without an authenticator 403", async () => {
    const anonymous = browser(api);
    const refused = await anonymous.request("GET", "/api/venues");
    expect(refused).toEqual({
      status: 401,
      body: { code: "SIGN_IN_REQUIRED", message: "Sign in to continue.", details: null },
    });

    await addStaff(t.db, { email: "new-admin@example.com", name: "New", role: "admin" });
    const unenrolled = browser(api);
    await signInWithCode(api, unenrolled, "new-admin@example.com");
    const held = await unenrolled.request("GET", "/api/venues");
    expect(held.status).toBe(403);
    expect(held.body).toMatchObject({ code: "TWO_FACTOR_ENROLLMENT_REQUIRED" });
  });

  test("an admin creates, reads, updates and deletes a venue, and each is audited", async () => {
    const c = await admin();
    const { id: operatorId } = await addStaff(t.db, {
      email: "op@example.com",
      name: "Operator",
      role: "manager",
    });
    const created = await c.request("POST", "/api/venues", {
      ...VENUE,
      contactEmail: "Front@Example.com",
      latitude: -6.7924,
      longitude: 39.2083,
      operatorId,
      postalCode: "",
    });
    expect(created.status).toBe(201);
    const venue = (created.body as { venue: Record<string, unknown> }).venue;
    expect(venue).toMatchObject({
      name: "Home",
      country: "Tanzania",
      contactEmail: "front@example.com",
      latitude: "-6.7924",
      postalCode: null,
      operatorId,
      routerCount: 0,
    });
    const id = String(venue.id);

    const list = await c.request("GET", "/api/venues");
    expect((list.body as { venues: unknown[] }).venues.length).toBe(1);

    const updated = await c.request("PUT", `/api/venues/${id}`, { ...VENUE, name: "Home 2" });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ venue: { name: "Home 2", operatorId: null } });

    expect((await c.request("DELETE", `/api/venues/${id}`)).status).toBe(204);
    expect((await c.request("GET", `/api/venues/${id}`)).status).toBe(404);
    const actions = (await t.db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map(
      (entry) => entry.action,
    );
    expect(actions).toEqual(["venue_created", "venue_updated", "venue_deleted"]);
  });

  test("a manager sees only their own venues, and cannot change any", async () => {
    const own = await manager("own@example.com");
    const other = await manager("other@example.com");
    const mine = await t.db.venue.create({ data: { ...VENUE, operatorId: own.id } });
    const theirs = await t.db.venue.create({
      data: { ...VENUE, name: "Theirs", operatorId: other.id },
    });

    const list = await own.client.request("GET", "/api/venues");
    expect((list.body as { venues: { id: string }[] }).venues.map((v) => v.id)).toEqual([mine.id]);
    expect((await own.client.request("GET", `/api/venues/${mine.id}`)).status).toBe(200);
    const hidden = await own.client.request("GET", `/api/venues/${theirs.id}`);
    expect(hidden.status).toBe(404);
    expect(hidden.body).toMatchObject({ code: "NOT_FOUND" });

    const edit = await own.client.request("PUT", `/api/venues/${mine.id}`, VENUE);
    expect(edit.status).toBe(403);
    expect((await own.client.request("POST", "/api/venues", VENUE)).status).toBe(403);
  });

  test("bad input names each field; ids that are not UUIDs are not found", async () => {
    const c = await admin();
    const bad = await c.request("POST", "/api/venues", {
      name: "Line\nbreak",
      city: "",
      latitude: 120,
      operatorId: "01a18895-f25f-7622-b47d-8a428187786f",
    });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        name: "must be one line of text",
        city: "is required",
        region: expect.any(String),
        latitude: expect.any(String),
      },
    });
    const noOperator = await c.request("POST", "/api/venues", {
      ...VENUE,
      operatorId: "01a18895-f25f-7622-b47d-8a428187786f",
    });
    expect(noOperator.body).toMatchObject({ details: { operatorId: "must be an active manager" } });
    expect((await c.request("GET", "/api/venues/not-a-uuid")).status).toBe(404);
  });

  test("a venue with routers cannot be deleted", async () => {
    const c = await admin();
    const venue = await t.db.venue.create({ data: VENUE });
    await t.db.router.create({
      data: { venueId: venue.id, name: "r1", ipAddress: "192.168.88.1" },
    });
    const refused = await c.request("DELETE", `/api/venues/${venue.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "VENUE_HAS_ROUTERS" });
  });

  test("a signed-in write from another site is refused", async () => {
    const c = await admin();
    const forged = await c.requestWith("POST", "/api/venues", "name=Evil&city=X&region=Y", {
      Origin: "https://evil.example",
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(forged.status).toBe(403);
    expect(forged.body).toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
    const missing = await c.requestWith("POST", "/api/venues", JSON.stringify(VENUE), {
      Origin: null,
      "Content-Type": "application/json",
    });
    expect(missing.status).toBe(403);
    const ours = await c.requestWith("POST", "/api/venues", JSON.stringify(VENUE), {
      Origin: FRONTEND_ORIGIN,
      "Content-Type": "application/json",
    });
    expect(ours.status).toBe(201);
    expect(await t.db.venue.count()).toBe(1);
  });
});
