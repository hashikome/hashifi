import { Router } from "express";
import { and, count, eq, gte, inArray, isNotNull, isNull, lt, sql, sum } from "drizzle-orm";
import { db } from "../db/index.js";
import { packages, payments, venues, vouchers, wifiCustomers, wifiSessions } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { asyncRoute } from "../utils/route.js";

const router = Router();

router.use(requireAuth);

// Summary KPIs for dashboard stat cards
router.get(
  "/summary",
  asyncRoute(async (req, res) => {
    const user = (req as any).user;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    if (user.role === "manager") {
      // Managers see session/usage stats scoped to their venue(s)
      const managerVenues = await db
        .select({ id: venues.id })
        .from(venues)
        .where(eq(venues.operatorId, user.id));
      const venueIds = managerVenues.map((v) => v.id);

      const venueFilter = venueIds.length > 0 ? inArray(wifiSessions.venueId, venueIds) : sql`1=0`;

      const [[{ activeSessions }], [{ totalSessions }], [weeklyData], [allTimeData]] =
        await Promise.all([
          db
            .select({ activeSessions: count() })
            .from(wifiSessions)
            .where(and(eq(wifiSessions.status, "connected"), venueFilter)),
          db.select({ totalSessions: count() }).from(wifiSessions).where(venueFilter),
          db
            .select({
              weeklyUpload: sql<string>`CAST(COALESCE(SUM(${wifiSessions.uploadBytes}), 0) AS CHAR)`,
              weeklyDownload: sql<string>`CAST(COALESCE(SUM(${wifiSessions.downloadBytes}), 0) AS CHAR)`,
            })
            .from(wifiSessions)
            .where(and(gte(wifiSessions.startedAt, sevenDaysAgo), venueFilter)),
          db
            .select({
              allTimeUpload: sql<string>`CAST(COALESCE(SUM(${wifiSessions.uploadBytes}), 0) AS CHAR)`,
              allTimeDownload: sql<string>`CAST(COALESCE(SUM(${wifiSessions.downloadBytes}), 0) AS CHAR)`,
            })
            .from(wifiSessions)
            .where(venueFilter),
        ]);

      res.json({
        activeSessions,
        totalSessions,
        totalCustomers: null,
        monthlyRevenueTsh: null,
        weeklyUploadBytes: Number(weeklyData?.weeklyUpload ?? 0),
        weeklyDownloadBytes: Number(weeklyData?.weeklyDownload ?? 0),
        allTimeUploadBytes: Number(allTimeData?.allTimeUpload ?? 0),
        allTimeDownloadBytes: Number(allTimeData?.allTimeDownload ?? 0),
      });
      return;
    }

    const [
      [{ activeSessions }],
      [{ totalSessions }],
      [{ totalCustomers }],
      [{ monthlyRevenue }],
      [{ monthlyVoucherRevenue }],
      [weeklyData],
      [allTimeData],
    ] = await Promise.all([
      db
        .select({ activeSessions: count() })
        .from(wifiSessions)
        .where(eq(wifiSessions.status, "connected")),
      db.select({ totalSessions: count() }).from(wifiSessions),
      db.select({ totalCustomers: count() }).from(wifiCustomers),
      db
        .select({ monthlyRevenue: sum(payments.amountTsh) })
        .from(payments)
        .where(and(eq(payments.status, "paid"), gte(payments.paidAt, startOfMonth))),
      db
        .select({
          monthlyVoucherRevenue: sql<string>`CAST(COALESCE(SUM(${vouchers.priceTsh}), 0) AS CHAR)`,
        })
        .from(vouchers)
        .leftJoin(payments, and(eq(payments.voucherId, vouchers.id), eq(payments.status, "paid")))
        .where(
          and(
            gte(vouchers.activatedAt, startOfMonth),
            isNull(payments.id),
            inArray(vouchers.status, ["active", "used", "expired"]),
          ),
        ),
      db
        .select({
          weeklyUpload: sql<string>`CAST(SUM(${wifiSessions.uploadBytes}) AS CHAR)`,
          weeklyDownload: sql<string>`CAST(SUM(${wifiSessions.downloadBytes}) AS CHAR)`,
        })
        .from(wifiSessions)
        .where(gte(wifiSessions.startedAt, sevenDaysAgo)),
      db
        .select({
          allTimeUpload: sql<string>`CAST(COALESCE(SUM(${wifiSessions.uploadBytes}), 0) AS CHAR)`,
          allTimeDownload: sql<string>`CAST(COALESCE(SUM(${wifiSessions.downloadBytes}), 0) AS CHAR)`,
        })
        .from(wifiSessions),
    ]);

    res.json({
      activeSessions,
      totalSessions,
      totalCustomers,
      monthlyRevenueTsh: Number(monthlyRevenue ?? 0) + Number(monthlyVoucherRevenue ?? 0),
      weeklyUploadBytes: Number(weeklyData?.weeklyUpload ?? 0),
      weeklyDownloadBytes: Number(weeklyData?.weeklyDownload ?? 0),
      allTimeUploadBytes: Number(allTimeData?.allTimeUpload ?? 0),
      allTimeDownloadBytes: Number(allTimeData?.allTimeDownload ?? 0),
    });
  }),
);

// Daily usage — supports ?from=YYYY-MM-DD&to=YYYY-MM-DD or legacy ?days=N
router.get(
  "/daily-usage",
  asyncRoute(async (req, res) => {
    const user = (req as any).user;

    let since: Date;
    let until: Date | undefined;
    if (req.query.from && req.query.to) {
      // Date-only strings ("YYYY-MM-DD") parse as UTC midnight per spec, ignoring the
      // process TZ pin — append a bare time so they parse as local (EAT) wall-clock instead.
      since = new Date(`${req.query.from}T00:00:00`);
      const toDate = new Date(`${req.query.to}T00:00:00`);
      toDate.setHours(23, 59, 59, 999);
      until = toDate;
    } else {
      const days = Math.min(Math.max(Number(req.query.days) || 90, 7), 365);
      since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }

    const sessionDateFilter = until
      ? and(gte(wifiSessions.startedAt, since), lt(wifiSessions.startedAt, until))
      : gte(wifiSessions.startedAt, since);

    // Managers: scope sessions to their venue(s), exclude revenue columns
    if (user.role === "manager") {
      const managerVenues = await db
        .select({ id: venues.id })
        .from(venues)
        .where(eq(venues.operatorId, user.id));
      const venueIds = managerVenues.map((v) => v.id);
      const venueFilter = venueIds.length > 0 ? inArray(wifiSessions.venueId, venueIds) : sql`1=0`;

      const sessionRows = await db
        .select({
          date: sql<string>`DATE(CONVERT_TZ(${wifiSessions.startedAt}, '+00:00', '+03:00'))`,
          uploadBytes: sql<string>`CAST(SUM(${wifiSessions.uploadBytes}) AS CHAR)`,
          downloadBytes: sql<string>`CAST(SUM(${wifiSessions.downloadBytes}) AS CHAR)`,
        })
        .from(wifiSessions)
        .where(and(sessionDateFilter, venueFilter))
        .groupBy(sql`DATE(CONVERT_TZ(${wifiSessions.startedAt}, '+00:00', '+03:00'))`)
        .orderBy(sql`DATE(CONVERT_TZ(${wifiSessions.startedAt}, '+00:00', '+03:00'))`);

      res.json({
        dailyUsage: sessionRows.map((r) => ({
          date: r.date,
          uploadBytes: Number(r.uploadBytes),
          downloadBytes: Number(r.downloadBytes),
          revenueTsh: null,
        })),
      });
      return;
    }

    const paymentDateFilter = until
      ? and(eq(payments.status, "paid"), gte(payments.paidAt, since), lt(payments.paidAt, until))
      : and(eq(payments.status, "paid"), gte(payments.paidAt, since));

    const voucherDateFilter = until
      ? and(
          gte(vouchers.activatedAt, since),
          lt(vouchers.activatedAt, until),
          isNull(payments.id),
          inArray(vouchers.status, ["active", "used", "expired"]),
        )
      : and(
          gte(vouchers.activatedAt, since),
          isNull(payments.id),
          inArray(vouchers.status, ["active", "used", "expired"]),
        );

    const [sessionRows, paymentRows, voucherRows] = await Promise.all([
      db
        .select({
          date: sql<string>`DATE(CONVERT_TZ(${wifiSessions.startedAt}, '+00:00', '+03:00'))`,
          uploadBytes: sql<string>`CAST(SUM(${wifiSessions.uploadBytes}) AS CHAR)`,
          downloadBytes: sql<string>`CAST(SUM(${wifiSessions.downloadBytes}) AS CHAR)`,
        })
        .from(wifiSessions)
        .where(sessionDateFilter)
        .groupBy(sql`DATE(CONVERT_TZ(${wifiSessions.startedAt}, '+00:00', '+03:00'))`)
        .orderBy(sql`DATE(CONVERT_TZ(${wifiSessions.startedAt}, '+00:00', '+03:00'))`),

      db
        .select({
          date: sql<string>`DATE(CONVERT_TZ(${payments.paidAt}, '+00:00', '+03:00'))`,
          revenueTsh: sql<string>`SUM(${payments.amountTsh})`,
        })
        .from(payments)
        .where(paymentDateFilter)
        .groupBy(sql`DATE(CONVERT_TZ(${payments.paidAt}, '+00:00', '+03:00'))`)
        .orderBy(sql`DATE(CONVERT_TZ(${payments.paidAt}, '+00:00', '+03:00'))`),

      // Cash voucher sales per day
      db
        .select({
          date: sql<string>`DATE(CONVERT_TZ(${vouchers.activatedAt}, '+00:00', '+03:00'))`,
          revenueTsh: sql<string>`CAST(SUM(${vouchers.priceTsh}) AS CHAR)`,
        })
        .from(vouchers)
        .leftJoin(payments, and(eq(payments.voucherId, vouchers.id), eq(payments.status, "paid")))
        .where(voucherDateFilter)
        .groupBy(sql`DATE(CONVERT_TZ(${vouchers.activatedAt}, '+00:00', '+03:00'))`)
        .orderBy(sql`DATE(CONVERT_TZ(${vouchers.activatedAt}, '+00:00', '+03:00'))`),
    ]);

    const revenueMap = new Map<string, number>();
    for (const r of paymentRows) revenueMap.set(r.date, Number(r.revenueTsh));
    for (const r of voucherRows) {
      revenueMap.set(r.date, (revenueMap.get(r.date) ?? 0) + Number(r.revenueTsh));
    }

    const dailyUsage = sessionRows.map((r) => ({
      date: r.date,
      uploadBytes: Number(r.uploadBytes),
      downloadBytes: Number(r.downloadBytes),
      revenueTsh: revenueMap.get(r.date) ?? 0,
    }));

    res.json({ dailyUsage });
  }),
);

// Monthly revenue + new user registrations for the last 6 months — admin only
router.get(
  "/monthly",
  requireRole("admin"),
  asyncRoute(async (_req, res) => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const [revenueRows, voucherRevenueRows, userRows] = await Promise.all([
      db
        .select({
          yearMonth: sql<string>`DATE_FORMAT(CONVERT_TZ(${payments.paidAt}, '+00:00', '+03:00'), '%Y-%m')`,
          label: sql<string>`DATE_FORMAT(CONVERT_TZ(${payments.paidAt}, '+00:00', '+03:00'), '%b %Y')`,
          revenueTsh: sql<string>`SUM(${payments.amountTsh})`,
        })
        .from(payments)
        .where(and(eq(payments.status, "paid"), gte(payments.paidAt, sixMonthsAgo)))
        .groupBy(
          sql`DATE_FORMAT(CONVERT_TZ(${payments.paidAt}, '+00:00', '+03:00'), '%Y-%m')`,
          sql`DATE_FORMAT(CONVERT_TZ(${payments.paidAt}, '+00:00', '+03:00'), '%b %Y')`,
        )
        .orderBy(sql`DATE_FORMAT(CONVERT_TZ(${payments.paidAt}, '+00:00', '+03:00'), '%Y-%m')`),

      // Cash voucher sales (activated, no payment record)
      db
        .select({
          yearMonth: sql<string>`DATE_FORMAT(CONVERT_TZ(${vouchers.activatedAt}, '+00:00', '+03:00'), '%Y-%m')`,
          label: sql<string>`DATE_FORMAT(CONVERT_TZ(${vouchers.activatedAt}, '+00:00', '+03:00'), '%b %Y')`,
          revenueTsh: sql<string>`CAST(SUM(${vouchers.priceTsh}) AS CHAR)`,
        })
        .from(vouchers)
        .leftJoin(payments, and(eq(payments.voucherId, vouchers.id), eq(payments.status, "paid")))
        .where(
          and(
            gte(vouchers.activatedAt, sixMonthsAgo),
            isNull(payments.id),
            inArray(vouchers.status, ["active", "used", "expired"]),
          ),
        )
        .groupBy(
          sql`DATE_FORMAT(CONVERT_TZ(${vouchers.activatedAt}, '+00:00', '+03:00'), '%Y-%m')`,
          sql`DATE_FORMAT(CONVERT_TZ(${vouchers.activatedAt}, '+00:00', '+03:00'), '%b %Y')`,
        )
        .orderBy(
          sql`DATE_FORMAT(CONVERT_TZ(${vouchers.activatedAt}, '+00:00', '+03:00'), '%Y-%m')`,
        ),

      db
        .select({
          yearMonth: sql<string>`DATE_FORMAT(CONVERT_TZ(${wifiCustomers.joinedAt}, '+00:00', '+03:00'), '%Y-%m')`,
          label: sql<string>`DATE_FORMAT(CONVERT_TZ(${wifiCustomers.joinedAt}, '+00:00', '+03:00'), '%b %Y')`,
          newUsers: sql<number>`COUNT(*)`,
        })
        .from(wifiCustomers)
        .where(gte(wifiCustomers.joinedAt, sixMonthsAgo))
        .groupBy(
          sql`DATE_FORMAT(CONVERT_TZ(${wifiCustomers.joinedAt}, '+00:00', '+03:00'), '%Y-%m')`,
          sql`DATE_FORMAT(CONVERT_TZ(${wifiCustomers.joinedAt}, '+00:00', '+03:00'), '%b %Y')`,
        )
        .orderBy(
          sql`DATE_FORMAT(CONVERT_TZ(${wifiCustomers.joinedAt}, '+00:00', '+03:00'), '%Y-%m')`,
        ),
    ]);

    // Merge online payment revenue + cash voucher revenue by month
    const revenueMap = new Map<string, { revenueTsh: number; label: string }>();
    for (const r of revenueRows) {
      revenueMap.set(r.yearMonth, { revenueTsh: Number(r.revenueTsh), label: r.label });
    }
    for (const r of voucherRevenueRows) {
      const existing = revenueMap.get(r.yearMonth);
      revenueMap.set(r.yearMonth, {
        revenueTsh: (existing?.revenueTsh ?? 0) + Number(r.revenueTsh),
        label: existing?.label ?? r.label,
      });
    }
    const userMap = new Map(
      userRows.map((r) => [r.yearMonth, { newUsers: Number(r.newUsers), label: r.label }]),
    );

    // Always produce all 6 months so the chart never shows a single bar
    const allMonths: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      allMonths.push(ym);
    }

    const monthLabel = (ym: string): string => {
      const [y, m] = ym.split("-");
      return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      });
    };

    const monthly = allMonths.map((ym) => {
      const rev = revenueMap.get(ym);
      const usr = userMap.get(ym);
      return {
        month: rev?.label ?? usr?.label ?? monthLabel(ym),
        revenueTsh: rev?.revenueTsh ?? 0,
        newUsers: usr?.newUsers ?? 0,
      };
    });

    res.json({ monthly });
  }),
);

// Package distribution (active vouchers grouped by package)
router.get(
  "/packages",
  asyncRoute(async (_req, res) => {
    const rows = await db
      .select({
        packageName: packages.name,
        count: sql<number>`COUNT(*)`,
      })
      .from(vouchers)
      .leftJoin(packages, eq(vouchers.packageId, packages.id))
      .where(eq(vouchers.status, "active"))
      .groupBy(packages.id, packages.name)
      .orderBy(sql`COUNT(*) DESC`);

    const total = rows.reduce((s, r) => s + Number(r.count), 0);
    const packageDistribution = rows.map((r) => ({
      package: r.packageName ?? "Unknown",
      count: Number(r.count),
      percentage: total > 0 ? Math.round((Number(r.count) / total) * 100) : 0,
    }));

    res.json({ packageDistribution });
  }),
);

// Device type breakdown (from customer profiles)
router.get(
  "/devices",
  asyncRoute(async (_req, res) => {
    const rows = await db
      .select({
        deviceType: wifiCustomers.deviceType,
        count: sql<number>`COUNT(*)`,
      })
      .from(wifiCustomers)
      .where(isNotNull(wifiCustomers.deviceType))
      .groupBy(wifiCustomers.deviceType)
      .orderBy(sql`COUNT(*) DESC`);

    const total = rows.reduce((s, r) => s + Number(r.count), 0);
    const deviceTypes = rows.map((r) => {
      const raw = r.deviceType ?? "other";
      return {
        type: raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase(),
        count: Number(r.count),
        percentage: total > 0 ? Math.round((Number(r.count) / total) * 100) : 0,
      };
    });

    res.json({ deviceTypes });
  }),
);

// Top venues by active users and all-time revenue — admin only
router.get(
  "/venues",
  requireRole("admin"),
  asyncRoute(async (_req, res) => {
    const [activeRows, revenueRows, voucherRevenueRows, venueList] = await Promise.all([
      db
        .select({
          venueId: wifiSessions.venueId,
          activeUsers: sql<number>`COUNT(DISTINCT ${wifiSessions.customerId})`,
        })
        .from(wifiSessions)
        .where(isNotNull(wifiSessions.venueId))
        .groupBy(wifiSessions.venueId),

      db
        .select({
          venueId: payments.venueId,
          revenueTsh: sql<string>`SUM(${payments.amountTsh})`,
        })
        .from(payments)
        .where(and(eq(payments.status, "paid"), isNotNull(payments.venueId)))
        .groupBy(payments.venueId),

      // Cash vouchers activated without an online payment
      db
        .select({
          venueId: vouchers.venueId,
          revenueTsh: sql<string>`COALESCE(SUM(${vouchers.priceTsh}), 0)`,
        })
        .from(vouchers)
        .leftJoin(payments, and(eq(payments.voucherId, vouchers.id), eq(payments.status, "paid")))
        .where(
          and(
            isNull(payments.id),
            isNotNull(vouchers.batchId),
            isNotNull(vouchers.venueId),
            inArray(vouchers.status, ["active", "used", "expired"]),
          ),
        )
        .groupBy(vouchers.venueId),

      db
        .select({ id: venues.id, name: venues.name })
        .from(venues)
        .where(eq(venues.status, "active")),
    ]);

    const activeMap = new Map(activeRows.map((r) => [r.venueId, Number(r.activeUsers)]));
    const revenueMap = new Map(revenueRows.map((r) => [r.venueId, Number(r.revenueTsh)]));
    for (const r of voucherRevenueRows) {
      if (r.venueId) {
        revenueMap.set(r.venueId, (revenueMap.get(r.venueId) ?? 0) + Number(r.revenueTsh));
      }
    }

    const topVenues = venueList
      .map((v) => ({
        venue: v.name,
        users: activeMap.get(v.id) ?? 0,
        revenue: revenueMap.get(v.id) ?? 0,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.users - a.users)
      .slice(0, 10);

    res.json({ topVenues });
  }),
);

export { router as analyticsRouter };
