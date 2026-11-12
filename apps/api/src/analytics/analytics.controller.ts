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
  TodaySummary,
  TopVenues,
} from "@hashinet/types";
import { Controller, Get, Query } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { parseInput } from "../http/validation.js";
import { AnalyticsService, monthQuery, rangeQuery, todayQuery } from "./analytics.service.js";

/** Usage over the caller's venues; a business's own day; revenue reports for HashiNet's staff. */
@Controller("api/analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("summary")
  @Can("analytics.read")
  summary(@CurrentPrincipal() staff: Principal): Promise<AnalyticsSummary> {
    return this.analytics.summary(staff);
  }

  @Get("today")
  @Can("analytics.read")
  today(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<TodaySummary> {
    return this.analytics.today(staff, parseInput(todayQuery, query));
  }

  @Get("daily-usage")
  @Can("analytics.read")
  dailyUsage(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<DailyUsage> {
    return this.analytics.dailyUsage(staff, parseInput(rangeQuery, query));
  }

  @Get("monthly")
  @Can("revenue.read")
  monthly(): Promise<MonthlyTrend> {
    return this.analytics.monthly();
  }

  @Get("packages")
  @Can("analytics.read")
  packages(@CurrentPrincipal() staff: Principal): Promise<PackageShares> {
    return this.analytics.packageShares(staff);
  }

  @Get("devices")
  @Can("analytics.read")
  devices(@CurrentPrincipal() staff: Principal): Promise<DeviceTypeShares> {
    return this.analytics.deviceTypes(staff);
  }

  @Get("venues")
  @Can("revenue.read")
  venues(): Promise<TopVenues> {
    return this.analytics.topVenues();
  }
}

/** Revenue, by the business month (`?month=YYYY-MM`, this month by default). Admins only. */
@Controller("api/revenue")
export class RevenueController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("summary")
  @Can("revenue.read")
  summary(@Query() query: unknown): Promise<RevenueSummary> {
    return this.analytics.revenueSummary(parseInput(monthQuery, query));
  }

  @Get("by-package")
  @Can("revenue.read")
  byPackage(@Query() query: unknown): Promise<RevenueByPackage> {
    return this.analytics.revenueByPackage(parseInput(monthQuery, query));
  }

  @Get("by-venue")
  @Can("revenue.read")
  byVenue(@Query() query: unknown): Promise<RevenueByVenue> {
    return this.analytics.revenueByVenue(parseInput(monthQuery, query));
  }

  @Get("transactions")
  @Can("revenue.read")
  transactions(@Query() query: unknown): Promise<RevenueTransactions> {
    return this.analytics.transactions(parseInput(monthQuery, query));
  }
}
