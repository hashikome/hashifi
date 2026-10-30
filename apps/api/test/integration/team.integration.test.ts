import { describe, expect, test } from "bun:test";
import { addStaff } from "../../src/staff/add-staff.js";
import {
  browser,
  type Client,
  enrollAuthenticatorFor,
  signInWithCode,
  totp,
  useApi,
} from "./api.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();
const api = useApi();

let admins = 0;

/** A signed-in admin with an authenticator app. */
async function admin(): Promise<{ client: Client; id: string; email: string; uri: string }> {
  admins += 1;
  const email = `admin${admins}@example.com`;
  const { id } = await addStaff(t.db, { email, name: `Admin ${admins}`, role: "admin" });
  const client = browser(api);
  const uri = await enrollAuthenticatorFor(api, client, email);
  return { client, id, email, uri };
}

type Member = Record<string, unknown> & { id: string };
const memberOf = (reply: { body: unknown }) => (reply.body as { member: Member }).member;
const sentTo = (to: string) => api.email.sent.filter((m) => m.to === to).map((m) => m.subject);

async function settle() {
  await Bun.sleep(50);
}

describe("team", () => {
  test("an admin adds a manager with venues; the manager is told and can sign in", async () => {
    const a = await admin();
    const home = await t.db.venue.create({ data: { name: "Home", city: "Dar" } });
    const cafe = await t.db.venue.create({ data: { name: "Cafe", city: "Dar" } });
    const created = await a.client.request("POST", "/api/team", {
      name: "Neema",
      email: "Neema@Example.com",
      phone: "0712 345 678",
      role: "manager",
      venueIds: [home.id, cafe.id],
    });
    expect(created.status).toBe(201);
    expect(memberOf(created)).toMatchObject({
      email: "neema@example.com",
      phone: "+255712345678",
      role: "manager",
      status: "active",
      twoFactorEnabled: false,
      venues: [
        { id: cafe.id, name: "Cafe" },
        { id: home.id, name: "Home" },
      ],
    });
    await settle();
    expect(sentTo("neema@example.com")).toContain("You have been added to HashiFi");
    const m = browser(api);
    expect((await signInWithCode(api, m, "neema@example.com")).status).toBe(200);
    const venues = (await m.request("GET", "/api/venues")).body as { venues: unknown[] };
    expect(venues.venues).toHaveLength(2);

    const taken = await a.client.request("POST", "/api/team", {
      name: "Again",
      email: "neema@example.com",
      role: "manager",
    });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: "EMAIL_TAKEN" });
    const adminWithVenue = await a.client.request("POST", "/api/team", {
      name: "X",
      email: "x@example.com",
      role: "admin",
      venueIds: [home.id],
    });
    expect(adminWithVenue.body).toMatchObject({ details: { venueIds: expect.any(String) } });
    const badPhone = await a.client.request("POST", "/api/team", {
      name: "Y",
      email: "y@example.com",
      role: "manager",
      phone: "12345",
    });
    expect(badPhone.body).toMatchObject({
      details: { phone: "must be a Tanzanian mobile number" },
    });

    expect((await m.request("GET", "/api/team")).status).toBe(403);
  });

  test("changing an email signs in at the new one and tells the old one", async () => {
    const a = await admin();
    const { id } = await addStaff(t.db, { email: "old@example.com", name: "Old", role: "manager" });
    const reply = await a.client.request("PUT", `/api/team/${id}`, {
      name: "New Name",
      email: "new@example.com",
    });
    expect(memberOf(reply)).toMatchObject({ name: "New Name", email: "new@example.com" });
    await settle();
    expect(sentTo("old@example.com")).toContain("Your HashiFi sign-in email has changed");
    expect((await signInWithCode(api, browser(api), "new@example.com")).status).toBe(200);
  });

  test("suspending signs someone out at once, and reactivating lets them back", async () => {
    const a = await admin();
    const { id } = await addStaff(t.db, { email: "m@example.com", name: "M", role: "manager" });
    const m = browser(api);
    await signInWithCode(api, m, "m@example.com");
    const suspended = await a.client.request("PUT", `/api/team/${id}/status`, {
      status: "suspended",
    });
    expect(memberOf(suspended)).toMatchObject({ status: "suspended" });
    expect(await t.db.session.count({ where: { userId: id } })).toBe(0);
    expect((await m.request("GET", "/api/me")).status).toBe(401);

    await a.client.request("PUT", `/api/team/${id}/status`, { status: "active" });
    expect((await signInWithCode(api, m, "m@example.com")).status).toBe(200);
    await settle();
    expect(sentTo("m@example.com")).toEqual(
      expect.arrayContaining([
        "Your HashiFi account is suspended",
        "Your HashiFi account is active again",
      ]),
    );
  });

  test("HashiFi always keeps an active admin, and nobody acts on themselves", async () => {
    const a = await admin();
    for (const [method, path, body] of [
      ["PUT", `/api/team/${a.id}/role`, { role: "manager" }],
      ["PUT", `/api/team/${a.id}/status`, { status: "suspended" }],
      ["POST", `/api/team/${a.id}/reset-authenticator`, {}],
      ["DELETE", `/api/team/${a.id}`, null],
    ] as const) {
      const reply = await a.client.request(method, path, body);
      expect({ path, status: reply.status, body: reply.body }).toMatchObject({
        path,
        status: 409,
        body: { code: "NOT_ON_YOURSELF" },
      });
    }
  });

  test("two admins demoting each other at once leave one admin", async () => {
    const a = await admin();
    const b = await admin();
    const replies = await Promise.all([
      a.client.request("PUT", `/api/team/${b.id}/role`, { role: "manager" }),
      b.client.request("PUT", `/api/team/${a.id}/role`, { role: "manager" }),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(replies.find((r) => r.status === 409)?.body).toMatchObject({ code: "LAST_ADMIN" });
    expect(await t.db.staff.count({ where: { role: "admin", status: "active" } })).toBe(1);
  });

  test("two admins suspending each other at once leave one admin", async () => {
    const a = await admin();
    const b = await admin();
    const replies = await Promise.all([
      a.client.request("PUT", `/api/team/${b.id}/status`, { status: "suspended" }),
      b.client.request("PUT", `/api/team/${a.id}/status`, { status: "suspended" }),
    ]);
    // The second may also find its actor already suspended (401): either way, one stays.
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await t.db.staff.count({ where: { role: "admin", status: "active" } })).toBe(1);
  });

  test("promoting frees the venues and requires an authenticator; resetting one signs out", async () => {
    const a = await admin();
    const home = await t.db.venue.create({ data: { name: "Home", city: "Dar" } });
    const { id } = await addStaff(t.db, { email: "p@example.com", name: "P", role: "manager" });
    await a.client.request("PUT", `/api/team/${id}`, {
      name: "P",
      email: "p@example.com",
      venueIds: [home.id],
    });
    const promoted = await a.client.request("PUT", `/api/team/${id}/role`, { role: "admin" });
    expect(memberOf(promoted)).toMatchObject({ role: "admin", venues: [] });
    const p = browser(api);
    await signInWithCode(api, p, "p@example.com");
    expect((await p.request("GET", "/api/venues")).body).toMatchObject({
      code: "TWO_FACTOR_ENROLLMENT_REQUIRED",
    });

    const b = await admin();
    const reset = await a.client.request("POST", `/api/team/${b.id}/reset-authenticator`);
    expect(memberOf(reset)).toMatchObject({ twoFactorEnabled: false });
    expect(await t.db.twoFactor.count({ where: { userId: b.id } })).toBe(0);
    expect((await b.client.request("GET", "/api/me")).status).toBe(401);
    // Their old authenticator no longer matters: signing in now asks them to enroll again.
    const again = browser(api);
    const signedIn = await signInWithCode(api, again, b.email);
    expect(signedIn.body).not.toMatchObject({ twoFactorRedirect: true });
    expect((await again.request("GET", "/api/me")).body).toMatchObject({
      twoFactorEnrollmentRequired: true,
    });
    expect(totp(b.uri)).toMatch(/^\d{6}$/);
  });

  test("removing someone deletes their sign-in and frees their venues; the audit trail stays", async () => {
    const a = await admin();
    const home = await t.db.venue.create({ data: { name: "Home", city: "Dar" } });
    const created = memberOf(
      await a.client.request("POST", "/api/team", {
        name: "Gone",
        email: "gone@example.com",
        role: "manager",
        venueIds: [home.id],
      }),
    );
    expect((await a.client.request("DELETE", `/api/team/${created.id}`)).status).toBe(204);
    expect(await t.db.user.count({ where: { email: "gone@example.com" } })).toBe(0);
    expect((await t.db.venue.findUniqueOrThrow({ where: { id: home.id } })).operatorId).toBeNull();

    const audit = (await a.client.request("GET", "/api/audit?entityType=team_member")).body as {
      entries: { action: string; actorName: string; entityName: string | null }[];
    };
    expect(audit.entries.map((e) => e.action)).toEqual(["member_removed", "member_created"]);
    expect(audit.entries[0]).toMatchObject({
      actorName: a.email.replace(/@.*/, "").replace("admin", "Admin "),
      entityName: "Gone",
    });
  });
});
