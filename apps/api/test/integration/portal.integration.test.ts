import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { DEFAULT_PORTAL_SETTINGS } from "../../src/portal/portal-input.js";
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

async function admin(): Promise<Client> {
  await addStaff(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, "admin@example.com");
  return c;
}

const { updatedAt: _unsaved, ...SETTINGS } = DEFAULT_PORTAL_SETTINGS;

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#0f766e" } })
    .png()
    .toBuffer();
}

function upload(c: Client, kind: string, body: Buffer | string, type: string) {
  const bytes = typeof body === "string" ? body : new Uint8Array(body);
  return c.requestWith("POST", `/api/portal/images?kind=${kind}`, bytes, {
    Origin: FRONTEND_ORIGIN,
    "Content-Type": type,
  });
}

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
    expect((await upload(m, "logo", await png(10, 10), "image/png")).status).toBe(403);
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
      logoUrl: "https://tracker.example/logo.png",
    });
    expect(reply.status).toBe(400);
    expect(Object.keys((reply.body as { details: object }).details).sort()).toEqual([
      "brandName",
      "headline",
      "logoUrl",
      "primaryColor",
      "voucherPrefix",
    ]);
  });

  test("an uploaded image is re-encoded, served publicly, and must match its slot", async () => {
    const c = await admin();
    const uploaded = await upload(c, "logo", await png(900, 600), "image/png");
    expect(uploaded.status).toBe(201);
    const logo = uploaded.body as { id: string; url: string; kind: string };
    expect(logo).toMatchObject({ kind: "logo", url: `/api/portal/images/${logo.id}` });

    const served = await fetch(`${api.url}${logo.url}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("cache-control")).toContain("immutable");
    const meta = await sharp(Buffer.from(await served.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 400, 400]);

    const wrongSlot = await c.request("PUT", "/api/portal", {
      ...SETTINGS,
      backgroundImageUrl: logo.url,
    });
    expect(wrongSlot.body).toMatchObject({
      details: { backgroundImageUrl: "must be a background uploaded here" },
    });
    const missing = await c.request("PUT", "/api/portal", {
      ...SETTINGS,
      logoUrl: "/api/portal/images/01a18895-f25f-7622-b47d-8a428187786f",
    });
    expect(missing.status).toBe(400);
    expect((await c.request("PUT", "/api/portal", { ...SETTINGS, logoUrl: logo.url })).status).toBe(
      200,
    );
  });

  test("non-images, the wrong type and oversized bodies are refused", async () => {
    const c = await admin();
    const garbage = await upload(c, "logo", "not an image", "image/png");
    expect(garbage.status).toBe(400);
    expect(garbage.body).toMatchObject({ code: "INVALID_IMAGE" });
    const svg = await upload(c, "logo", "<svg/>", "image/svg+xml");
    expect(svg.status).toBe(415);
    const kind = await upload(c, "banner", await png(10, 10), "image/png");
    expect(kind.status).toBe(400);
    const huge = await upload(c, "logo", Buffer.alloc(11 * 1024 * 1024), "image/png");
    expect(huge.status).toBe(413);
    expect(huge.body).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(await t.db.portalImage.count()).toBe(0);
  });

  test("saving deletes images no longer used, but keeps recent unsaved uploads", async () => {
    const c = await admin();
    const old = (await upload(c, "logo", await png(50, 50), "image/png")).body as {
      url: string;
      id: string;
    };
    const fresh = (await upload(c, "logo", await png(60, 60), "image/png")).body as { id: string };
    const current = (await upload(c, "background", await png(80, 40), "image/png")).body as {
      url: string;
      id: string;
    };
    await t.db.portalImage.update({
      where: { id: old.id },
      data: { createdAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    await c.request("PUT", "/api/portal", { ...SETTINGS, backgroundImageUrl: current.url });
    const left = (await t.db.portalImage.findMany({ select: { id: true } })).map((i) => i.id);
    expect(left.sort()).toEqual([fresh.id, current.id].sort());
    expect((await fetch(`${api.url}${old.url}`)).status).toBe(404);
  });
});
