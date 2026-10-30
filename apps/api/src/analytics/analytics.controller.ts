import type {
  AnalyticsSummary,
  DailyUsage,
  DeviceTypeShares,
  MonthlyTrend,
  PackageShares,
  RevenueByPackage,
  RevenueByVenue,
  RevenueSummary,
  RevenueTransactions,
  TopVenues,
} from "@hashifi/types";
import { Controller, Get, Query } from "@nestjs/common";
import { CurrentStaff, Roles, type StaffPrincipal } from "../auth/staff-guard.js";
import { parseInput } from "../http/validation.js";
import { AnalyticsService, monthQuery, rangeQuery } from "./analytics.service.js";

/** Usage over the caller's venues; revenue figures only for admins. */
@Controller("api/analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("summary")
  summary(@CurrentStaff() staff: StaffPrincipal): Promise<AnalyticsSummary> {
    return this.analytics.summary(staff);
  }

  @Get("daily-usage")
  dailyUsage(@CurrentStaff() staff: StaffPrincipal, @Query() query: unknown): Promise<DailyUsage> {
    return this.analytics.dailyUsage(staff, parseInput(rangeQuery, query));
  }

  @Get("monthly")
  @Roles("admin")
  monthly(): Promise<MonthlyTrend> {
    return this.analytics.monthly();
  }

  @Get("packages")
  packages(@CurrentStaff() staff: StaffPrincipal): Promise<PackageShares> {
    return this.analytics.packageShares(staff);
  }

  @Get("devices")
  devices(@CurrentStaff() staff: StaffPrincipal): Promise<DeviceTypeShares> {
    return this.analytics.deviceTypes(staff);
  }

  @Get("venues")
  @Roles("admin")
  venues(): Promise<TopVenues> {
    return this.analytics.topVenues();
  }
}

/** Revenue, by the business month (`?month=YYYY-MM`, this month by default). Admins only. */
@Controller("api/revenue")
@Roles("admin")
export class RevenueController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("summary")
  summary(@Query() query: unknown): Promise<RevenueSummary> {
    return this.analytics.revenueSummary(parseInput(monthQuery, query));
  }

  @Get("by-package")
  byPackage(@Query() query: unknown): Promise<RevenueByPackage> {
    return this.analytics.revenueByPackage(parseInput(monthQuery, query));
  }

  @Get("by-venue")
  byVenue(@Query() query: unknown): Promise<RevenueByVenue> {
    return this.analytics.revenueByVenue(parseInput(monthQuery, query));
  }

  @Get("transactions")
  transactions(@Query() query: unknown): Promise<RevenueTransactions> {
    return this.analytics.transactions(parseInput(monthQuery, query));
  }
}
