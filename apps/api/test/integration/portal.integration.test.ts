import { describe, expect, test } from "bun:test";
import { DEFAULT_PORTAL_SETTINGS } from "../../src/portal/portal-input.js";
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

const { updatedAt: _unsaved, ...SETTINGS } = DEFAULT_PORTAL_SETTINGS;

describe("portal settings", () => {
  test("defaults until saved; then the whole branding, audited, for any staff to read", async () => {
    const c = await admin();
    const first = await c.request("GET", "/api/portal");
    expect(first.body).toEqual({ settings: DEFAULT_PORTAL_SETTINGS });

    const saved = await c.request("PUT", "/api/portal", {
      ...SETTINGS,
      brandName: "Home WiFi",
      voucherPrefix: "home",
      message: "Line one\nLine two",
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      settings: { brandName: "Home WiFi", voucherPrefix: "HOME", message: "Line one\nLine two" },
    });
    await c.request("PUT", "/api/portal", { ...SETTINGS, brandName: "Again" });
    expect(await t.db.portalSetting.count()).toBe(1);

    await addStaff(t.db, { email: "m@example.com", name: "M", role: "manager" });
    const m = browser(api);
    await signInWithCode(api, m, "m@example.com");
    expect((await m.request("GET", "/api/portal")).body).toMatchObject({
      settings: { brandName: "Again" },
    });
    expect((await m.request("PUT", "/api/portal", SETTINGS)).status).toBe(403);
    const actions = (await t.db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(["portal_updated", "portal_updated"]);
  });

  test("bad branding is refused field by field", async () => {
    const c = await admin();
    const reply = await c.request("PUT", "/api/portal", {
      ...SETTINGS,
      brandName: "",
      primaryColor: "red",
      headline: "Two\nlines",
      voucherPrefix: "A-B",
      // Not a field any more: unknown fields are ignored, never stored.
      logoUrl: "https://tracker.example/logo.png",
    });
    expect(reply.status).toBe(400);
    expect(Object.keys((reply.body as { details: object }).details).sort()).toEqual([
      "brandName",
      "headline",
      "primaryColor",
      "voucherPrefix",
    ]);
  });
});
