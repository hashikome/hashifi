import { describe, expect, test } from "bun:test";
import { addStaff } from "../../src/staff/add-staff.js";
import {
  Client,
  enrollAuthenticatorFor,
  requestSignInCode,
  signInWithCode,
  totp,
  useApi,
} from "./api.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();
const api = useApi();

let nextIp = 1;
/** A fresh client address, so the per-address rate limits stay out of the way. */
function client(): Client {
  nextIp += 1;
  return new Client(() => api.url, `203.0.113.${nextIp % 250}`);
}

const requestCode = (c: Client, email: string) => requestSignInCode(c, email);
const signIn = (c: Client, email: string) => signInWithCode(api, c, email);
const enrollAuthenticator = (c: Client, email: string) => enrollAuthenticatorFor(api, c, email);

describe("sign-in", () => {
  test("an email code signs active staff in", async () => {
    await addStaff(t.db, { email: "Manager@Example.com", name: "Manager", role: "manager" });
    const c = client();
    expect((await c.request("GET", "/api/me")).status).toBe(401);
    expect((await signIn(c, "manager@example.com")).status).toBe(200);
    const me = await c.request("GET", "/api/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      email: "manager@example.com",
      role: "manager",
      twoFactorEnabled: false,
      twoFactorEnrollmentRequired: false,
    });
    expect((await t.db.staff.findFirstOrThrow()).lastLoginAt).not.toBeNull();

    expect((await c.request("POST", "/api/auth/sign-out", {})).status).toBe(200);
    expect((await c.request("GET", "/api/me")).status).toBe(401);
  });

  test("a stranger's email gets the same answers as staff, and no email", async () => {
    await addStaff(t.db, { email: "staff@example.com", name: "Staff", role: "manager" });
    const staff = await requestCode(client(), "staff@example.com");
    const stranger = await requestCode(client(), "stranger@example.com");
    expect(stranger).toEqual(staff);
    await Bun.sleep(100);
    expect(api.email.sent.some((m) => m.to === "stranger@example.com")).toBe(false);

    const wrongForStaff = await client().request("POST", "/api/auth/sign-in/email-otp", {
      email: "staff@example.com",
      otp: "000000",
    });
    const anyForStranger = await client().request("POST", "/api/auth/sign-in/email-otp", {
      email: "stranger@example.com",
      otp: "000000",
    });
    expect(anyForStranger).toEqual(wrongForStaff);
    expect(anyForStranger.status).toBe(400);
  });

  test("codes are stored keyed, never as sent", async () => {
    await addStaff(t.db, { email: "keyed@example.com", name: "Keyed", role: "manager" });
    const before = api.email.sent.length;
    await requestCode(client(), "keyed@example.com");
    const code = await api.email.codeFor("keyed@example.com", before);
    const stored = await t.db.verification.findMany();
    expect(stored.length).toBe(1);
    expect(stored.some((v) => v.value.includes(code))).toBe(false);
  });

  test("after five wrong codes the right one no longer works", async () => {
    await addStaff(t.db, { email: "guess@example.com", name: "Guess", role: "manager" });
    const before = api.email.sent.length;
    await requestCode(client(), "guess@example.com");
    const otp = await api.email.codeFor("guess@example.com", before);
    const wrong = otp === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) {
      const attempt = await client().request("POST", "/api/auth/sign-in/email-otp", {
        email: "guess@example.com",
        otp: wrong,
      });
      expect(attempt.status).toBe(400);
    }
    const right = await client().request("POST", "/api/auth/sign-in/email-otp", {
      email: "guess@example.com",
      otp,
    });
    expect(right.status).not.toBe(200);
  });

  test("one address may request three codes a minute", async () => {
    const c = client();
    for (let i = 0; i < 3; i++) {
      expect((await requestCode(c, "nobody@example.com")).status).toBe(200);
    }
    expect((await requestCode(c, "nobody@example.com")).status).toBe(429);
  });

  test("one person receives at most five codes in fifteen minutes, from any address", async () => {
    await addStaff(t.db, { email: "flood@example.com", name: "Flood", role: "manager" });
    for (let i = 0; i < 7; i++) {
      expect((await requestCode(client(), "flood@example.com")).status).toBe(200);
    }
    await Bun.sleep(200);
    expect(api.email.sent.filter((m) => m.to === "flood@example.com").length).toBe(5);
  });

  test("requests beyond the budget do not void the last code sent", async () => {
    await addStaff(t.db, { email: "target@example.com", name: "Target", role: "manager" });
    for (let i = 0; i < 5; i++) await requestCode(client(), "target@example.com");
    const fifth = await api.email.codeFor("target@example.com");
    await Bun.sleep(100);
    const flood = await requestCode(client(), "target@example.com");
    expect(flood).toEqual(await requestCode(client(), "nobody-else@example.com"));
    await requestCode(client(), "target@example.com");
    const signedIn = await client().request("POST", "/api/auth/sign-in/email-otp", {
      email: "target@example.com",
      otp: fifth,
    });
    expect(signedIn.status).toBe(200);
  });

  test("suspending a person ends their session and stops their codes", async () => {
    const { id } = await addStaff(t.db, {
      email: "leaver@example.com",
      name: "Leaver",
      role: "manager",
    });
    const c = client();
    expect((await signIn(c, "leaver@example.com")).status).toBe(200);
    await t.db.staff.update({ where: { id }, data: { status: "suspended" } });
    expect((await c.request("GET", "/api/me")).status).toBe(401);

    const before = api.email.sent.length;
    expect((await requestCode(client(), "leaver@example.com")).status).toBe(200);
    await Bun.sleep(100);
    expect(api.email.sent.length).toBe(before);
  });

  test("only the sign-in routes HashiFi uses are reachable", async () => {
    const c = client();
    const routes: [string, string, unknown][] = [
      ["POST", "/api/auth/sign-up/email", { email: "x@example.com", password: "p", name: "x" }],
      ["POST", "/api/auth/sign-in/email", { email: "x@example.com", password: "p" }],
      ["POST", "/api/auth/two-factor/disable", {}],
      ["POST", "/api/auth/update-user", { name: "x" }],
      ["POST", "/api/auth/email-otp/verify-email", { email: "x@example.com", otp: "1" }],
    ];
    for (const [method, path, body] of routes) {
      expect((await c.request(method, path, body)).status).toBe(404);
    }
    const reset = await c.request("POST", "/api/auth/email-otp/send-verification-otp", {
      email: "x@example.com",
      type: "forget-password",
    });
    expect(reset.status).toBe(400);
  });
});

describe("my profile", () => {
  test("anyone changes their own name, and only that", async () => {
    await addStaff(t.db, { email: "me@example.com", name: "Old", role: "manager" });
    const c = client();
    await signIn(c, "me@example.com");
    const reply = await c.request("PUT", "/api/me", { name: "  New Name ", role: "admin" });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ name: "New Name", role: "manager" });
    expect((await c.request("GET", "/api/me")).body).toMatchObject({ name: "New Name" });
    expect((await c.request("PUT", "/api/me", { name: "" })).status).toBe(400);
  });
});

describe("authenticator app", () => {
  test("an admin without one is told to set it up", async () => {
    await addStaff(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
    const c = client();
    expect((await signIn(c, "admin@example.com")).status).toBe(200);
    const me = await c.request("GET", "/api/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ role: "admin", twoFactorEnrollmentRequired: true });
  });

  test("once set up, sign-in needs both codes, and no device skips the second", async () => {
    await addStaff(t.db, { email: "owner@example.com", name: "Owner", role: "admin" });
    const first = client();
    const uri = await enrollAuthenticator(first, "owner@example.com");
    const enrolled = await first.request("GET", "/api/me");
    expect(enrolled.body).toMatchObject({
      twoFactorEnabled: true,
      twoFactorEnrollmentRequired: false,
    });
    const again = await first.request("POST", "/api/auth/two-factor/enable", {});
    expect(again.status).toBe(400);

    const c = client();
    const challenged = await signIn(c, "owner@example.com");
    expect(challenged.body).toMatchObject({ twoFactorRedirect: true });
    expect((await c.request("GET", "/api/me")).status).toBe(401);
    const wrong = await c.request("POST", "/api/auth/two-factor/verify-totp", { code: "000000" });
    expect(wrong.status).toBe(401);
    const verified = await c.request("POST", "/api/auth/two-factor/verify-totp", {
      code: totp(uri),
      trustDevice: true,
    });
    expect(verified.status).toBe(200);
    expect((await c.request("GET", "/api/me")).status).toBe(200);
    const trusted = await t.db.verification.count({
      where: { identifier: { startsWith: "trust-device-" } },
    });
    expect(trusted).toBe(0);

    // Asked to trust this browser, HashiFi still asks for the authenticator next time.
    await c.request("POST", "/api/auth/sign-out", {});
    expect((await signIn(c, "owner@example.com")).body).toMatchObject({ twoFactorRedirect: true });
    expect((await c.request("GET", "/api/me")).status).toBe(401);
  });
});
