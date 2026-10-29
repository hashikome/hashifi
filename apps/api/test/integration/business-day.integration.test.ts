import { describe, expect, test } from "bun:test";
import { businessDayOf, businessDaySql } from "../../src/analytics/business-day.js";
import { Prisma } from "../../src/generated/prisma/client.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();

describe("business-day grouping in PostgreSQL", () => {
  test("sales either side of 21:00 UTC fall on different business days, as in the app", async () => {
    const venue = await t.db.venue.create({ data: { name: "Home", city: "Dar es Salaam" } });
    const instants = ["2026-10-28T20:59:59Z", "2026-10-28T21:00:00Z", "2026-10-29T10:00:00Z"];
    for (const [i, at] of instants.entries()) {
      await t.db.payment.create({
        data: {
          venueId: venue.id,
          amountTsh: "1000",
          status: "paid",
          provider: "cash",
          paidAt: new Date(at),
          providerReference: `ref-${i}`,
        },
      });
    }
    const rows = await t.db.$queryRaw<{ day: Date; revenue: string }[]>`
      SELECT ${businessDaySql(Prisma.sql`paid_at`)} AS day, sum(amount_tsh)::text AS revenue
      FROM payments GROUP BY 1 ORDER BY 1`;
    const days = rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), revenue: r.revenue }));
    expect(days).toEqual([
      { day: "2026-10-28", revenue: "1000.00" },
      { day: "2026-10-29", revenue: "2000.00" },
    ]);
    // The database and the application agree on every instant.
    for (const at of instants) {
      const [row] = await t.db.$queryRaw<{ day: Date }[]>`
        SELECT ${businessDaySql(Prisma.sql`${new Date(at)}::timestamptz`)} AS day`;
      expect(row?.day.toISOString().slice(0, 10)).toBe(businessDayOf(new Date(at)));
    }
  });
});
