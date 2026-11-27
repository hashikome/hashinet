import type { AnalyticsPeriod, AnalyticsShow, PeriodName, PeriodRange } from "@hashinet/types";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { apiError } from "../http/error-envelope.js";
import { addDays, nextMonth } from "./business-day.js";

/** The longest custom period, so a report's queries stay bounded. */
export const MAX_CUSTOM_DAYS = 366;

const LAST: PeriodName[] = ["day", "7d", "30d", "90d", "month", "quarter", "year"];
const CURRENT: PeriodName[] = ["day", "week", "month", "quarter", "year"];

/** What Analytics' filter sends (prototype `anFilters`), plus a venue to narrow to. */
export const periodQuery = z.object({
  range: z.enum(["last", "current", "custom"]).default("last"),
  period: z.enum(["day", "7d", "30d", "90d", "week", "month", "quarter", "year"]).default("7d"),
  from: z.iso.date().nullable().default(null),
  to: z.iso.date().nullable().default(null),
  show: z.enum(["hour", "day", "week", "month"]).nullable().default(null),
  venueId: z.uuid().nullable().default(null),
});

export type PeriodQuery = z.infer<typeof periodQuery>;

const refuse = (field: string, message: string) =>
  new BadRequestException(apiError("VALIDATION_FAILED", "Check the period.", { [field]: message }));

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

/** Monday of the week `day` falls in. */
function mondayOf(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

const quarterStart = (day: string) => {
  const month = Number(day.slice(5, 7));
  return `${day.slice(0, 5)}${String(month - ((month - 1) % 3)).padStart(2, "0")}-01`;
};
const lastDayBefore = (firstDay: string) => addDays(firstDay, -1);

/** The span a named period covers, as first and last business day, for today. */
function spanOf(range: "last" | "current", period: PeriodName, today: string): [string, string] {
  if (range === "current") {
    if (period === "day") return [today, today];
    if (period === "week") return [mondayOf(today), addDays(mondayOf(today), 6)];
    if (period === "month") {
      const first = `${today.slice(0, 7)}-01`;
      return [first, lastDayBefore(nextMonth(first))];
    }
    if (period === "quarter") {
      const first = quarterStart(today);
      return [first, lastDayBefore(nextMonth(nextMonth(nextMonth(first))))];
    }
    return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
  }
  if (period === "day") return [addDays(today, -1), addDays(today, -1)];
  if (period === "7d") return [addDays(today, -6), today];
  if (period === "30d") return [addDays(today, -29), today];
  if (period === "90d") return [addDays(today, -89), today];
  if (period === "month") {
    const thisMonth = `${today.slice(0, 7)}-01`;
    const first = `${addDays(thisMonth, -1).slice(0, 7)}-01`;
    return [first, lastDayBefore(thisMonth)];
  }
  if (period === "quarter") {
    const thisQuarter = quarterStart(today);
    const first = quarterStart(addDays(thisQuarter, -1));
    return [first, lastDayBefore(thisQuarter)];
  }
  const year = String(Number(today.slice(0, 4)) - 1);
  return [`${year}-01-01`, `${year}-12-31`];
}

/**
 * Show offers the units below the period, never the period itself (prototype `anShows`): a day
 * shows hours; a week, days; a month, weeks or days; longer, months or weeks.
 */
export function showsFor(spanDays: number): AnalyticsShow[] {
  if (spanDays === 1) return ["hour"];
  if (spanDays <= 7) return ["day"];
  if (spanDays <= 31) return ["week", "day"];
  return ["month", "week"];
}

/** The buckets of a span by a unit: each one's first day (or hour), and its last day. */
export function bucketsOf(
  start: string,
  end: string,
  show: AnalyticsShow,
): { start: string; last: string }[] {
  if (show === "hour") {
    return Array.from({ length: 24 }, (_, h) => ({
      start: `${start}T${String(h).padStart(2, "0")}`,
      last: start,
    }));
  }
  const out: { start: string; last: string }[] = [];
  let at = start;
  while (at <= end) {
    const next =
      show === "day"
        ? addDays(at, 1)
        : show === "week"
          ? addDays(at, 7)
          : nextMonth(`${at.slice(0, 7)}-01`);
    const last = addDays(next, -1);
    out.push({ start: at, last: last < end ? last : end });
    at = next;
  }
  return out;
}

/** Whether a bucket is a whole unit: a full week, or a month from its first day to its last. */
function whole(b: { start: string; last: string }, show: AnalyticsShow): boolean {
  if (show === "week") return daysBetween(b.start, b.last) === 7;
  if (show === "month") {
    return b.start.endsWith("-01") && addDays(b.last, 1) === nextMonth(`${b.start.slice(0, 7)}-01`);
  }
  return true;
}

/**
 * The period a report covers, decided here (ADR-0003): its span in business days, the units it
 * may show, the unit chosen and its buckets. The axis covers the whole span; figures stop at
 * today, so a bucket after it is not `past`. `now` is today's business day and hour.
 */
export function periodOf(query: PeriodQuery, now: { day: string; hour: number }): AnalyticsPeriod {
  let start: string;
  let end: string;
  const range: PeriodRange = query.range;
  if (range === "custom") {
    if (query.from === null) throw refuse("from", "is required");
    if (query.to === null) throw refuse("to", "is required");
    [start, end] = [query.from, query.to].sort() as [string, string];
    if (daysBetween(start, end) > MAX_CUSTOM_DAYS) {
      throw refuse("to", `must be within ${MAX_CUSTOM_DAYS} days of the start`);
    }
  } else {
    const allowed = range === "last" ? LAST : CURRENT;
    if (!allowed.includes(query.period)) throw refuse("period", `is not a ${range} period`);
    [start, end] = spanOf(range, query.period, now.day);
  }
  const spanDays = daysBetween(start, end);
  const shows = showsFor(spanDays);
  const past = (b: { start: string }) =>
    b.start.length > 10
      ? b.start.slice(0, 10) < now.day ||
        (b.start.slice(0, 10) === now.day && Number(b.start.slice(11)) <= now.hour)
      : b.start <= now.day;
  // A bucket is finished once its last day, or its hour, is over.
  const finished = (b: { start: string; last: string }) =>
    b.start.length > 10
      ? b.start.slice(0, 10) < now.day ||
        (b.start.slice(0, 10) === now.day && Number(b.start.slice(11)) < now.hour)
      : b.last < now.day;
  let show: AnalyticsShow;
  if (query.show !== null) {
    if (!shows.includes(query.show)) throw refuse("show", "is not offered for this period");
    show = query.show;
  } else {
    // Early in a period its next unit may hold one point, which draws no line: one unit finer.
    show =
      shows.find((u) => bucketsOf(start, end, u).filter(past).length >= 2) ??
      shows[shows.length - 1] ??
      "day";
  }
  return {
    range,
    period: range === "custom" ? null : query.period,
    start,
    end,
    through: end < now.day ? end : now.day,
    days: start > now.day ? 0 : daysBetween(start, end < now.day ? end : now.day),
    shows,
    show,
    buckets: bucketsOf(start, end, show).map((b) => ({
      ...b,
      past: past(b),
      complete: past(b) && whole(b, show) && finished(b),
    })),
  };
}
