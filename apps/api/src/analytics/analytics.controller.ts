import type {
  PaymentsReceived,
  PlatformSalesReport,
  SalesReport,
  TodaySummary,
  UsageReport,
  VenueTakings,
} from "@hashinet/types";
import { Controller, Get, Query } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { parseInput } from "../http/validation.js";
import { AnalyticsService, receivedQuery, todayQuery } from "./analytics.service.js";
import { periodQuery } from "./period.js";
import { AnalyticsReports } from "./reports.js";

/** Usage over the caller's venues; a business's own day; revenue reports for HashiNet's staff. */
@Controller("api/analytics")
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly reports: AnalyticsReports,
  ) {}

  /** Each venue's takings, today and over 7 days: Venues and a venue's page (owners and managers). */
  @Get("venue-takings")
  @Can("analytics.read")
  venueTakings(@CurrentPrincipal() staff: Principal): Promise<VenueTakings> {
    return this.analytics.venueTakings(staff);
  }

  /** Sales over a period (prototype `businessSales`): a business's own, or one of its venues. */
  @Get("sales")
  @Can("analytics.read")
  sales(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<SalesReport> {
    return this.reports.sales(staff, parseInput(periodQuery, query));
  }

  /** Sales across businesses and HashiNet's fees (prototype `platformAnalytics`). */
  @Get("platform-sales")
  @Can("analytics.platform.read")
  platformSales(@Query() query: unknown): Promise<PlatformSalesReport> {
    return this.reports.platformSales(parseInput(periodQuery, query));
  }

  /** How the WiFi was used over a period (prototype `usage`), over the reader's venues. */
  @Get("usage")
  @Can("analytics.read")
  usage(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<UsageReport> {
    return this.reports.usage(staff, parseInput(periodQuery, query));
  }

  /** Every business role sees its own day: the Overview is each one's home, as Payments is. */
  @Get("today")
  @Can("payment.read")
  today(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<TodaySummary> {
    return this.analytics.today(staff, parseInput(todayQuery, query));
  }
}

/** What guests paid a business, by the one definition of revenue. */
@Controller("api/payments/received")
export class PaymentsReceivedController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  @Can("payment.read")
  received(
    @CurrentPrincipal() staff: Principal,
    @Query() query: unknown,
  ): Promise<PaymentsReceived> {
    return this.analytics.received(staff, parseInput(receivedQuery, query));
  }
}
