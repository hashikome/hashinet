import type { AnalyticsPeriod, AnalyticsShow, PeriodName, PeriodRange } from "@hashinet/types";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { apiError } from "../core/http/error-envelope.js";
import {
  addDays,
  businessDayStart,
  monthBefore,
  monthOf,
  nextMonth,
} from "../core/time/business-day.js";

/** The longest custom period, so a report's queries stay bounded. */
const MAX_CUSTOM_DAYS = 366;

/** The periods each range offers, and the one it opens on. */
const PERIODS: Record<"last" | "current", PeriodName[]> = {
  last: ["day", "7d", "30d", "90d", "month", "quarter", "year"],
  current: ["day", "week", "month", "quarter", "year"],
};
const OPENS_ON: Record<"last" | "current", PeriodName> = { last: "7d", current: "month" };

/** What Analytics' filter sends (prototype `anFilters`), plus a venue to narrow to. */
export const periodQuery = z.object({
  range: z.enum(["last", "current", "custom"]).default("last"),
  /** Null opens the range on its usual period. */
  period: z
    .enum(["day", "7d", "30d", "90d", "week", "month", "quarter", "year"])
    .nullable()
    .default(null),
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

/** The span a named period covers, as first and last business day, for today. */
function spanOf(range: "last" | "current", period: PeriodName, today: string): [string, string] {
  if (range === "current") {
    if (period === "day") return [today, today];
    if (period === "week") return [mondayOf(today), addDays(mondayOf(today), 6)];
    if (period === "month") {
      const first = monthOf(today);
      return [first, addDays(nextMonth(first), -1)];
    }
    if (period === "quarter") {
      const first = quarterStart(today);
      return [first, addDays(nextMonth(nextMonth(nextMonth(first))), -1)];
    }
    return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
  }
  if (period === "day") return [addDays(today, -1), addDays(today, -1)];
  if (period === "7d") return [addDays(today, -6), today];
  if (period === "30d") return [addDays(today, -29), today];
  if (period === "90d") return [addDays(today, -89), today];
  if (period === "month") {
    return [monthBefore(today), addDays(monthOf(today), -1)];
  }
  if (period === "quarter") {
    const thisQuarter = quarterStart(today);
    const first = quarterStart(addDays(thisQuarter, -1));
    return [first, addDays(thisQuarter, -1)];
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
function bucketsOf(
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
      show === "day" ? addDays(at, 1) : show === "week" ? addDays(at, 7) : nextMonth(monthOf(at));
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
    return b.start === monthOf(b.start) && addDays(b.last, 1) === nextMonth(b.start);
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
  let period: PeriodName | null = null;
  const range: PeriodRange = query.range;
  if (range === "custom") {
    if (query.from === null) throw refuse("from", "is required");
    if (query.to === null) throw refuse("to", "is required");
    [start, end] = [query.from, query.to].sort() as [string, string];
    if (daysBetween(start, end) > MAX_CUSTOM_DAYS) {
      throw refuse("to", `must be within ${MAX_CUSTOM_DAYS} days of the start`);
    }
  } else {
    const name = query.period ?? OPENS_ON[range];
    if (!PERIODS[range].includes(name)) throw refuse("period", `is not a ${range} period`);
    period = name;
    [start, end] = spanOf(range, name, now.day);
  }
  const spanDays = daysBetween(start, end);
  const shows = showsFor(spanDays);
  // Keys compare as text: a day "YYYY-MM-DD", an hour "YYYY-MM-DDTHH".
  const hourNow = `${now.day}T${String(now.hour).padStart(2, "0")}`;
  const past = (b: { start: string }) => b.start <= (b.start.length > 10 ? hourNow : now.day);
  // Finished once its last day, or its hour, is over.
  const finished = (b: { start: string; last: string }) =>
    b.start.length > 10 ? b.start < hourNow : b.last < now.day;
  let show: AnalyticsShow;
  if (query.show !== null) {
    if (!shows.includes(query.show)) throw refuse("show", "is not offered for this period");
    show = query.show;
  } else {
    // Early in a period its next unit may hold one point, which draws no line: one unit finer.
    show =
      shows.find((u) => bucketsOf(start, end, u).filter(past).length >= 2) ??
      (shows.at(-1) as AnalyticsShow);
  }
  const through = end < now.day ? end : now.day;
  return {
    range,
    period,
    periods: PERIODS,
    start,
    end,
    through,
    days: start > now.day ? 0 : daysBetween(start, through),
    shows,
    show,
    buckets: bucketsOf(start, end, show).map((b) => ({
      ...b,
      past: past(b),
      complete: past(b) && whole(b, show) && finished(b),
    })),
  };
}

/** The instants a period runs between: from its first business day's start to its end. */
export function instantsOf(period: AnalyticsPeriod): { from: Date; to: Date } {
  return { from: businessDayStart(period.start), to: businessDayStart(addDays(period.end, 1)) };
}
