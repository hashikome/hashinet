import { Prisma } from "../generated/prisma/client.js";
import { BUSINESS_TIME_ZONE } from "./business-day.js";

/**
 * HashiNet's one definition of revenue, as a SQL CTE named `revenue_events`
 * (id, source, amount, occurred_at, venue_id, package_id, reference, kind): every paid payment,
 * when it was paid, by provider (a staff-recorded `manual` payment is cash). A voucher exists only
 * by its sale (ADR-0017), so every voucher sold is one of these.
 */
export const REVENUE_EVENTS = Prisma.sql`
  revenue_events AS (
    SELECT p.id, (CASE WHEN p.provider = 'mobile_money' THEN 'mobile_money'
                       WHEN p.provider = 'card' THEN 'card' ELSE 'cash' END) AS source,
           p.amount_tsh AS amount, p.paid_at AS occurred_at, p.venue_id, p.package_id,
           p.provider_reference AS reference, 'sale' AS kind
    FROM payments p
    WHERE p.status = 'paid' AND p.paid_at IS NOT NULL
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
