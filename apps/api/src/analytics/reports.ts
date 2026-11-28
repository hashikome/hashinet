import type {
  AnalyticsPeriod,
  PlatformSalesReport,
  SalesReport,
  Series,
  UsageReport,
} from "@hashinet/types";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sellingStopped } from "../billing/access-rule.js";
import { businessFeeTerms } from "../billing/billing-settings.js";
import { feeOnSales } from "../billing/fee.js";
import type { Principal } from "../core/access/principal.js";
import { venueScope } from "../core/access/venue-scope.js";
import { PrismaService } from "../core/database/prisma.service.js";
import { apiError } from "../core/http/error-envelope.js";
import { addDays, BUSINESS_TIME_ZONE, businessNow } from "../core/time/business-day.js";
import { Prisma } from "../generated/prisma/client.js";
import { sellingOf } from "../network/routers/router-journey.js";
import { instantsOf, type PeriodQuery, periodOf } from "./period.js";
import { centsOf, money, REVENUE_EVENTS, shareOf, venueFilter } from "./revenue-events.js";

/** The hours Peak hours shows, 06:00 to 21:00, as the prototype's heatmap does. */
const PEAK_HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

/** `occurred_at`-style column as a bucket key: the business day, or day and hour. */
const keySql = (column: Prisma.Sql, period: AnalyticsPeriod) =>
  Prisma.sql`to_char(${column} AT TIME ZONE ${BUSINESS_TIME_ZONE}, ${
    period.show === "hour" ? 'YYYY-MM-DD"T"HH24' : "YYYY-MM-DD"
  })`;

/**
 * A chart's values from keyed amounts: a figure for every past bucket, null after today. Each
 * bucket's keys (its hour, or each of its days) are mapped once.
 */
function seriesOf(period: AnalyticsPeriod, rows: { key: string; value: number }[]): Series {
  const out: Series = period.buckets.map((b) => (b.past ? 0 : null));
  const index = new Map<string, number>();
  period.buckets.forEach((b, i) => {
    if (b.start.length > 10) index.set(b.start, i);
    else for (let d = b.start; d <= b.last; d = addDays(d, 1)) index.set(d, i);
  });
  for (const r of rows) {
    const i = index.get(r.key);
    const at = i === undefined ? null : out[i];
    if (i !== undefined && at !== null && at !== undefined) out[i] = at + r.value;
  }
  return out;
}

/**
 * Analytics' reports (prototype `usage`, `businessSales`, `platformAnalytics`), computed from
 * recorded rows only: sales from `revenue_events`, so they agree with Payments and Overview; usage
 * from the sessions the routers report. Periods are business days in Africa/Dar_es_Salaam.
 */
@Injectable()
export class AnalyticsReports {
  constructor(private readonly db: PrismaService) {}

  async sales(staff: Principal, query: PeriodQuery, now = new Date()): Promise<SalesReport> {
    if (staff.scope === "platform") {
      throw new ForbiddenException(apiError("FORBIDDEN", "These figures are a business's own."));
    }
    const period = periodOf(query, businessNow(now));
    const venues = await this.venues(staff, query.venueId);
    const rows = await this.events(
      period,
      venues.map((v) => v.id),
    );
    // One pass: the totals, each package's and each venue's.
    let take = 0;
    let gross = 0;
    let vouchers = 0;
    const byPackage = new Map<
      string,
      { id: string | null; name: string; vouchers: number; cents: number }
    >();
    const byVenue = new Map<string, { vouchers: number; cents: number }>();
    for (const r of rows) {
      const cents = centsOf(r.amount);
      const sold = r.kind === "sale" ? r.n : 0;
      take += cents;
      vouchers += sold;
      if (r.kind === "sale") gross += cents;
      const key = r.package_id ?? "";
      const p = byPackage.get(key) ?? {
        id: r.package_id,
        name: r.package_name ?? "Removed package",
        vouchers: 0,
        cents: 0,
      };
      p.cents += cents;
      p.vouchers += sold;
      byPackage.set(key, p);
      if (r.venue_id !== null) {
        const v = byVenue.get(r.venue_id) ?? { vouchers: 0, cents: 0 };
        v.cents += cents;
        v.vouchers += sold;
        byVenue.set(r.venue_id, v);
      }
    }
    const packages = [...byPackage.values()].sort(
      (a, b) => b.vouchers - a.vouchers || b.cents - a.cents,
    );
    const best = packages[0];
    const days = Math.max(period.days, 1);
    return {
      period,
      empty: rows.length === 0,
      takingsTsh: money(take),
      vouchers,
      takingsPerDayTsh: money(Math.round(take / days / 100) * 100),
      vouchersPerDay: Math.round(vouchers / days),
      averageSaleTsh: vouchers ? money(Math.round(gross / vouchers)) : null,
      bestSeller: best && best.vouchers > 0 ? { name: best.name, vouchers: best.vouchers } : null,
      series: seriesOf(
        period,
        rows.map((r) => ({ key: r.key, value: centsOf(r.amount) / 100 })),
      ),
      venues: venues
        .map((v) => ({ v, t: byVenue.get(v.id) ?? { vouchers: 0, cents: 0 } }))
        .sort((a, b) => b.t.cents - a.t.cents)
        .map(({ v, t }) => ({
          venueId: v.id,
          name: v.name,
          vouchers: t.vouchers,
          takingsTsh: money(t.cents),
          share: shareOf(t.cents, take),
        })),
      packages: packages.map((p) => ({
        packageId: p.id,
        name: p.name,
        vouchers: p.vouchers,
        takingsTsh: money(p.cents),
        share: shareOf(p.vouchers, vouchers),
        takingsShare: shareOf(p.cents, take),
      })),
    };
  }

  /**
   * Sales across businesses, and HashiNet's fee on them: each venue's net sales in each business
   * month of the period by its business's own terms (ADR-0013, 3), before any monthly minimum.
   */
  async platformSales(query: PeriodQuery, now = new Date()): Promise<PlatformSalesReport> {
    const period = periodOf(query, businessNow(now));
    const [rows, businesses] = await Promise.all([
      this.events(period, null),
      this.db.business.findMany({
        select: {
          id: true,
          name: true,
          createdAt: true,
          access: true,
          feeRateBp: true,
          feeLowerRateBp: true,
          feeLowerRateAboveTsh: true,
          feeMinimumTsh: true,
          venues: {
            select: {
              id: true,
              routers: {
                select: {
                  status: true,
                  internetOk: true,
                  lastSetup: true,
                  lastSeenAt: true,
                  internetSeenAt: true,
                },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      }),
    ]);
    const businessOf = new Map(businesses.flatMap((b) => b.venues.map((v) => [v.id, b])));
    // One pass: each business's sales, and each venue's month for the fee.
    const sales = new Map<string, number>();
    const months = new Map<string, { business: (typeof businesses)[number]; cents: number }>();
    for (const r of rows) {
      const b = r.venue_id === null ? null : (businessOf.get(r.venue_id) ?? null);
      if (b === null) continue;
      const cents = centsOf(r.amount);
      sales.set(b.id, (sales.get(b.id) ?? 0) + cents);
      const k = `${r.venue_id} ${r.key.slice(0, 7)}`;
      const m = months.get(k) ?? { business: b, cents: 0 };
      m.cents += cents;
      months.set(k, m);
    }
    const fees = new Map<string, number>();
    for (const { business, cents } of months.values()) {
      const fee = feeOnSales(Math.round(cents / 100), businessFeeTerms(business));
      fees.set(business.id, (fees.get(business.id) ?? 0) + fee * 100);
    }
    const total = [...sales.values()].reduce((a, c) => a + c, 0);
    const serving = businesses.flatMap((b) =>
      b.venues.map((v) => !sellingStopped(b.access) && sellingOf(v.routers).state === "selling"),
    );
    const { from, to } = instantsOf(period);
    return {
      period,
      empty: rows.length === 0,
      salesTsh: money(total),
      feesTsh: money([...fees.values()].reduce((a, c) => a + c, 0)),
      venuesServing: serving.filter(Boolean).length,
      venuesNotServing: serving.filter((x) => !x).length,
      newBusinesses: businesses
        .filter((b) => b.createdAt >= from && b.createdAt < to)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((b) => ({ id: b.id, name: b.name })),
      series: seriesOf(
        period,
        rows.map((r) => ({ key: r.key, value: centsOf(r.amount) / 100 })),
      ),
      businesses: businesses
        .map((b) => ({ b, cents: sales.get(b.id) ?? 0 }))
        .sort((x, y) => y.cents - x.cents)
        .map(({ b, cents }) => ({
          businessId: b.id,
          name: b.name,
          venues: b.venues.length,
          salesTsh: money(cents),
          share: shareOf(cents, total),
          feeTsh: money(fees.get(b.id) ?? 0),
        })),
    };
  }

  async usage(staff: Principal, query: PeriodQuery, now = new Date()): Promise<UsageReport> {
    const period = periodOf(query, businessNow(now));
    const platform = staff.scope === "platform";
    const venues = await this.venues(staff, query.venueId);
    const ids = venues.map((v) => v.id);
    const inScope = venueFilter(
      Prisma.sql`venue_id`,
      platform && query.venueId === null ? null : ids,
    );
    const { from, to } = instantsOf(period);
    const started = Prisma.sql`started_at >= ${from} AND started_at < ${to} AND ${inScope}`;
    const who = Prisma.sql`COALESCE(device_id::text, mac_address)`;
    const [series, [found], byVenue, online, peak] = await Promise.all([
      this.db.$queryRaw<{ key: string; n: number }[]>`
        SELECT ${keySql(Prisma.sql`started_at`, period)} AS key, count(*)::int AS n
        FROM wifi_sessions WHERE ${started} GROUP BY 1`,
      this.db.$queryRaw<
        {
          sessions: number;
          devices: number;
          returning: number;
          minutes: number | null;
          bytes: bigint;
        }[]
      >`
        WITH s AS (
          SELECT ${who} AS who, started_at, COALESCE(ended_at, ${now}) AS ended,
                 upload_bytes + download_bytes AS bytes,
                 (started_at AT TIME ZONE ${BUSINESS_TIME_ZONE})::date AS day
          FROM wifi_sessions WHERE ${started})
        SELECT count(*)::int AS sessions,
               count(DISTINCT who)::int AS devices,
               (SELECT count(*)::int FROM (SELECT who FROM s GROUP BY who
                                          HAVING count(DISTINCT day) >= 2) r) AS returning,
               (avg(extract(epoch FROM ended - started_at)) / 60)::float8 AS minutes,
               COALESCE(sum(bytes), 0)::bigint AS bytes
        FROM s`,
      this.db.$queryRaw<{ venue_id: string; sessions: number; devices: number; bytes: bigint }[]>`
        SELECT venue_id, count(*)::int AS sessions, count(DISTINCT ${who})::int AS devices,
               COALESCE(sum(upload_bytes + download_bytes), 0)::bigint AS bytes
        FROM wifi_sessions WHERE ${started} AND venue_id IS NOT NULL GROUP BY venue_id`,
      this.db.$queryRaw<{ venue_id: string; n: number }[]>`
        SELECT venue_id, count(*)::int AS n FROM wifi_sessions
        WHERE status = 'connected' AND venue_id IS NOT NULL AND ${inScope} GROUP BY venue_id`,
      // Each hour a session was online in, by device; then the most devices in one hour, by
      // weekday and hour of day.
      this.db.$queryRaw<{ dow: number; hour: number; peak: number }[]>`
        WITH s AS (
          SELECT ${who} AS who,
                 (GREATEST(started_at, ${from}) AT TIME ZONE ${BUSINESS_TIME_ZONE}) AS a,
                 (LEAST(COALESCE(ended_at, ${now}), ${to}) AT TIME ZONE ${BUSINESS_TIME_ZONE}) AS b
          FROM wifi_sessions
          WHERE started_at < ${to} AND COALESCE(ended_at, ${now}) > ${from} AND ${inScope}),
        h AS (
          SELECT who, gs AS at FROM s,
                 generate_series(date_trunc('hour', s.a), s.b, interval '1 hour') gs
          WHERE s.b > s.a),
        n AS (SELECT at, count(DISTINCT who) AS devices FROM h GROUP BY at)
        SELECT extract(isodow FROM at)::int AS dow, extract(hour FROM at)::int AS hour,
               max(devices)::int AS peak
        FROM n GROUP BY 1, 2`,
    ]);
    const days = Array.from({ length: 7 }, () => PEAK_HOURS.map(() => 0));
    let max = 0;
    let at: { weekday: number; hour: number } | null = null;
    for (const p of peak) {
      const hi = PEAK_HOURS.indexOf(p.hour);
      const row = days[p.dow - 1];
      if (hi < 0 || !row) continue;
      row[hi] = p.peak;
      if (p.peak > max) {
        max = p.peak;
        at = { weekday: p.dow - 1, hour: p.hour };
      }
    }
    // One row, always: the aggregate over the period.
    const totals = found ?? { sessions: 0, devices: 0, returning: 0, minutes: null, bytes: 0n };
    const dataBytes = Number(totals.bytes);
    const used = new Map(byVenue.map((r) => [r.venue_id, r]));
    const onlineAt = new Map(online.map((r) => [r.venue_id, r.n]));
    return {
      period,
      empty: totals.sessions === 0,
      devices: totals.devices,
      returning: totals.returning,
      sessions: totals.sessions,
      sessionsPerDay: Math.round(totals.sessions / Math.max(period.days, 1)),
      averageSessionMinutes: totals.minutes === null ? null : Math.round(totals.minutes),
      dataBytes,
      dataPerSessionBytes: totals.sessions ? Math.round(dataBytes / totals.sessions) : 0,
      series: seriesOf(
        period,
        series.map((r) => ({ key: r.key, value: r.n })),
      ),
      peak: { hours: PEAK_HOURS, days, max, at },
      venues: venues
        .map((v) => {
          const u = used.get(v.id);
          return {
            venueId: v.id,
            name: v.name,
            business: platform ? v.business : null,
            devices: u?.devices ?? 0,
            sessions: u?.sessions ?? 0,
            dataBytes: Number(u?.bytes ?? 0n),
            onlineNow: onlineAt.get(v.id) ?? 0,
          };
        })
        .sort((a, b) => b.sessions - a.sessions || b.onlineNow - a.onlineNow),
    };
  }

  /** The period's revenue events, by bucket key, venue, package and kind. */
  private events(period: AnalyticsPeriod, venueIds: string[] | null) {
    const { from, to } = instantsOf(period);
    return this.db.$queryRaw<
      {
        key: string;
        venue_id: string | null;
        package_id: string | null;
        package_name: string | null;
        kind: "sale" | "refund";
        amount: string;
        n: number;
      }[]
    >`
      WITH ${REVENUE_EVENTS}
      SELECT ${keySql(Prisma.sql`e.occurred_at`, period)} AS key, e.venue_id, e.package_id,
             p.name AS package_name, e.kind,
             SUM(e.amount)::numeric(14,2)::text AS amount, count(*)::int AS n
      FROM revenue_events e LEFT JOIN packages p ON p.id = e.package_id
      WHERE e.occurred_at >= ${from} AND e.occurred_at < ${to}
        AND ${venueFilter(Prisma.sql`e.venue_id`, venueIds)}
      GROUP BY 1, 2, 3, 4, 5`;
  }

  /** The reader's venues, or the one asked for, which must be one of them. */
  private async venues(
    staff: Principal,
    venueId: string | null,
  ): Promise<{ id: string; name: string; business: string }[]> {
    const rows = await this.db.venue.findMany({
      where: { ...venueScope(staff), ...(venueId === null ? {} : { id: venueId }) },
      select: { id: true, name: true, business: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
    if (venueId !== null && rows.length === 0) {
      throw new NotFoundException(apiError("NOT_FOUND", "There is no such venue."));
    }
    return rows.map((v) => ({ id: v.id, name: v.name, business: v.business.name }));
  }
}
