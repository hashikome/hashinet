import type {
  AnalyticsPeriod,
  PlatformSalesReport,
  SalesReport,
  Series,
  UsageReport,
} from "@hashinet/types";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Principal } from "../access/principal.js";
import { venueScope } from "../access/venue-scope.js";
import { sellingStopped } from "../billing/access-rule.js";
import { businessFeeTerms } from "../billing/billing-settings.js";
import { feeOnSales } from "../billing/fee.js";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { apiError } from "../http/error-envelope.js";
import { sellingOf } from "../routers/router-journey.js";
import { addDays, BUSINESS_TIME_ZONE, businessDayOf, businessDayStart } from "./business-day.js";
import { type PeriodQuery, periodOf } from "./period.js";
import { REVENUE_EVENTS, venueFilter } from "./revenue-events.js";

/** The hours Peak hours shows, 06:00 to 21:00, as the prototype's heatmap does. */
const PEAK_HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

/** Shillings as two-decimal text, from whole cents. */
const money = (cents: number) => (cents / 100).toFixed(2);
const centsOf = (amount: string) => Math.round(Number(amount) * 100);
const shareOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** The business day and hour it is now. */
function nowHere(now: Date): { day: string; hour: number } {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: BUSINESS_TIME_ZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return { day: businessDayOf(now), hour };
}

/** `occurred_at`-style column as a bucket key: the business day, or day and hour. */
const keySql = (column: Prisma.Sql, period: AnalyticsPeriod) =>
  Prisma.sql`to_char(${column} AT TIME ZONE ${BUSINESS_TIME_ZONE}, ${
    period.show === "hour" ? 'YYYY-MM-DD"T"HH24' : "YYYY-MM-DD"
  })`;

/** Which bucket a key falls in; -1 outside the period. */
function bucketIndex(period: AnalyticsPeriod, key: string): number {
  if (period.show === "hour") return period.buckets.findIndex((b) => b.start === key);
  return period.buckets.findIndex((b) => b.start <= key && key <= b.last);
}

/** A chart's values from keyed amounts: a figure for every past bucket, null after today. */
function seriesOf(period: AnalyticsPeriod, rows: { key: string; value: number }[]): Series {
  const out: Series = period.buckets.map((b) => (b.past ? 0 : null));
  for (const r of rows) {
    const i = bucketIndex(period, r.key);
    const at = out[i];
    if (i >= 0 && at !== null && at !== undefined) out[i] = at + r.value;
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
    const period = periodOf(query, nowHere(now));
    const venues = await this.venues(staff, query.venueId);
    const rows = await this.events(
      period,
      venues.map((v) => v.id),
    );
    const sold = rows.filter((r) => r.kind === "sale");
    const take = rows.reduce((a, r) => a + centsOf(r.amount), 0);
    const gross = sold.reduce((a, r) => a + centsOf(r.amount), 0);
    const vouchers = sold.reduce((a, r) => a + r.n, 0);
    const names = await this.packageNames(rows.map((r) => r.package_id));
    const byPackage = new Map<string, { name: string; vouchers: number; cents: number }>();
    for (const r of rows) {
      const name =
        r.package_id === null ? "Removed package" : (names.get(r.package_id) ?? "Removed package");
      const p = byPackage.get(name) ?? { name, vouchers: 0, cents: 0 };
      p.cents += centsOf(r.amount);
      if (r.kind === "sale") p.vouchers += r.n;
      byPackage.set(name, p);
    }
    const packages = [...byPackage.values()].sort(
      (a, b) => b.vouchers - a.vouchers || b.cents - a.cents,
    );
    const best = packages[0];
    const venueRows = venues
      .map((v) => {
        const own = rows.filter((r) => r.venue_id === v.id);
        const cents = own.reduce((a, r) => a + centsOf(r.amount), 0);
        const n = own.filter((r) => r.kind === "sale").reduce((a, r) => a + r.n, 0);
        return { venueId: v.id, name: v.name, vouchers: n, cents };
      })
      .sort((a, b) => b.cents - a.cents);
    return {
      period,
      empty: rows.length === 0,
      takingsTsh: money(take),
      vouchers,
      averageSaleTsh: vouchers ? money(Math.round(gross / vouchers)) : null,
      bestSeller: best && best.vouchers > 0 ? { name: best.name, vouchers: best.vouchers } : null,
      series: seriesOf(
        period,
        rows.map((r) => ({ key: r.key, value: centsOf(r.amount) / 100 })),
      ),
      venues: venueRows.map((v) => ({
        venueId: v.venueId,
        name: v.name,
        vouchers: v.vouchers,
        takingsTsh: money(v.cents),
        share: shareOf(v.cents, take),
      })),
      packages: packages.map((p) => ({
        name: p.name,
        vouchers: p.vouchers,
        takingsTsh: money(p.cents),
      })),
    };
  }

  /**
   * Sales across businesses, and HashiNet's fee on them: each venue's net sales in each business
   * month of the period by its business's own terms (ADR-0013, 3), before any monthly minimum.
   */
  async platformSales(query: PeriodQuery, now = new Date()): Promise<PlatformSalesReport> {
    const period = periodOf(query, nowHere(now));
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
    // A venue's month: net sales, for the fee.
    const months = new Map<string, number>();
    for (const r of rows) {
      if (r.venue_id === null) continue;
      const k = `${r.venue_id}|${r.key.slice(0, 7)}`;
      months.set(k, (months.get(k) ?? 0) + centsOf(r.amount));
    }
    const fees = new Map<string, number>();
    for (const [k, cents] of months) {
      const b = businessOf.get(k.split("|")[0] ?? "");
      if (!b) continue;
      const fee = feeOnSales(Math.round(cents / 100), businessFeeTerms(b));
      fees.set(b.id, (fees.get(b.id) ?? 0) + fee * 100);
    }
    const sales = new Map<string, number>();
    for (const r of rows) {
      const b = r.venue_id === null ? null : businessOf.get(r.venue_id);
      if (b) sales.set(b.id, (sales.get(b.id) ?? 0) + centsOf(r.amount));
    }
    const total = [...sales.values()].reduce((a, c) => a + c, 0);
    const serving = businesses.flatMap((b) =>
      b.venues.map((v) => !sellingStopped(b.access) && sellingOf(v.routers).state === "selling"),
    );
    const from = businessDayStart(period.start);
    const to = businessDayStart(addDays(period.end, 1));
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
    const period = periodOf(query, nowHere(now));
    const platform = staff.scope === "platform";
    const venues = await this.venues(staff, query.venueId);
    const ids = venues.map((v) => v.id);
    const inScope = venueFilter(
      Prisma.sql`venue_id`,
      platform && query.venueId === null ? null : ids,
    );
    const from = businessDayStart(period.start);
    const to = businessDayStart(addDays(period.end, 1));
    const started = Prisma.sql`started_at >= ${from} AND started_at < ${to} AND ${inScope}`;
    const who = Prisma.sql`COALESCE(device_id::text, mac_address)`;
    const [series, [totals], byVenue, online, peak] = await Promise.all([
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
    const used = new Map(byVenue.map((r) => [r.venue_id, r]));
    const onlineAt = new Map(online.map((r) => [r.venue_id, r.n]));
    return {
      period,
      empty: (totals?.sessions ?? 0) === 0,
      devices: totals?.devices ?? 0,
      returning: totals?.returning ?? 0,
      sessions: totals?.sessions ?? 0,
      averageSessionMinutes:
        totals?.minutes === null || totals?.minutes === undefined
          ? null
          : Math.round(totals.minutes),
      dataBytes: Number(totals?.bytes ?? 0n),
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
    const from = businessDayStart(period.start);
    const to = businessDayStart(addDays(period.end, 1));
    return this.db.$queryRaw<
      {
        key: string;
        venue_id: string | null;
        package_id: string | null;
        kind: "sale" | "refund";
        amount: string;
        n: number;
      }[]
    >`
      WITH ${REVENUE_EVENTS}
      SELECT ${keySql(Prisma.sql`occurred_at`, period)} AS key, venue_id, package_id, kind,
             SUM(amount)::numeric(14,2)::text AS amount, count(*)::int AS n
      FROM revenue_events
      WHERE occurred_at >= ${from} AND occurred_at < ${to}
        AND ${venueFilter(Prisma.sql`venue_id`, venueIds)}
      GROUP BY 1, 2, 3, 4`;
  }

  private async packageNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id) => id !== null))];
    const rows = await this.db.package.findMany({
      where: { id: { in: wanted } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
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
