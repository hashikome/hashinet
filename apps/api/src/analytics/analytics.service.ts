import type {
  BusinessMonth,
  PaymentsReceived,
  RevenueSource,
  TodaySummary,
  VenueTakings,
} from "@hashinet/types";
import { ForbiddenException, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../core/access/principal.js";
import { venueScope } from "../core/access/venue-scope.js";
import { PrismaService } from "../core/database/prisma.service.js";
import { apiError } from "../core/http/error-envelope.js";
import {
  addDays,
  businessDayOf,
  businessDaySql,
  businessDayStart,
} from "../core/time/business-day.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  businessMonthSql,
  moneySum,
  REVENUE_EVENTS,
  sumMoney,
  venueFilter,
} from "./revenue-events.js";

const DAY_MS = 86_400_000;
const RECEIVED_PAGE = 100;

/** A month, YYYY-MM. */
export const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be YYYY-MM");

export const monthQuery = z.object({
  month: monthParam.nullable().default(null),
});

export const receivedQuery = monthQuery.extend({
  venueId: z.uuid().nullable().default(null),
  /** Only what the reader sold or refunded: an operator's own sales. */
  by: z.enum(["me"]).nullable().default(null),
  /** One business day in place of the month. */
  day: z.iso.date().nullable().default(null),
  /** The last row shown, as `<ISO time>_<id>`, from `nextBefore`. */
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z_[0-9a-f-]{36}$/, "must be a page cursor")
    .nullable()
    .default(null),
});

export const todayQuery = z.object({ venueId: z.uuid().nullable().default(null) });

/**
 * A business's day, each venue's takings and what guests paid, computed here rather than in the
 * web (ADR-0003), by the business calendar of Africa/Dar_es_Salaam. Analytics' period reports are
 * `AnalyticsReports`.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly db: PrismaService) {}

  /** Each venue's takings, today and over the last 7 days: the Venues list and a venue's page. */
  async venueTakings(staff: Principal): Promise<VenueTakings> {
    const venues = await this.businessVenues(staff, null);
    const today = businessDayOf(new Date());
    const weekStart = addDays(today, -6);
    const rows = await this.db.$queryRaw<
      { venue_id: string; today: string; sold_today: number; week: string; sold_week: number }[]
    >`
      WITH ${REVENUE_EVENTS},
      days AS (SELECT venue_id, kind, amount, ${businessDaySql(Prisma.sql`occurred_at`)} AS day
               FROM revenue_events
               WHERE occurred_at >= ${businessDayStart(weekStart)}
                 AND ${venueFilter(Prisma.sql`venue_id`, venues)})
      SELECT venue_id,
             COALESCE(SUM(amount) FILTER (WHERE day = ${today}::date), 0)::numeric(14,2)::text
               AS today,
             (count(*) FILTER (WHERE kind = 'sale' AND day = ${today}::date))::int AS sold_today,
             ${moneySum(Prisma.sql`amount`)} AS week,
             (count(*) FILTER (WHERE kind = 'sale'))::int AS sold_week
      FROM days WHERE day >= ${weekStart}::date AND day <= ${today}::date
      GROUP BY venue_id`;
    const byVenue = new Map(rows.map((r) => [r.venue_id, r]));
    return {
      venues: venues.map((venueId) => {
        const r = byVenue.get(venueId);
        return {
          venueId,
          todayTsh: r?.today ?? "0.00",
          soldToday: r?.sold_today ?? 0,
          weekTsh: r?.week ?? "0.00",
          soldWeek: r?.sold_week ?? 0,
        };
      }),
    };
  }

  /**
   * A business's day so far: who is online, what sold and what it took, against the same weekday a
   * week ago up to now. The platform has its own figures, so this is a business's alone.
   */
  async today(staff: Principal, query: z.infer<typeof todayQuery>): Promise<TodaySummary> {
    const venues = await this.businessVenues(staff, query.venueId);
    const now = new Date();
    const day = businessDayOf(now);
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const lastWeekDay = businessDayOf(weekAgo);
    const inScope = venueFilter(Prisma.sql`venue_id`, venues);
    const [[online], rows, [before], [refunds], [cash]] = await Promise.all([
      this.db.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT device_id)::int AS n FROM wifi_sessions
      WHERE status = 'connected' AND ${inScope}`,
      this.db.$queryRaw<
        { package_id: string | null; name: string | null; sold: number; takings: string }[]
      >`
      WITH ${REVENUE_EVENTS}
      SELECT e.package_id, p.name, (count(*) FILTER (WHERE e.kind = 'sale'))::int AS sold,
             ${moneySum(Prisma.sql`e.amount`)} AS takings
      FROM revenue_events e LEFT JOIN packages p ON p.id = e.package_id
      WHERE ${businessDaySql(Prisma.sql`e.occurred_at`)} = ${day}::date
        AND ${venueFilter(Prisma.sql`e.venue_id`, venues)}
      GROUP BY e.package_id, p.name
      ORDER BY sold DESC, p.name`,
      this.db.$queryRaw<{ takings: string }[]>`
      WITH ${REVENUE_EVENTS}
      SELECT ${moneySum(Prisma.sql`amount`)} AS takings FROM revenue_events
      WHERE ${businessDaySql(Prisma.sql`occurred_at`)} = ${lastWeekDay}::date
        AND occurred_at <= ${weekAgo} AND ${inScope}`,
      this.db.$queryRaw<{ amount: string }[]>`
      WITH ${REVENUE_EVENTS}
      SELECT ${moneySum(Prisma.sql`-amount`)} AS amount FROM revenue_events
      WHERE kind = 'refund' AND ${businessDaySql(Prisma.sql`occurred_at`)} = ${day}::date
        AND ${inScope}`,
      // The reader's own cash to hand over: what they sold for cash today, less the cash they gave
      // back today (ADR-0017, 8).
      this.db.$queryRaw<{ amount: string }[]>`
      SELECT ${moneySum(Prisma.sql`amount`)} AS amount FROM (
        SELECT p.amount_tsh AS amount FROM payments p
        WHERE p.recorded_by_id = ${staff.membershipId}::uuid AND p.status = 'paid'
          AND p.provider IN ('cash', 'manual')
          AND ${businessDaySql(Prisma.sql`p.paid_at`)} = ${day}::date
          AND ${venueFilter(Prisma.sql`p.venue_id`, venues)}
        UNION ALL
        SELECT -r.amount_tsh FROM refunds r
        WHERE r.refunded_by_id = ${staff.membershipId}::uuid AND r.method = 'cash'
          AND ${businessDaySql(Prisma.sql`r.created_at`)} = ${day}::date
          AND ${venueFilter(Prisma.sql`r.venue_id`, venues)}
      ) mine`,
    ]);
    return {
      day,
      onlineNow: online?.n ?? 0,
      sold: rows.reduce((n, r) => n + r.sold, 0),
      takingsTsh: sumMoney(rows.map((r) => r.takings)),
      refundsTsh: refunds?.amount ?? "0.00",
      yourCashTsh: cash?.amount ?? "0.00",
      lastWeekTakingsTsh: before?.takings ?? "0.00",
      byPackage: rows.map((r) => ({
        packageId: r.package_id,
        name: r.name,
        sold: r.sold,
        takingsTsh: r.takings,
      })),
    };
  }

  /** What guests paid a business in a month, newest first, 100 at a time (`PaymentsReceived`). */
  async received(
    staff: Principal,
    query: z.infer<typeof receivedQuery>,
  ): Promise<PaymentsReceived> {
    const venues = await this.businessVenues(staff, query.venueId);
    const mine =
      query.by === "me" ? Prisma.sql`e.actor_id = ${staff.membershipId}::uuid` : Prisma.sql`TRUE`;
    const inScope = Prisma.sql`${venueFilter(Prisma.sql`e.venue_id`, venues)} AND ${mine}`;
    // This month unless another is asked for; the list offers it whether or not it has payments.
    const current = this.currentMonth();
    const month = query.month ?? current;
    const inMonth =
      query.day === null
        ? Prisma.sql`${businessMonthSql(Prisma.sql`e.occurred_at`)} = ${`${month}-01`}::date`
        : Prisma.sql`${businessDaySql(Prisma.sql`e.occurred_at`)} = ${query.day}::date`;
    // Keyset paging on (time, id), so rows sharing a timestamp are never skipped.
    const [beforeAt, beforeId] = query.before?.split("_") ?? [];
    const before =
      beforeAt && beforeId
        ? Prisma.sql`(e.occurred_at, e.id) < (${new Date(beforeAt)}, ${beforeId}::uuid)`
        : Prisma.sql`TRUE`;
    const [months, [total], rows] = await Promise.all([
      this.db.$queryRaw<{ month: string }[]>`
      WITH ${REVENUE_EVENTS}
      SELECT DISTINCT to_char(${businessMonthSql(Prisma.sql`e.occurred_at`)}, 'YYYY-MM') AS month
      FROM revenue_events e WHERE ${inScope} ORDER BY month DESC`,
      this.db.$queryRaw<{ amount: string; n: number }[]>`
      WITH ${REVENUE_EVENTS}
      SELECT ${moneySum(Prisma.sql`e.amount`)} AS amount, count(*)::int AS n
      FROM revenue_events e WHERE ${inMonth} AND ${inScope}`,
      this.db.$queryRaw<
        {
          id: string;
          source: RevenueSource;
          kind: "sale" | "refund";
          amount: string;
          package_name: string | null;
          venue_name: string | null;
          reference: string | null;
          occurred_at: Date;
          by_name: string | null;
          paid_through: string | null;
          paid_to_number: string | null;
          paid_to_name: string | null;
        }[]
      >`
      WITH ${REVENUE_EVENTS}
      SELECT e.id, e.source, e.kind, e.amount::numeric(14,2)::text AS amount,
             p.name AS package_name, v.name AS venue_name, e.reference, e.occurred_at,
             u.name AS by_name, pay.paid_through, pay.paid_to_number, pay.paid_to_name
      FROM revenue_events e
      LEFT JOIN payments pay ON e.kind = 'sale' AND pay.id = e.id
      LEFT JOIN packages p ON p.id = e.package_id
      LEFT JOIN venues v ON v.id = e.venue_id
      LEFT JOIN memberships m ON m.id = e.actor_id
      LEFT JOIN users u ON u.id = m.user_id
      WHERE ${inMonth} AND ${inScope} AND ${before}
      ORDER BY e.occurred_at DESC, e.id DESC LIMIT ${RECEIVED_PAGE + 1}`,
    ]);
    const shown = rows.slice(0, RECEIVED_PAGE);
    return {
      month,
      current: month === current,
      months: [...new Set([current, ...months.map((m) => m.month)])].sort().reverse(),
      totalTsh: total?.amount ?? "0.00",
      count: total?.n ?? 0,
      payments: shown.map((r) => ({
        id: r.id,
        source: r.source,
        kind: r.kind,
        amountTsh: r.amount,
        packageName: r.package_name,
        venueName: r.venue_name,
        reference: r.reference,
        by: r.by_name,
        paidTo:
          r.paid_through !== null && r.paid_to_number !== null && r.paid_to_name !== null
            ? { through: r.paid_through, number: r.paid_to_number, name: r.paid_to_name }
            : null,
        occurredAt: r.occurred_at.toISOString(),
      })),
      nextBefore: (() => {
        const last = shown.at(-1);
        return rows.length > RECEIVED_PAGE && last
          ? `${last.occurred_at.toISOString()}_${last.id}`
          : null;
      })(),
    };
  }
  /** A business's venues in the principal's scope, or the one asked for; never the platform's. */
  private async businessVenues(staff: Principal, venueId: string | null): Promise<string[]> {
    if (staff.scope === "platform") {
      throw new ForbiddenException(apiError("FORBIDDEN", "These figures are a business's own."));
    }
    const venues = await this.db.venue.findMany({
      where: { ...venueScope(staff), ...(venueId === null ? {} : { id: venueId }) },
      select: { id: true },
    });
    return venues.map((v) => v.id);
  }

  private currentMonth(): BusinessMonth {
    return businessDayOf(new Date()).slice(0, 7);
  }
}
