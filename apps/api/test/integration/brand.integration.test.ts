import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DEFAULT_PORTAL_SETTINGS } from "../../src/portal/portal-input.js";
import { addStaff } from "../../src/staff/add-staff.js";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();
const api = useApi({ BRAND_STORE_DIR: join(tmpdir(), `hashifi-brand-${Date.now()}`) });

const { isActive: _active, updatedAt: _updated, ...SETTINGS } = DEFAULT_PORTAL_SETTINGS;

async function admin(): Promise<Client> {
  await addStaff(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, "admin@example.com");
  return c;
}

async function venue(name = "Cafe") {
  return t.db.venue.create({ data: { name, city: "Dar" } });
}

/** A PNG with transparency, and metadata that must not survive. */
const png = async (width = 600, alpha = 0) =>
  new Uint8Array(
    await sharp({
      create: { width, height: width, channels: 4, background: { r: 200, g: 0, b: 0, alpha } },
    })
      .withExif({ IFD0: { Copyright: "secret-location" } })
      .png()
      .toBuffer(),
  );

function upload(c: Client, id: string, kind: string, body: Uint8Array<ArrayBuffer>) {
  return c.requestWith("PUT", `/api/venues/${id}/brand/images/${kind}`, body, {
    Origin: "http://localhost:4000",
    "Content-Type": "application/octet-stream",
  });
}

const logoUrlOf = (reply: { body: unknown }) =>
  (reply.body as { brand: { logoUrl: string } }).brand.logoUrl;

describe("venue branding", () => {
  test("a venue shows the HashiFi default until it sets its own, and can go back", async () => {
    const c = await admin();
    const cafe = await venue();
    const before = await c.request("GET", `/api/venues/${cafe.id}/brand`);
    expect(before.body).toMatchObject({
      isCustom: false,
      brand: { brandName: "HashiFi", logoUrl: null },
    });

    const saved = await c.request("PUT", `/api/venues/${cafe.id}/brand`, {
      ...SETTINGS,
      brandName: "Cafe WiFi",
      voucherPrefix: "cafe",
    });
    expect(saved.body).toMatchObject({
      isCustom: true,
      brand: { brandName: "Cafe WiFi", voucherPrefix: "CAFE" },
    });
    const other = await venue("Other");
    expect((await c.request("GET", `/api/venues/${other.id}/brand`)).body).toMatchObject({
      brand: { brandName: "HashiFi" },
    });

    const reset = await c.request("DELETE", `/api/venues/${cafe.id}/brand`);
    expect(reset.body).toMatchObject({ isCustom: false, brand: { brandName: "HashiFi" } });
    const actions = (await t.db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(["brand_updated", "brand_reset"]);
  });

  test("a logo is re-encoded, keeps its transparency, loses its metadata, and is served", async () => {
    const c = await admin();
    const cafe = await venue();
    const reply = await upload(c, cafe.id, "logo", await png());
    expect(reply.status).toBe(200);
    const logoUrl = logoUrlOf(reply);
    expect(logoUrl).toMatch(new RegExp(`^/api/guest/brand/${cafe.id}/logo-[0-9a-f]{16}\\.webp$`));

    const served = await fetch(`${api.url}${logoUrl}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("cache-control")).toContain("immutable");
    const bytes = Buffer.from(await served.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 256, height: 256, hasAlpha: true });
    expect(meta.exif).toBeUndefined();
    expect(bytes.includes("secret-location")).toBe(false);
  });

  test("replacing a logo gives it a new address, and removes the old file", async () => {
    const c = await admin();
    const cafe = await venue();
    const first = await upload(c, cafe.id, "logo", await png());
    const url = logoUrlOf(first);
    const second = await upload(c, cafe.id, "logo", await png(400, 1));
    const next = logoUrlOf(second);
    expect(next).not.toBe(url);
    await Bun.sleep(50);
    expect((await fetch(`${api.url}${url}`)).status).toBe(404);
    expect((await fetch(`${api.url}${next}`)).status).toBe(200);
  });

  test("what is not an accepted image is refused, whatever it claims to be", async () => {
    const c = await admin();
    const cafe = await venue();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    for (const text of [svg, "not an image"]) {
      const body = new TextEncoder().encode(text);
      const reply = await upload(c, cafe.id, "logo", body);
      expect(reply.status).toBe(400);
      expect(reply.body).toMatchObject({ code: "INVALID_IMAGE" });
    }
    const huge = await upload(c, cafe.id, "logo", new Uint8Array(8 * 1024 * 1024 + 1));
    expect(huge.status).toBe(413);
    expect((await upload(c, cafe.id, "favicon", await png())).status).toBe(404);
    expect(await t.db.venueBrand.count()).toBe(0);
  });

  test("a manager brands their own venues; another's is not found", async () => {
    await admin();
    const mine = await venue("Mine");
    const theirs = await venue("Theirs");
    const { id } = await addStaff(t.db, { email: "m@example.com", name: "M", role: "manager" });
    await t.db.venue.update({ where: { id: mine.id }, data: { operatorId: id } });
    const m = browser(api);
    await signInWithCode(api, m, "m@example.com");
    const body = { ...SETTINGS, brandName: "Mine" };
    expect((await m.request("PUT", `/api/venues/${mine.id}/brand`, body)).status).toBe(200);
    for (const [method, path] of [
      ["GET", `/api/venues/${theirs.id}/brand`],
      ["PUT", `/api/venues/${theirs.id}/brand`],
      ["DELETE", `/api/venues/${theirs.id}/brand`],
    ] as const) {
      expect((await m.request(method, path, method === "PUT" ? body : null)).status).toBe(404);
    }
    expect((await upload(m, theirs.id, "logo", await png())).status).toBe(404);
    expect((await m.request("PUT", "/api/portal", DEFAULT_PORTAL_SETTINGS)).status).toBe(403);
  });

  test("the guest route serves only names it makes", async () => {
    const cafe = await venue();
    for (const file of ["..%2F..%2Fsecret", "logo.webp", "logo-abc.png"]) {
      const reply = await fetch(`${api.url}/api/guest/brand/${cafe.id}/${file}`);
      expect(reply.status).toBe(404);
    }
    expect((await fetch(`${api.url}/api/guest/brand/not-a-uuid/logo.webp`)).status).toBe(404);
  });

  test("a batch takes its venue's prefix, and the portal shows the venue's brand", async () => {
    const c = await admin();
    const cafe = await venue();
    const router = await t.db.router.create({
      data: { venueId: cafe.id, name: "Lobby", ipAddress: "192.168.88.2" },
    });
    await c.request("PUT", `/api/venues/${cafe.id}/brand`, {
      ...SETTINGS,
      brandName: "Cafe WiFi",
      voucherPrefix: "CAFE",
    });
    await upload(c, cafe.id, "background", await png());
    const reply = await fetch(`${api.url}/api/guest/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ router: router.id, mac: "02:00:00:00:00:01", ip: "10.5.50.20" }),
    });
    expect(await reply.json()).toMatchObject({
      settings: {
        brandName: "Cafe WiFi",
        logoUrl: null,
        backgroundUrl: expect.stringContaining(`/api/guest/brand/${cafe.id}/background-`),
      },
    });

    const pkg = await t.db.package.create({
      data: { name: "Day", durationMinutes: 1440, downloadSpeedMbps: 5, priceTsh: "2000" },
    });
    const batch = await c.request("POST", "/api/vouchers/batches", {
      venueId: cafe.id,
      packageId: pkg.id,
      quantity: 1,
    });
    expect(batch.body).toMatchObject({ vouchers: [{ code: expect.stringMatching(/^CAFE-/) }] });
  });
});
