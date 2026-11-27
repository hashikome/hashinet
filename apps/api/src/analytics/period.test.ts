import { describe, expect, test } from "bun:test";
import { type PeriodQuery, periodOf, showsFor } from "./period.js";

/** Tuesday 3 November 2026, 18:00 in Dar es Salaam, as the prototype's today. */
const NOW = { day: "2026-11-03", hour: 18 };
const q = (over: Partial<PeriodQuery>): PeriodQuery => ({
  range: "last",
  period: "7d",
  from: null,
  to: null,
  show: null,
  venueId: null,
  ...over,
});
const span = (over: Partial<PeriodQuery>) => {
  const p = periodOf(q(over), NOW);
  return [p.start, p.end];
};

describe("analytics periods", () => {
  test("Last: yesterday, days ending today, and the previous month, quarter and year", () => {
    expect(span({ period: "day" })).toEqual(["2026-11-02", "2026-11-02"]);
    expect(span({ period: "7d" })).toEqual(["2026-10-28", "2026-11-03"]);
    expect(span({ period: "30d" })).toEqual(["2026-10-05", "2026-11-03"]);
    expect(span({ period: "90d" })).toEqual(["2026-08-06", "2026-11-03"]);
    expect(span({ period: "month" })).toEqual(["2026-10-01", "2026-10-31"]);
    expect(span({ period: "quarter" })).toEqual(["2026-07-01", "2026-09-30"]);
    expect(span({ period: "year" })).toEqual(["2025-01-01", "2025-12-31"]);
  });

  test("Current: today, Monday to Sunday, and the month, quarter and year of today", () => {
    expect(span({ range: "current", period: "day" })).toEqual(["2026-11-03", "2026-11-03"]);
    expect(span({ range: "current", period: "week" })).toEqual(["2026-11-02", "2026-11-08"]);
    expect(span({ range: "current", period: "month" })).toEqual(["2026-11-01", "2026-11-30"]);
    expect(span({ range: "current", period: "quarter" })).toEqual(["2026-10-01", "2026-12-31"]);
    expect(span({ range: "current", period: "year" })).toEqual(["2026-01-01", "2026-12-31"]);
  });

  test("Show offers the units below the period, and buckets after today have no figure", () => {
    expect(showsFor(1)).toEqual(["hour"]);
    expect(showsFor(7)).toEqual(["day"]);
    expect(showsFor(30)).toEqual(["week", "day"]);
    expect(showsFor(90)).toEqual(["month", "week"]);
    const today = periodOf(q({ range: "current", period: "day" }), NOW);
    expect(today.show).toBe("hour");
    expect(today.buckets.filter((b) => b.past)).toHaveLength(19);
    // Early in a month, weeks hold a point or two: one unit finer, so a line can be drawn.
    const month = periodOf(q({ range: "current", period: "month" }), NOW);
    expect(month.show).toBe("day");
    expect(month.through).toBe("2026-11-03");
    expect(month.buckets).toHaveLength(30);
    // A quarter by months: the first runs from the period's start to its month's end.
    const ninety = periodOf(q({ period: "90d", show: "month" }), NOW);
    expect(ninety.buckets.map((b) => [b.start, b.last])).toEqual([
      ["2026-08-06", "2026-08-31"],
      ["2026-09-01", "2026-09-30"],
      ["2026-10-01", "2026-10-31"],
      ["2026-11-01", "2026-11-03"],
    ]);
  });

  test("custom dates are sorted, and too long a span is refused", () => {
    expect(span({ range: "custom", from: "2026-10-31", to: "2026-10-01" })).toEqual([
      "2026-10-01",
      "2026-10-31",
    ]);
    expect(() =>
      periodOf(q({ range: "custom", from: "2025-01-01", to: "2026-06-01" }), NOW),
    ).toThrow();
    expect(() => periodOf(q({ range: "current", period: "90d" }), NOW)).toThrow();
  });
});
