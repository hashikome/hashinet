import { Prisma } from "../generated/prisma/client.js";
import { BUSINESS_TIME_ZONE } from "./business-day.js";

/**
 * HashiNet's one definition of revenue, as a SQL CTE named `revenue_events`
 * (id, source, amount, occurred_at, venue_id, package_id, reference, kind, actor_id):
 *
 * - `sale`: every paid payment, when it was paid, by provider (a staff-recorded `manual` payment
 *   is cash). A voucher exists only by its sale (ADR-0017), so every voucher sold is one of these;
 * - `refund`: every refund, as minus its amount, on the day it was made, by how it went back
 *   (ADR-0017, 8).
 *
 * `actor_id` is the membership that sold it or refunded it; null for a guest's own purchase.
 * Sums over it are net sales; a count of vouchers sold counts `kind = 'sale'` only.
 */
export const REVENUE_EVENTS = Prisma.sql`
  revenue_events AS (
    SELECT p.id, (CASE WHEN p.provider = 'mobile_money' THEN 'mobile_money'
                       WHEN p.provider = 'card' THEN 'card' ELSE 'cash' END) AS source,
           p.amount_tsh AS amount, p.paid_at AS occurred_at, p.venue_id, p.package_id,
           p.provider_reference AS reference, 'sale' AS kind, p.recorded_by_id AS actor_id
    FROM payments p
    WHERE p.status = 'paid' AND p.paid_at IS NOT NULL
    UNION ALL
    SELECT r.id, (CASE WHEN r.method = 'mobile_money' THEN 'mobile_money' ELSE 'cash' END),
           -r.amount_tsh, r.created_at, r.venue_id, r.package_id, r.reference, 'refund',
           r.refunded_by_id
    FROM refunds r
  )`;

/** `column` as a local timestamp in the business time zone. */
function local(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(${column} AT TIME ZONE ${BUSINESS_TIME_ZONE})`;
}

/** The business month of `column`, as the first day of that month. */
export function businessMonthSql(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`date_trunc('month', ${local(column)})::date`;
}

/** A money sum as text with two decimals, zero when there is nothing to sum. */
export function moneySum(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`COALESCE(SUM(${column}), 0)::numeric(14,2)::text`;
}

/**
 * Venue filter: nothing for an admin, the manager's venues otherwise (an empty list matches
 * nothing).
 */
export function venueFilter(column: Prisma.Sql, venueIds: string[] | null): Prisma.Sql {
  return venueIds === null ? Prisma.sql`TRUE` : Prisma.sql`${column} = ANY(${venueIds}::uuid[])`;
}

/** Shillings as two-decimal text, from whole cents. */
export const money = (cents: number) => (cents / 100).toFixed(2);
/** Two-decimal money text as whole cents. */
export const centsOf = (amount: string) => Math.round(Number(amount) * 100);
/** Whole percent of `whole`, 0 when there is none. */
export const shareOf = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

/** Adds two-decimal money strings in whole cents, so no float error reaches a total. */
export function sumMoney(amounts: string[]): string {
  const cents = amounts.reduce((sum, a) => sum + BigInt(centsOf(a)), 0n);
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
