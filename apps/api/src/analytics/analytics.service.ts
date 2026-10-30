import type {
  AnalyticsSummary,
  BusinessMonth,
  DailyUsage,
  DeviceTypeShares,
  MonthlyTrend,
  PackageShares,
  RevenueByPackage,
  RevenueByVenue,
  RevenueSource,
  RevenueSummary,
  RevenueTransactions,
  TopVenues,
} from "@hashifi/types";
import { BadRequestException, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { StaffPrincipal } from "../auth/staff-guard.js";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { apiError } from "../http/error-envelope.js";
import { bytes } from "../serializers/records.js";
import { businessDayOf, businessDaySql } from "./business-day.js";
import { businessMonthSql, moneySum, REVENUE_EVENTS, venueFilter } from "./revenue-events.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export const monthQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be YYYY-MM")
    .nullable()
    .default(null),
});

export const rangeQuery = z.object({
  from: z.string().regex(DAY, "must be YYYY-MM-DD").nullable().default(null),
  to: z.string().regex(DAY, "must be YYYY-MM-DD").nullable().default(null),
});

const SOURCES: RevenueSource[] = ["mobile_money", "card", "cash"];

/** Whole percent of `total`, 0 when there is no total. */
const percentOf = (count: number, total: number) =>
  total > 0 ? Math.round((count / total) * 100) : 0;

/**
 * The dashboard and revenue figures, computed here rather than in the web (ADR-0003), by the
 * business calendar of Africa/Dar_es_Salaam. Managers see their venues' usage and no revenue.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly db: PrismaService) {}

  async summary(staff: StaffPrincipal): Promise<AnalyticsSummary> {
    const venues = await this.venueIds(staff);
    const inScope = venueFilter(Prisma.sql`venue_id`, venues);
    const weekAgo = new Date(Date.now() - 7 * DAY_MS);
    const [row] = await this.db.$queryRaw<
      {
        active: number;
        total: number;
        devices: number;
        week_up: bigint;
        week_down: bigint;
        all_up: bigint;
        all_down: bigint;
      }[]
    >`
      SELECT count(*) FILTER (WHERE status = 'connected')::int AS active,
             count(*)::int AS total,
             count(DISTINCT device_id)::int AS devices,
             COALESCE(SUM(upload_bytes) FILTER (WHERE started_at >= ${weekAgo}), 0)::bigint AS week_up,
             COALESCE(SUM(download_bytes) FILTER (WHERE started_at >= ${weekAgo}), 0)::bigint AS week_down,
             COALESCE(SUM(upload_bytes), 0)::bigint AS all_up,
             COALESCE(SUM(download_bytes), 0)::bigint AS all_down
      FROM wifi_sessions WHERE ${inScope}`;
    let revenue: string | null = null;
    if (venues === null) {
      const month = this.currentMonth();
      const [sum] = await this.db.$queryRaw<{ amount: string }[]>`
        WITH ${REVENUE_EVENTS}
        SELECT ${moneySum(Prisma.sql`amount`)} AS amount FROM revenue_events
        WHERE ${businessMonthSql(Prisma.sql`occurred_at`)} = ${`${month}-01`}::date`;
      revenue = sum?.amount ?? "0.00";
    }
    return {
      activeSessions: row?.active ?? 0,
      totalSessions: row?.total ?? 0,
      devices: row?.devices ?? 0,
      weeklyUploadBytes: bytes(row?.week_up ?? 0n),
      weeklyDownloadBytes: bytes(row?.week_down ?? 0n),
      allTimeUploadBytes: bytes(row?.all_up ?? 0n),
      allTimeDownloadBytes: bytes(row?.all_down ?? 0n),
      revenueThisMonthTsh: revenue,
    };
  }

  /** Every business day from `from` to `to` (inclusive), 30 days to today by default. */
  async dailyUsage(staff: StaffPrincipal, range: z.infer<typeof rangeQuery>): Promise<DailyUsage> {
    const today = businessDayOf(new Date());
    const to = range.to ?? today;
    const from = range.from ?? businessDayOf(new Date(Date.parse(`${to}T12:00:00Z`) - 29 * DAY_MS));
    const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
    if (!Number.isFinite(span) || span < 0 || span > 366) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          from: "must be on or before `to`, at most 366 days earlier",
        }),
      );
    }
    const venues = await this.venueIds(staff);
    const rows = await this.db.$queryRaw<
      { date: string; up: bigint; down: bigint; revenue: string }[]
    >`
      WITH ${REVENUE_EVENTS},
      days AS (SELECT d::date AS date FROM generate_series(${from}::date, ${to}::date, '1 day') d),
      usage AS (
        SELECT ${businessDaySql(Prisma.sql`started_at`)} AS date,
               SUM(upload_bytes) AS up, SUM(download_bytes) AS down
        FROM wifi_sessions WHERE ${venueFilter(Prisma.sql`venue_id`, venues)} GROUP BY 1
      ),
      money AS (
        SELECT ${businessDaySql(Prisma.sql`occurred_at`)} AS date, SUM(amount) AS amount
        FROM revenue_events GROUP BY 1
      )
      SELECT to_char(days.date, 'YYYY-MM-DD') AS date,
             COALESCE(usage.up, 0)::bigint AS up, COALESCE(usage.down, 0)::bigint AS down,
             COALESCE(money.amount, 0)::numeric(14,2)::text AS revenue
      FROM days
      LEFT JOIN usage ON usage.date = days.date
      LEFT JOIN money ON money.date = days.date
      ORDER BY days.date`;
    return {
      days: rows.map((r) => ({
        date: r.date,
        uploadBytes: bytes(r.up),
        downloadBytes: bytes(r.down),
        revenueTsh: venues === null ? r.revenue : null,
      })),
    };
  }

  /** The last six business months, this one included. Admins only. */
  async monthly(): Promise<MonthlyTrend> {
    const month = this.currentMonth();
    const rows = await this.db.$queryRaw<{ month: string; revenue: string; devices: number }[]>`
      WITH ${REVENUE_EVENTS},
      months AS (
        SELECT m::date AS month
        FROM generate_series(${`${month}-01`}::date - interval '5 months', ${`${month}-01`}::date, '1 month') m
      ),
      money AS (
        SELECT ${businessMonthSql(Prisma.sql`occurred_at`)} AS month, SUM(amount) AS amount
        FROM revenue_events GROUP BY 1
      ),
      seen AS (
        SELECT ${businessMonthSql(Prisma.sql`first_seen_at`)} AS month, count(*)::int AS devices
        FROM devices GROUP BY 1
      )
      SELECT to_char(months.month, 'YYYY-MM') AS month,
             COALESCE(money.amount, 0)::numeric(14,2)::text AS revenue,
             COALESCE(seen.devices, 0)::int AS devices
      FROM months
      LEFT JOIN money ON money.month = months.month
      LEFT JOIN seen ON seen.month = months.month
      ORDER BY months.month`;
    return {
      months: rows.map((r) => ({ month: r.month, revenueTsh: r.revenue, newDevices: r.devices })),
    };
  }

  /** Active vouchers by package. */
  async packageShares(staff: StaffPrincipal): Promise<PackageShares> {
    const venues = await this.venueIds(staff);
    const rows = await this.db.$queryRaw<
      { package_id: string | null; name: string | null; count: number }[]
    >`
      SELECT v.package_id, p.name, count(*)::int AS count
      FROM vouchers v LEFT JOIN packages p ON p.id = v.package_id
      WHERE v.status = 'active' AND ${venueFilter(Prisma.sql`v.venue_id`, venues)}
      GROUP BY v.package_id, p.name ORDER BY count DESC`;
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    return {
      packages: rows.map((r) => ({
        packageId: r.package_id,
        packageName: r.name,
        count: r.count,
        percentage: percentOf(r.count, total),
      })),
    };
  }

  /** Devices by reported type, among devices that had a session in scope. */
  async deviceTypes(staff: StaffPrincipal): Promise<DeviceTypeShares> {
    const venues = await this.venueIds(staff);
    const rows = await this.db.$queryRaw<{ type: string; count: number }[]>`
      SELECT lower(d.device_type) AS type, count(*)::int AS count
      FROM devices d
      WHERE d.device_type IS NOT NULL
        AND (${venues === null} OR EXISTS (
          SELECT 1 FROM wifi_sessions s
          WHERE s.device_id = d.id AND ${venueFilter(Prisma.sql`s.venue_id`, venues)}))
      GROUP BY 1 ORDER BY count DESC`;
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    return {
      types: rows.map((r) => ({
        type: r.type,
        count: r.count,
        percentage: percentOf(r.count, total),
      })),
    };
  }

  /** The ten active venues with the most revenue, then the most devices. Admins only. */
  async topVenues(): Promise<TopVenues> {
    const rows = await this.db.$queryRaw<
      { id: string; name: string; devices: number; revenue: string }[]
    >`
      WITH ${REVENUE_EVENTS},
      money AS (SELECT venue_id, SUM(amount) AS amount FROM revenue_events GROUP BY venue_id),
      seen AS (
        SELECT venue_id, count(DISTINCT device_id)::int AS devices
        FROM wifi_sessions GROUP BY venue_id
      )
      SELECT v.id, v.name, COALESCE(seen.devices, 0)::int AS devices,
             COALESCE(money.amount, 0)::numeric(14,2)::text AS revenue
      FROM venues v
      LEFT JOIN money ON money.venue_id = v.id
      LEFT JOIN seen ON seen.venue_id = v.id
      WHERE v.status = 'active'
      ORDER BY COALESCE(money.amount, 0) DESC, devices DESC, v.name
      LIMIT 10`;
    return {
      venues: rows.map((r) => ({
        venueId: r.id,
        venueName: r.name,
        devices: r.devices,
        revenueTsh: r.revenue,
      })),
    };
  }

  async revenueSummary(query: z.infer<typeof monthQuery>): Promise<RevenueSummary> {
    const month = query.month ?? this.currentMonth();
    const start = `${month}-01`;
    const today = businessDayOf(new Date());
    const rows = await this.db.$queryRaw<
      {
        source: RevenueSource;
        all_time: string;
        month: string;
        last_month: string;
        today: string;
      }[]
    >`
      WITH ${REVENUE_EVENTS}
      SELECT source,
             ${moneySum(Prisma.sql`amount`)} AS all_time,
             COALESCE(SUM(amount) FILTER (
               WHERE ${businessMonthSql(Prisma.sql`occurred_at`)} = ${start}::date
             ), 0)::numeric(14,2)::text AS month,
             COALESCE(SUM(amount) FILTER (
               WHERE ${businessMonthSql(Prisma.sql`occurred_at`)} = (${start}::date - interval '1 month')::date
             ), 0)::numeric(14,2)::text AS last_month,
             COALESCE(SUM(amount) FILTER (
               WHERE ${businessDaySql(Prisma.sql`occurred_at`)} = ${today}::date
             ), 0)::numeric(14,2)::text AS today
      FROM revenue_events GROUP BY source`;
    const of = (source: RevenueSource) => rows.find((r) => r.source === source) ?? null;
    const total = (pick: (r: (typeof rows)[number]) => string) => sumMoney(rows.map(pick));
    const thisMonth = total((r) => r.month);
    const lastMonth = total((r) => r.last_month);
    const last = Number(lastMonth);
    return {
      month,
      today: total((r) => r.today),
      thisMonth,
      lastMonth,
      allTime: total((r) => r.all_time),
      monthGrowthPct: last > 0 ? Math.round(((Number(thisMonth) - last) / last) * 100) : null,
      bySource: Object.fromEntries(
        SOURCES.map((source) => [
          source,
          { allTime: of(source)?.all_time ?? "0.00", month: of(source)?.month ?? "0.00" },
        ]),
      ) as RevenueSummary["bySource"],
    };
  }

  async revenueByPackage(query: z.infer<typeof monthQuery>): Promise<RevenueByPackage> {
    const month = query.month ?? this.currentMonth();
    const rows = await this.db.$queryRaw<
      { package_id: string | null; name: string | null; revenue: string; sales: number }[]
    >`
      WITH ${REVENUE_EVENTS}
      SELECT e.package_id, p.name, ${moneySum(Prisma.sql`e.amount`)} AS revenue,
             count(*)::int AS sales
      FROM revenue_events e LEFT JOIN packages p ON p.id = e.package_id
      WHERE ${businessMonthSql(Prisma.sql`e.occurred_at`)} = ${`${month}-01`}::date
      GROUP BY e.package_id, p.name ORDER BY SUM(e.amount) DESC`;
    return {
      month,
      packages: rows.map((r) => ({
        packageId: r.package_id,
        packageName: r.name,
        revenueTsh: r.revenue,
        sales: r.sales,
      })),
    };
  }

  async revenueByVenue(query: z.infer<typeof monthQuery>): Promise<RevenueByVenue> {
    const month = query.month ?? this.currentMonth();
    const rows = await this.db.$queryRaw<
      { venue_id: string | null; name: string | null; revenue: string }[]
    >`
      WITH ${REVENUE_EVENTS}
      SELECT e.venue_id, v.name, ${moneySum(Prisma.sql`e.amount`)} AS revenue
      FROM revenue_events e LEFT JOIN venues v ON v.id = e.venue_id
      WHERE ${businessMonthSql(Prisma.sql`e.occurred_at`)} = ${`${month}-01`}::date
      GROUP BY e.venue_id, v.name ORDER BY SUM(e.amount) DESC`;
    return {
      month,
      venues: rows.map((r) => ({ venueId: r.venue_id, venueName: r.name, revenueTsh: r.revenue })),
    };
  }

  async transactions(query: z.infer<typeof monthQuery>): Promise<RevenueTransactions> {
    const month = query.month ?? this.currentMonth();
    const rows = await this.db.$queryRaw<
      {
        id: string;
        source: RevenueSource;
        amount: string;
        package_name: string | null;
        venue_name: string | null;
        reference: string | null;
        occurred_at: Date;
      }[]
    >`
      WITH ${REVENUE_EVENTS}
      SELECT e.id, e.source, e.amount::numeric(14,2)::text AS amount, p.name AS package_name,
             v.name AS venue_name, e.reference, e.occurred_at
      FROM revenue_events e
      LEFT JOIN packages p ON p.id = e.package_id
      LEFT JOIN venues v ON v.id = e.venue_id
      WHERE ${businessMonthSql(Prisma.sql`e.occurred_at`)} = ${`${month}-01`}::date
      ORDER BY e.occurred_at DESC LIMIT 50`;
    return {
      month,
      transactions: rows.map((r) => ({
        id: r.id,
        source: r.source,
        amountTsh: r.amount,
        packageName: r.package_name,
        venueName: r.venue_name,
        reference: r.reference,
        occurredAt: r.occurred_at.toISOString(),
      })),
    };
  }

  /** Null for an admin (every venue); the venues a manager operates otherwise. */
  private async venueIds(staff: StaffPrincipal): Promise<string[] | null> {
    if (staff.role === "admin") return null;
    const venues = await this.db.venue.findMany({
      where: { operatorId: staff.id },
      select: { id: true },
    });
    return venues.map((v) => v.id);
  }

  private currentMonth(): BusinessMonth {
    return businessDayOf(new Date()).slice(0, 7);
  }
}

/** Adds two-decimal money strings in whole cents, so no float error reaches a total. */
function sumMoney(amounts: string[]): string {
  const cents = amounts.reduce((sum, a) => sum + BigInt(Math.round(Number(a) * 100)), 0n);
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
