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

let codes = 0;

/**
 * October 2026 at two venues. 21:00 UTC is midnight in Dar es Salaam, so an instant at 21:30
 * UTC on 30 September belongs to 1 October. Revenue that must count: a mobile-money payment
 * (5,000), a staff-recorded cash payment (2,000), a printed card the router confirmed (1,000)
 * and one that ran out (1,000). That must not: a card that lapsed while pending, an unused
 * card, a failed payment, and a card already paid for by a payment (counted once, as that
 * payment).
 */
async function october(operatorId: string | null) {
  const home = await t.db.venue.create({ data: { name: "Home", city: "Dar", operatorId } });
  const other = await t.db.venue.create({ data: { name: "Other", city: "Arusha" } });
  const day = await t.db.package.create({
    data: { name: "Day", durationMinutes: 1440, downloadSpeedMbps: 10, priceTsh: 1000 },
  });
  const batch = await t.db.voucherBatch.create({
    data: { venueId: home.id, packageId: day.id, quantity: 6, prefix: "WIFI" },
  });
  const card = (status: "active" | "used" | "expired" | "unused", activatedAt: Date | null) => {
    codes += 1;
    return t.db.voucher.create({
      data: {
        batchId: batch.id,
        venueId: home.id,
        packageId: day.id,
        code: `WIFI-T${codes}`,
        status,
        activatedAt,
        durationMinutes: 1440,
        priceTsh: 1000,
      },
    });
  };
  const at = (iso: string) => new Date(iso);
  await card("active", at("2026-09-30T21:30:00Z")); // 1 Oct locally
  await card("used", at("2026-10-15T09:00:00Z"));
  await card("expired", at("2026-10-15T09:00:00Z")); // lapsed while pending
  await card("unused", null);
  const paidCard = await card("used", at("2026-10-20T09:00:00Z"));
  const pay = (data: {
    provider: "mobile_money" | "manual";
    amountTsh: number;
    status: "paid" | "failed";
    paidAt: Date | null;
    venueId: string;
    voucherId?: string;
  }) =>
    t.db.payment.create({
      data: { packageId: day.id, phone: "+255700000001", providerReference: "REF-1", ...data },
    });
  await pay({
    provider: "mobile_money",
    amountTsh: 5000,
    status: "paid",
    paidAt: at("2026-10-20T09:00:00Z"),
    venueId: other.id,
    voucherId: paidCard.id,
  });
  await pay({
    provider: "manual",
    amountTsh: 2000,
    status: "paid",
    paidAt: at("2026-10-31T20:59:00Z"), // still 31 Oct locally
    venueId: home.id,
  });
  await pay({
    provider: "mobile_money",
    amountTsh: 9000,
    status: "failed",
    paidAt: null,
    venueId: home.id,
  });
  // September: 4,000, to measure growth against.
  await pay({
    provider: "mobile_money",
    amountTsh: 4000,
    status: "paid",
    paidAt: at("2026-09-30T20:00:00Z"),
    venueId: home.id,
  });
  return { home, other, day };
}

type Body = Record<string, unknown>;

describe("revenue", () => {
  test("one definition of revenue, by the Dar es Salaam month", async () => {
    const c = await admin();
    await october(null);
    const summary = (await c.request("GET", "/api/revenue/summary?month=2026-10")).body as Body;
    expect(summary).toMatchObject({
      month: "2026-10",
      thisMonth: "9000.00",
      lastMonth: "4000.00",
      allTime: "13000.00",
      monthGrowthPct: 125,
      bySource: {
        mobile_money: { allTime: "9000.00", month: "5000.00" },
        cash: { allTime: "4000.00", month: "4000.00" },
        card: { allTime: "0.00", month: "0.00" },
      },
    });

    const byVenue = (await c.request("GET", "/api/revenue/by-venue?month=2026-10")).body as Body;
    expect(byVenue.venues).toEqual([
      expect.objectContaining({ venueName: "Other", revenueTsh: "5000.00" }),
      expect.objectContaining({ venueName: "Home", revenueTsh: "4000.00" }),
    ]);
    const byPackage = (await c.request("GET", "/api/revenue/by-package?month=2026-10"))
      .body as Body;
    expect(byPackage.packages).toEqual([
      expect.objectContaining({ packageName: "Day", revenueTsh: "9000.00", sales: 4 }),
    ]);

    const tx = (await c.request("GET", "/api/revenue/transactions?month=2026-10")).body as {
      transactions: Body[];
    };
    expect(tx.transactions.map((x) => x.amountTsh)).toEqual([
      "2000.00",
      "5000.00",
      "1000.00",
      "1000.00",
    ]);
    expect(JSON.stringify(tx)).not.toContain("+255");
    expect(tx.transactions[0]).toMatchObject({ source: "cash", reference: "REF-1" });
    expect(tx.transactions.at(-1)).toMatchObject({ source: "cash", reference: "WIFI" });

    const bad = await c.request("GET", "/api/revenue/summary?month=2026-13");
    expect(bad.status).toBe(400);
  });

  test("daily usage covers every day, and revenue on days without sessions", async () => {
    const c = await admin();
    const { home } = await october(null);
    await t.db.wifiSession.create({
      data: {
        venueId: home.id,
        macAddress: "AA:BB:CC:00:00:01",
        status: "disconnected",
        startedAt: new Date("2026-10-15T08:00:00Z"),
        downloadBytes: 1_000_000n,
      },
    });
    const reply = await c.request(
      "GET",
      "/api/analytics/daily-usage?from=2026-10-01&to=2026-10-31",
    );
    const days = (reply.body as { days: Body[] }).days;
    expect(days).toHaveLength(31);
    const byDate = new Map(days.map((d) => [d.date, d]));
    expect(byDate.get("2026-10-01")).toMatchObject({ revenueTsh: "1000.00", downloadBytes: 0 });
    expect(byDate.get("2026-10-15")).toMatchObject({
      revenueTsh: "1000.00",
      downloadBytes: 1_000_000,
    });
    expect(byDate.get("2026-10-31")).toMatchObject({ revenueTsh: "2000.00" });
    expect(byDate.get("2026-10-02")).toMatchObject({ revenueTsh: "0.00", downloadBytes: 0 });

    const reversed = await c.request(
      "GET",
      "/api/analytics/daily-usage?from=2026-10-31&to=2026-10-01",
    );
    expect(reversed.status).toBe(400);
  });

  test("the monthly trend has six months, and new devices by month", async () => {
    const c = await admin();
    await october(null);
    await t.db.device.create({ data: { macAddress: "AA:BB:CC:00:00:02" } });
    const months = ((await c.request("GET", "/api/analytics/monthly")).body as { months: Body[] })
      .months;
    expect(months).toHaveLength(6);
    expect(months.at(-1)).toMatchObject({ newDevices: 1 });
    expect(months.map((m) => m.month)).toEqual([...months.map((m) => m.month)].sort());
  });
});

describe("analytics for a manager", () => {
  test("usage over their venues, no revenue, and no admin reports", async () => {
    const own = await manager("own@example.com");
    const { home, other, day } = await october(own.id);
    const phone = await t.db.device.create({
      data: { macAddress: "AA:BB:CC:00:00:03", deviceType: "Phone" },
    });
    const laptop = await t.db.device.create({
      data: { macAddress: "AA:BB:CC:00:00:04", deviceType: "laptop" },
    });
    for (const [venueId, deviceId] of [
      [home.id, phone.id],
      [other.id, laptop.id],
    ] as const) {
      await t.db.wifiSession.create({
        data: { venueId, deviceId, macAddress: "AA:BB", status: "connected", uploadBytes: 10n },
      });
    }
    await t.db.voucher.create({
      data: {
        venueId: other.id,
        packageId: day.id,
        code: "OTHER-1",
        status: "active",
        priceTsh: 1000,
      },
    });

    const summary = (await own.client.request("GET", "/api/analytics/summary")).body as Body;
    expect(summary).toMatchObject({
      activeSessions: 1,
      totalSessions: 1,
      devices: 1,
      allTimeUploadBytes: 10,
      revenueThisMonthTsh: null,
    });
    const days = (
      (await own.client.request("GET", "/api/analytics/daily-usage?from=2026-10-01&to=2026-10-02"))
        .body as { days: Body[] }
    ).days;
    expect(days.every((d) => d.revenueTsh === null)).toBe(true);

    const types = (await own.client.request("GET", "/api/analytics/devices")).body as Body;
    expect(types.types).toEqual([{ type: "phone", count: 1, percentage: 100 }]);
    const shares = (await own.client.request("GET", "/api/analytics/packages")).body as Body;
    // Home's one active card; Other's is not theirs.
    expect(shares.packages).toEqual([
      expect.objectContaining({ packageName: "Day", count: 1, percentage: 100 }),
    ]);

    for (const path of [
      "/api/analytics/monthly",
      "/api/analytics/venues",
      "/api/revenue/summary",
      "/api/revenue/by-package",
      "/api/revenue/by-venue",
      "/api/revenue/transactions",
    ]) {
      expect({ path, status: (await own.client.request("GET", path)).status }).toEqual({
        path,
        status: 403,
      });
    }

    const top = (await (await admin()).request("GET", "/api/analytics/venues")).body as {
      venues: Body[];
    };
    expect(top.venues.map((v) => [v.venueName, v.revenueTsh, v.devices])).toEqual(
      [
        ["Other", "5000.00", 1],
        ["Home", "8000.00", 1],
      ].sort((a, b) => Number(b[1]) - Number(a[1])),
    );
  });
});
