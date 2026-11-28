import { Prisma } from "../../generated/prisma/client.js";

/**
 * HashiNet stores instants in UTC and reports by the business's calendar: a day in
 * Africa/Dar_es_Salaam (UTC+3, no daylight saving) runs from 21:00 UTC to 21:00 UTC. Both the
 * database grouping and the application use this zone name, never a fixed offset.
 */
export const BUSINESS_TIME_ZONE = "Africa/Dar_es_Salaam";

/** The business day of `column` (a timestamptz), for GROUP BY and WHERE in raw SQL. */
export function businessDaySql(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(${column} AT TIME ZONE ${BUSINESS_TIME_ZONE})::date`;
}

const HOUR = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "numeric",
  hourCycle: "h23",
});

/** The hour of the business's day an instant falls in, 0 to 23. */
export function businessHourOf(instant: Date): number {
  return Number(HOUR.formatToParts(instant).find((p) => p.type === "hour")?.value ?? 0);
}

/** The business day of an instant, as YYYY-MM-DD. */
export function businessDayOf(instant: Date): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The instant a business day (YYYY-MM-DD) begins, for range filters a query builder can take. */
export function businessDayStart(day: string): Date {
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date(`${day}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")
    ?.value.replace("GMT", "");
  return new Date(`${day}T00:00:00${offset || "Z"}`);
}

/** A DATE column as YYYY-MM-DD; Prisma reads it as midnight UTC. */
export const dateOf = (date: Date) => date.toISOString().slice(0, 10);

/** The first day of the month a business day (YYYY-MM-DD) falls in. */
export const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

/** "2026-12-01" from "2026-11-01": the first day of the month after. */
export function nextMonth(firstDay: string): string {
  const [y, m] = firstDay.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** "2026-10-01" from "2026-11-26": the first day of the month before. */
export function monthBefore(day: string): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

/** A business day `n` days after another, both YYYY-MM-DD. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The business day and hour it is at `now`. */
export function businessNow(now: Date): { day: string; hour: number } {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: BUSINESS_TIME_ZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return { day: businessDayOf(now), hour };
}
