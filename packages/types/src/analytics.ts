import type { DecimalString, Timestamp } from "./core.ts";
import type { PaidTo } from "./venues.ts";

/** A business month in Africa/Dar_es_Salaam, as YYYY-MM. */
export type BusinessMonth = string;
/** A business day in Africa/Dar_es_Salaam, as YYYY-MM-DD. */
export type BusinessDay = string;

/**
 * How money came in: mobile money, a card payment, or cash (a staff-recorded cash sale, or a
 * printed voucher sold for cash, counted when the router confirms it).
 */
export type RevenueSource = "mobile_money" | "card" | "cash";

/**
 * `GET /api/analytics/today` (a business's own): today so far, by the Dar es Salaam day, over the
 * caller's venues or one of them. Sales follow the one definition of revenue.
 */
/**
 * `GET /api/analytics/venue-takings`: each venue's takings in the reader's scope, today and over the last
 * 7 days (today included), net of refunds, as Payments counts them.
 */
export interface VenueTakings {
  venues: {
    venueId: string;
    todayTsh: DecimalString;
    soldToday: number;
    weekTsh: DecimalString;
    soldWeek: number;
  }[];
}

export interface TodaySummary {
  day: BusinessDay;
  /** Devices connected now. */
  onlineNow: number;
  /** Vouchers sold today. */
  sold: number;
  /** Net takings: sales less refunds made today (ADR-0017, 8). */
  takingsTsh: DecimalString;
  /** The money given back today. */
  refundsTsh: DecimalString;
  /** The reader's own cash to hand over: their cash sales today, less the cash they gave back. */
  yourCashTsh: DecimalString;
  /** The same weekday a week ago, up to this time of day, to compare with. */
  lastWeekTakingsTsh: DecimalString;
  /** Every package sold today, the most sold first. */
  byPackage: {
    packageId: string | null;
    name: string | null;
    sold: number;
    takingsTsh: DecimalString;
  }[];
}

/**
 * `GET /api/payments/received` (a business's own): what guests paid in a month, by the one
 * definition of revenue: every sale recorded or paid online, and every printed voucher once a
 * guest used it. Newest first, a page at a time.
 */
export interface PaymentsReceived {
  month: BusinessMonth;
  /** Whether `month` is this month, so its figures are "so far". */
  current: boolean;
  /** This month and the months with payments, newest first, for choosing another. */
  months: BusinessMonth[];
  totalTsh: DecimalString;
  count: number;
  payments: {
    id: string;
    source: RevenueSource;
    /** A sale at the counter or paid online, or a refund, its own row with a negative amount
     * (ADR-0017, 8). */
    kind: "sale" | "refund";
    amountTsh: DecimalString;
    packageName: string | null;
    venueName: string | null;
    /** The provider's reference for a mobile-money payment. Never a phone. */
    reference: string | null;
    /** Who sold it or refunded it; null for a guest's own purchase on the portal. */
    by: string | null;
    /** A mobile money sale at the counter: the way to pay that was read out, as it was then. */
    paidTo: PaidTo | null;
    occurredAt: Timestamp;
  }[];
  /** Pass as `before` for the next page; null on the last. */
  nextBefore: string | null;
}

/** Analytics' Range (prototype `anFilters`): the last few, the current one, or chosen dates. */
export type PeriodRange = "last" | "current" | "custom";
/** A named period: Last offers day (yesterday) to year; Current offers day to year. */
export type PeriodName = "day" | "7d" | "30d" | "90d" | "week" | "month" | "quarter" | "year";
/** How a chart groups its period. */
export type AnalyticsShow = "hour" | "day" | "week" | "month";

/**
 * The period a report covers, as the API decides it: its first and last business day, the day its
 * figures run to (today at the latest), the units it may show and the one shown, and the chart's
 * buckets: each one's first business day (or `YYYY-MM-DDTHH` for an hour) and last day. A bucket
 * after today is not `past`, and has no figure.
 */
export interface AnalyticsPeriod {
  range: PeriodRange;
  /** Null for a custom period. */
  period: PeriodName | null;
  /** The periods each named range offers, for the filter. */
  periods: Record<"last" | "current", PeriodName[]>;
  start: BusinessDay;
  end: BusinessDay;
  through: BusinessDay;
  /** The days from `start` to `through`: what "a day on average" divides by; 0 before it starts. */
  days: number;
  shows: AnalyticsShow[];
  show: AnalyticsShow;
  /**
   * `complete` is false for a bucket its figure covers only part of: a week or month the period
   * cuts short, or today, or this hour. The chart draws the line to it as "so far".
   */
  buckets: { start: string; last: BusinessDay; past: boolean; complete: boolean }[];
}

/** A chart's values, one per bucket of the period; null after today. */
export type Series = (number | null)[];

/**
 * `GET /api/analytics/sales` (a business's own, or one venue's): its takings by the one definition
 * of revenue, net of refunds, as Payments counts them.
 */
export interface SalesReport {
  period: AnalyticsPeriod;
  /** Nothing sold or refunded in the period. */
  empty: boolean;
  takingsTsh: DecimalString;
  /** Vouchers sold: sales, not refunds. */
  vouchers: number;
  /** Over the period's days so far: what "a day on average" says. */
  takingsPerDayTsh: DecimalString;
  vouchersPerDay: number;
  /** What a voucher sold for on average, before refunds; null with none sold. */
  averageSaleTsh: DecimalString | null;
  /** The package sold most; null with none sold. */
  bestSeller: { name: string; vouchers: number } | null;
  /** Net takings per bucket, in whole shillings. */
  series: Series;
  /** Each venue in the reader's scope, the most taken first. */
  venues: {
    venueId: string;
    name: string;
    vouchers: number;
    takingsTsh: DecimalString;
    share: number;
  }[];
  /**
   * What guests buy: each package's vouchers and net takings, the most sold first, with its whole
   * percent of the vouchers sold and of the takings.
   */
  packages: {
    packageId: string | null;
    name: string;
    vouchers: number;
    takingsTsh: DecimalString;
    share: number;
    takingsShare: number;
  }[];
}

/** `GET /api/analytics/platform-sales` (HashiNet's team): sales across businesses and the fees. */
export interface PlatformSalesReport {
  period: AnalyticsPeriod;
  empty: boolean;
  salesTsh: DecimalString;
  /**
   * What HashiNet's fee on those sales comes to: each venue's net sales in the period by its
   * business's own fee terms, before any monthly minimum.
   */
  feesTsh: DecimalString;
  venuesServing: number;
  venuesNotServing: number;
  /** Businesses created in the period, newest first. */
  newBusinesses: { id: string; name: string }[];
  series: Series;
  businesses: {
    businessId: string;
    name: string;
    venues: number;
    salesTsh: DecimalString;
    share: number;
    feeTsh: DecimalString;
  }[];
}

/**
 * `GET /api/analytics/usage`: how the WiFi was used, from the sessions the routers report, over the
 * reader's venues (every venue for HashiNet's team) or one of them.
 */
export interface UsageReport {
  period: AnalyticsPeriod;
  /** No session started in the period. */
  empty: boolean;
  /** Distinct devices with a session started in the period. */
  devices: number;
  /** Of those, the ones seen on two or more business days. */
  returning: number;
  sessions: number;
  /** Over the period's days so far: what "a day on average" says. */
  sessionsPerDay: number;
  /** The average session, from its start to its end (or now); null with none. */
  averageSessionMinutes: number | null;
  /** Every session's data, counted on the day it started, and per session. */
  dataBytes: number;
  dataPerSessionBytes: number;
  /** Sessions started per bucket. */
  series: Series;
  /**
   * Peak hours: for each weekday (Monday first) and hour from 06:00 to 21:00, the most devices
   * online at once in that hour on any one day of the period.
   */
  peak: {
    hours: number[];
    days: number[][];
    max: number;
    at: { weekday: number; hour: number } | null;
  };
  /** Each venue, the most sessions first; `business` for HashiNet's team. */
  venues: {
    venueId: string;
    name: string;
    business: string | null;
    devices: number;
    sessions: number;
    dataBytes: number;
    onlineNow: number;
  }[];
}
