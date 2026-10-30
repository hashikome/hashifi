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

const DAY = { name: "Day", durationMinutes: 1440, downloadSpeedMbps: 10, priceTsh: 2000 };

async function setting(operatorId: string | null) {
  const venue = await t.db.venue.create({
    data: { name: "Home", city: "Dar es Salaam", operatorId },
  });
  const pkg = await t.db.package.create({ data: { ...DAY, dataLimitGb: 5 } });
  return { venue, pkg };
}

interface Detail {
  batch: { id: string; prefix: string; quantity: number; counts: Record<string, number> };
  vouchers: {
    id: string;
    code: string;
    status: string;
    durationMinutes: number;
    priceTsh: string;
    dataLimitGb: number;
    downloadSpeedMbps: number;
    uploadSpeedMbps: number;
    packageName: string;
    venueName: string;
  }[];
}

describe("vouchers", () => {
  test("a manager makes a batch for their venue: secure codes, the package's terms", async () => {
    const own = await manager("own@example.com");
    const { venue, pkg } = await setting(own.id);
    const created = await own.client.request("POST", "/api/vouchers/batches", {
      venueId: venue.id,
      packageId: pkg.id,
      quantity: 25,
      expiryDays: 30,
    });
    expect(created.status).toBe(201);
    const detail = created.body as Detail;
    expect(detail.batch).toMatchObject({ prefix: "WIFI", quantity: 25, counts: { unused: 25 } });
    expect(detail.vouchers).toHaveLength(25);
    expect(new Set(detail.vouchers.map((v) => v.code)).size).toBe(25);
    for (const voucher of detail.vouchers) {
      expect(voucher.code).toMatch(/^WIFI-[A-HJKMNP-Z2-9]{8}$/);
      expect(voucher).toMatchObject({
        status: "unused",
        durationMinutes: 1440,
        priceTsh: "2000.00",
        dataLimitGb: 5,
        downloadSpeedMbps: 10,
        uploadSpeedMbps: 10,
        packageName: "Day",
        venueName: "Home",
      });
    }
    const stored = await t.db.voucher.findFirstOrThrow();
    const days = ((stored.expiresAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect((await t.db.auditLog.findFirstOrThrow()).action).toBe("vouchers_generated");

    const again = await own.client.request("GET", `/api/vouchers/batches/${detail.batch.id}`);
    expect((again.body as Detail).vouchers.map((v) => v.code).sort()).toEqual(
      detail.vouchers.map((v) => v.code).sort(),
    );
  });

  test("the prefix is upper-cased, defaults to the portal's, and never changes the portal", async () => {
    const c = await admin();
    const { venue, pkg } = await setting(null);
    await t.db.portalSetting.create({
      data: {
        brandName: "Home",
        headline: "Welcome",
        message: "Hi",
        primaryColor: "#000000",
        accentColor: "#000000",
        backgroundColor: "#ffffff",
        voucherLabel: "Code",
        voucherHelp: "Type it",
        ticketTitle: "WiFi",
        ticketFooter: "Thanks",
        voucherPrefix: "HOME",
      },
    });
    const base = { venueId: venue.id, packageId: pkg.id, quantity: 1 };
    const defaulted = (await c.request("POST", "/api/vouchers/batches", base)).body as Detail;
    expect(defaulted.vouchers[0]?.code).toMatch(/^HOME-/);
    const own = (await c.request("POST", "/api/vouchers/batches", { ...base, prefix: "cafe" }))
      .body as Detail;
    expect(own.vouchers[0]?.code).toMatch(/^CAFE-/);
    expect((await t.db.portalSetting.findFirstOrThrow()).voucherPrefix).toBe("HOME");

    const bad = await c.request("POST", "/api/vouchers/batches", { ...base, prefix: "A-B" });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ details: { prefix: expect.any(String) } });
  });

  test("only a package on sale at the venue, and only in the manager's venues", async () => {
    const own = await manager("own@example.com");
    const { venue, pkg } = await setting(own.id);
    const other = await t.db.venue.create({ data: { name: "Other", city: "Arusha" } });
    const week = await t.db.package.create({ data: { ...DAY, name: "Week" } });
    const retired = await t.db.package.create({ data: { ...DAY, name: "Old", isActive: false } });
    await t.db.venuePackage.create({ data: { venueId: venue.id, packageId: week.id } });

    const batch = (packageId: string, venueId = venue.id) =>
      own.client.request("POST", "/api/vouchers/batches", { venueId, packageId, quantity: 1 });
    for (const packageId of [pkg.id, retired.id]) {
      const refused = await batch(packageId);
      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({
        details: { packageId: "is not on sale at this venue" },
      });
    }
    expect((await batch(week.id)).status).toBe(201);
    expect((await batch(week.id, other.id)).status).toBe(404);
    expect(await t.db.voucher.count()).toBe(1);
  });

  test("a manager lists and opens only their venues' vouchers, a page at a time", async () => {
    const own = await manager("own@example.com");
    const { venue, pkg } = await setting(own.id);
    const c = await admin();
    const other = await t.db.venue.create({ data: { name: "Other", city: "Arusha" } });
    const mine = (
      await own.client.request("POST", "/api/vouchers/batches", {
        venueId: venue.id,
        packageId: pkg.id,
        quantity: 5,
      })
    ).body as Detail;
    const theirs = (
      await c.request("POST", "/api/vouchers/batches", {
        venueId: other.id,
        packageId: pkg.id,
        quantity: 3,
      })
    ).body as Detail;

    const first = (await own.client.request("GET", "/api/vouchers?limit=3")).body as {
      vouchers: { venueName: string }[];
      nextBefore: string | null;
    };
    expect(first.vouchers).toHaveLength(3);
    expect(first.nextBefore).not.toBeNull();
    const rest = (
      await own.client.request("GET", `/api/vouchers?limit=3&before=${first.nextBefore}`)
    ).body as { vouchers: unknown[]; nextBefore: string | null };
    expect(rest.vouchers).toHaveLength(2);
    expect(rest.nextBefore).toBeNull();
    expect(first.vouchers.every((v) => v.venueName === "Home")).toBe(true);

    const batches = (await own.client.request("GET", "/api/vouchers/batches")).body as {
      batches: { id: string }[];
    };
    expect(batches.batches.map((b) => b.id)).toEqual([mine.batch.id]);
    const hidden = await own.client.request("GET", `/api/vouchers/batches/${theirs.batch.id}`);
    expect(hidden.status).toBe(404);
    const all = (await c.request("GET", "/api/vouchers?status=unused")).body as {
      vouchers: unknown[];
    };
    expect(all.vouchers).toHaveLength(8);
  });

  test("revoking stops unused vouchers, keeps their records, and never cuts off a guest", async () => {
    const c = await admin();
    const own = await manager("own@example.com");
    const { venue, pkg } = await setting(own.id);
    const detail = (
      await c.request("POST", "/api/vouchers/batches", {
        venueId: venue.id,
        packageId: pkg.id,
        quantity: 3,
      })
    ).body as Detail;
    const [unused, active, finished] = detail.vouchers;
    if (!unused || !active || !finished) throw new Error("batch too small");
    await t.db.voucher.update({
      where: { id: active.id },
      data: { status: "active", activatedAt: new Date() },
    });
    await t.db.voucher.update({ where: { id: finished.id }, data: { status: "used" } });

    const refused = await own.client.request("POST", "/api/vouchers/revoke", { ids: [unused.id] });
    expect(refused.status).toBe(403);

    const reply = await c.request("POST", "/api/vouchers/revoke", {
      ids: [unused.id, active.id, finished.id],
    });
    expect(reply).toEqual({ status: 200, body: { revoked: 1 } });
    const after = new Map((await t.db.voucher.findMany()).map((v) => [v.id, v]));
    expect(after.size).toBe(3);
    expect(after.get(unused.id)?.status).toBe("revoked");
    expect(after.get(unused.id)?.revokedAt).not.toBeNull();
    expect(after.get(active.id)?.status).toBe("active");
    expect(after.get(finished.id)?.status).toBe("used");
    expect((await t.db.auditLog.findMany()).map((a) => a.action)).toContain("vouchers_revoked");
    const again = await c.request("POST", "/api/vouchers/revoke", { ids: [unused.id] });
    expect(again.body).toEqual({ revoked: 0 });
  });

  test("reprinting by id returns only vouchers in the manager's venues", async () => {
    const own = await manager("own@example.com");
    const { venue, pkg } = await setting(own.id);
    const c = await admin();
    const other = await t.db.venue.create({ data: { name: "Other", city: "Arusha" } });
    const mine = (
      await own.client.request("POST", "/api/vouchers/batches", {
        venueId: venue.id,
        packageId: pkg.id,
        quantity: 2,
      })
    ).body as Detail;
    const theirs = (
      await c.request("POST", "/api/vouchers/batches", {
        venueId: other.id,
        packageId: pkg.id,
        quantity: 1,
      })
    ).body as Detail;
    const ids = [...mine.vouchers, ...theirs.vouchers].map((v) => v.id);
    const printed = await own.client.request("POST", "/api/vouchers/print", { ids });
    expect(printed.status).toBe(200);
    const vouchers = (printed.body as { vouchers: { id: string; downloadSpeedMbps: number }[] })
      .vouchers;
    expect(vouchers.map((v) => v.id).sort()).toEqual(mine.vouchers.map((v) => v.id).sort());
    expect(vouchers[0]?.downloadSpeedMbps).toBe(10);
  });
});
