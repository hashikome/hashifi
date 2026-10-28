import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/index.js";
import { packages, payments, venues, voucherBatches, vouchers } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { asyncRoute } from "../utils/route.js";

const router = Router();
router.use(requireAuth);
router.use(requireRole("admin"));

// ── helpers ──────────────────────────────────────────────────────────────────

function startOf(unit: "day" | "month" | "year", ref = new Date()) {
  const d = new Date(ref);
  if (unit === "day") {
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (unit === "month") {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function prevMonth(ref = new Date()) {
  const d = new Date(ref);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - 1);
  return d;
}

// ── GET /api/revenue/summary ─────────────────────────────────────────────────
// Supports optional ?year=YYYY&month=M to view a specific month's data
router.get(
  "/summary",
  asyncRoute(async (req, res) => {
    const now = new Date();
    const selYear = req.query.year ? Number(req.query.year) : now.getFullYear();
    const selMonth = req.query.month ? Number(req.query.month) : now.getMonth() + 1;

    const today = startOf("day");
    const thisMonth = new Date(selYear, selMonth - 1, 1);
    const nextMonth = new Date(selYear, selMonth, 1);
    const lastMonthStart = new Date(selYear, selMonth - 2, 1);
    const lastMonthEnd = thisMonth;

    // Online payments (Snippe)
    const onlineWhere = eq(payments.status, "paid");
    const [[{ allTimeOnline }], [{ thisMonthOnline }], [{ lastMonthOnline }], [{ todayOnline }]] =
      await Promise.all([
        db
          .select({ allTimeOnline: sql<string>`COALESCE(SUM(${payments.amountTsh}), 0)` })
          .from(payments)
          .where(onlineWhere),
        db
          .select({ thisMonthOnline: sql<string>`COALESCE(SUM(${payments.amountTsh}), 0)` })
          .from(payments)
          .where(and(onlineWhere, gte(payments.paidAt, thisMonth), lt(payments.paidAt, nextMonth))),
        db
          .select({ lastMonthOnline: sql<string>`COALESCE(SUM(${payments.amountTsh}), 0)` })
          .from(payments)
          .where(
            and(
              onlineWhere,
              gte(payments.paidAt, lastMonthStart),
              lt(payments.paidAt, lastMonthEnd),
            ),
          ),
        db
          .select({ todayOnline: sql<string>`COALESCE(SUM(${payments.amountTsh}), 0)` })
          .from(payments)
          .where(and(onlineWhere, gte(payments.paidAt, today))),
      ]);

    // Cash voucher sales (activated batch vouchers with no matching paid payment)
    const cashJoin = and(eq(payments.voucherId, vouchers.id), eq(payments.status, "paid"));
    const cashBase = and(
      isNull(payments.id),
      isNotNull(vouchers.batchId),
      inArray(vouchers.status, ["active", "used", "expired"]),
    );

    const [[{ allTimeCash }], [{ thisMonthCash }], [{ lastMonthCash }], [{ todayCash }]] =
      await Promise.all([
        db
          .select({ allTimeCash: sql<string>`COALESCE(SUM(${vouchers.priceTsh}), 0)` })
          .from(vouchers)
          .leftJoin(payments, cashJoin)
          .where(cashBase),
        db
          .select({ thisMonthCash: sql<string>`COALESCE(SUM(${vouchers.priceTsh}), 0)` })
          .from(vouchers)
          .leftJoin(payments, cashJoin)
          .where(
            and(
              cashBase,
              gte(vouchers.activatedAt, thisMonth),
              lt(vouchers.activatedAt, nextMonth),
            ),
          ),
        db
          .select({ lastMonthCash: sql<string>`COALESCE(SUM(${vouchers.priceTsh}), 0)` })
          .from(vouchers)
          .leftJoin(payments, cashJoin)
          .where(
            and(
              cashBase,
              gte(vouchers.activatedAt, lastMonthStart),
              lt(vouchers.activatedAt, lastMonthEnd),
            ),
          ),
        db
          .select({ todayCash: sql<string>`COALESCE(SUM(${vouchers.priceTsh}), 0)` })
          .from(vouchers)
          .leftJoin(payments, cashJoin)
          .where(and(cashBase, gte(vouchers.activatedAt, today))),
      ]);

    const allTime = Number(allTimeOnline) + Number(allTimeCash);
    const thisMonthTotal = Number(thisMonthOnline) + Number(thisMonthCash);
    const lastMonthTotal = Number(lastMonthOnline) + Number(lastMonthCash);
    const todayTotal = Number(todayOnline) + Number(todayCash);
    const growth =
      lastMonthTotal > 0
        ? Math.round(((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100)
        : null;

    res.json({
      allTime,
      thisMonth: thisMonthTotal,
      lastMonth: lastMonthTotal,
      today: todayTotal,
      monthGrowthPct: growth,
      selectedYear: selYear,
      selectedMonth: selMonth,
      bySource: {
        online: { allTime: Number(allTimeOnline), thisMonth: Number(thisMonthOnline) },
        cash: { allTime: Number(allTimeCash), thisMonth: Number(thisMonthCash) },
      },
    });
  }),
);

// ── GET /api/revenue/by-package ──────────────────────────────────────────────
router.get(
  "/by-package",
  asyncRoute(async (req, res) => {
    const now = new Date();
    const selYear = req.query.year ? Number(req.query.year) : now.getFullYear();
    const selMonth = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
    const periodStart = new Date(selYear, selMonth - 1, 1);
    const periodEnd = new Date(selYear, selMonth, 1);

    const [onlineRows, cashRows] = await Promise.all([
      db
        .select({
          packageId: payments.packageId,
          packageName: packages.name,
          revenue: sql<string>`COALESCE(SUM(${payments.amountTsh}), 0)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(payments)
        .leftJoin(packages, eq(payments.packageId, packages.id))
        .where(
          and(
            eq(payments.status, "paid"),
            gte(payments.paidAt, periodStart),
            lt(payments.paidAt, periodEnd),
          ),
        )
        .groupBy(payments.packageId, packages.name),

      db
        .select({
          packageId: vouchers.packageId,
          packageName: packages.name,
          revenue: sql<string>`COALESCE(SUM(${vouchers.priceTsh}), 0)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(vouchers)
        .leftJoin(packages, eq(vouchers.packageId, packages.id))
        .leftJoin(payments, and(eq(payments.voucherId, vouchers.id), eq(payments.status, "paid")))
        .where(
          and(
            isNull(payments.id),
            isNotNull(vouchers.batchId),
            inArray(vouchers.status, ["active", "used", "expired"]),
            gte(vouchers.activatedAt, periodStart),
            lt(vouchers.activatedAt, periodEnd),
          ),
        )
        .groupBy(vouchers.packageId, packages.name),
    ]);

    const map = new Map<string, { name: string; revenue: number; count: number }>();
    for (const r of [...onlineRows, ...cashRows]) {
      const key = r.packageId ?? "unknown";
      const existing = map.get(key);
      map.set(key, {
        name: r.packageName ?? "Unknown",
        revenue: (existing?.revenue ?? 0) + Number(r.revenue),
        count: (existing?.count ?? 0) + Number(r.count),
      });
    }

    const byPackage = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);

    res.json({ byPackage });
  }),
);

// ── GET /api/revenue/by-venue ────────────────────────────────────────────────
router.get(
  "/by-venue",
  asyncRoute(async (req, res) => {
    const now = new Date();
    const selYear = req.query.year ? Number(req.query.year) : now.getFullYear();
    const selMonth = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
    const periodStart = new Date(selYear, selMonth - 1, 1);
    const periodEnd = new Date(selYear, selMonth, 1);

    const [onlineRows, cashRows] = await Promise.all([
      db
        .select({
          venueId: payments.venueId,
          venueName: venues.name,
          revenue: sql<string>`COALESCE(SUM(${payments.amountTsh}), 0)`,
        })
        .from(payments)
        .leftJoin(venues, eq(payments.venueId, venues.id))
        .where(
          and(
            eq(payments.status, "paid"),
            isNotNull(payments.venueId),
            gte(payments.paidAt, periodStart),
            lt(payments.paidAt, periodEnd),
          ),
        )
        .groupBy(payments.venueId, venues.name),

      db
        .select({
          venueId: vouchers.venueId,
          venueName: venues.name,
          revenue: sql<string>`COALESCE(SUM(${vouchers.priceTsh}), 0)`,
        })
        .from(vouchers)
        .leftJoin(venues, eq(vouchers.venueId, venues.id))
        .leftJoin(payments, and(eq(payments.voucherId, vouchers.id), eq(payments.status, "paid")))
        .where(
          and(
            isNull(payments.id),
            isNotNull(vouchers.batchId),
            isNotNull(vouchers.venueId),
            inArray(vouchers.status, ["active", "used", "expired"]),
            gte(vouchers.activatedAt, periodStart),
            lt(vouchers.activatedAt, periodEnd),
          ),
        )
        .groupBy(vouchers.venueId, venues.name),
    ]);

    const map = new Map<string, { name: string; revenue: number }>();
    for (const r of [...onlineRows, ...cashRows]) {
      const key = r.venueId ?? "unknown";
      const existing = map.get(key);
      map.set(key, {
        name: r.venueName ?? "Unknown",
        revenue: (existing?.revenue ?? 0) + Number(r.revenue),
      });
    }

    const byVenue = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);

    res.json({ byVenue });
  }),
);

// ── GET /api/revenue/transactions ────────────────────────────────────────────
// Last 50 revenue events filtered to ?year=YYYY&month=M (defaults to current month)
router.get(
  "/transactions",
  asyncRoute(async (req, res) => {
    const now = new Date();
    const selYear = req.query.year ? Number(req.query.year) : now.getFullYear();
    const selMonth = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
    const periodStart = new Date(selYear, selMonth - 1, 1);
    const periodEnd = new Date(selYear, selMonth, 1);

    const [onlineTx, cashTx] = await Promise.all([
      db
        .select({
          id: payments.id,
          type: sql<string>`'online'`,
          amountTsh: payments.amountTsh,
          packageName: packages.name,
          venueName: venues.name,
          reference: payments.phone,
          occurredAt: payments.paidAt,
        })
        .from(payments)
        .leftJoin(packages, eq(payments.packageId, packages.id))
        .leftJoin(venues, eq(payments.venueId, venues.id))
        .where(
          and(
            eq(payments.status, "paid"),
            gte(payments.paidAt, periodStart),
            lt(payments.paidAt, periodEnd),
          ),
        )
        .orderBy(desc(payments.paidAt))
        .limit(50),

      db
        .select({
          id: vouchers.id,
          type: sql<string>`'cash'`,
          amountTsh: vouchers.priceTsh,
          packageName: packages.name,
          venueName: venues.name,
          reference: voucherBatches.prefix,
          occurredAt: vouchers.activatedAt,
        })
        .from(vouchers)
        .leftJoin(packages, eq(vouchers.packageId, packages.id))
        .leftJoin(venues, eq(vouchers.venueId, venues.id))
        .leftJoin(voucherBatches, eq(vouchers.batchId, voucherBatches.id))
        .leftJoin(payments, and(eq(payments.voucherId, vouchers.id), eq(payments.status, "paid")))
        .where(
          and(
            isNull(payments.id),
            isNotNull(vouchers.batchId),
            inArray(vouchers.status, ["active", "used", "expired"]),
            gte(vouchers.activatedAt, periodStart),
            lt(vouchers.activatedAt, periodEnd),
          ),
        )
        .orderBy(desc(vouchers.activatedAt))
        .limit(50),
    ]);

    const transactions = [...onlineTx, ...cashTx]
      .filter((t) => t.occurredAt)
      .sort((a, b) => new Date(b.occurredAt!).getTime() - new Date(a.occurredAt!).getTime())
      .slice(0, 50)
      .map((t) => ({
        id: t.id,
        type: t.type,
        amountTsh: Number(t.amountTsh),
        packageName: t.packageName ?? "Unknown",
        venueName: t.venueName ?? null,
        reference: t.reference ?? null,
        occurredAt: t.occurredAt,
      }));

    res.json({ transactions });
  }),
);

export { router as revenueRouter };
