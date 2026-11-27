"use client";

import type {
  AnalyticsPeriod,
  AnalyticsShow,
  PeriodName,
  PeriodRange,
  UsageReport,
} from "@hashinet/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";
import { useVenues } from "@/lib/venues";
import { Button, Panel } from "./ui";

/** The filter as Analytics' address holds it. */
export interface PeriodFilter {
  range: PeriodRange;
  period: PeriodName;
  from: string;
  to: string;
  show: AnalyticsShow | "";
}

const DEFAULT: PeriodFilter = { range: "last", period: "7d", from: "", to: "", show: "" };
const KEY = "hashinet.analytics";

const PERIODS: Record<"last" | "current", PeriodName[]> = {
  last: ["day", "7d", "30d", "90d", "month", "quarter", "year"],
  current: ["day", "week", "month", "quarter", "year"],
};
const PERIOD_WORD: Record<PeriodName, string> = {
  day: "day",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  week: "week",
  month: "month",
  quarter: "quarter",
  year: "year",
};
const RANGE_WORD: Record<PeriodRange, string> = {
  last: "Last",
  current: "Current",
  custom: "Custom",
};
const SHOW_WORD: Record<AnalyticsShow, string> = {
  hour: "Hourly",
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};
/** "per day", for a chart's title. */
export const SHOW_PER: Record<AnalyticsShow, string> = {
  hour: "hour",
  day: "day",
  week: "week",
  month: "month",
};

const shortDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** A bucket's label on the chart's axis. */
export function bucketLabel(start: string, show: AnalyticsShow): string {
  if (show === "hour") return `${start.slice(11)}:00`;
  if (show === "month")
    return new Date(`${start}T12:00:00Z`).toLocaleDateString("en-GB", {
      month: "short",
      timeZone: "UTC",
    });
  return shortDay(start);
}

/** A period's chart axis: each bucket's key and label. */
export const axisOf = (p: AnalyticsPeriod) =>
  p.buckets.map((b) => ({
    key: b.start,
    label: bucketLabel(b.start, p.show),
    complete: b.complete,
  }));

/** "Last 7 days", "Current month", "1 Oct to 31 Oct". */
export function periodTitle(p: AnalyticsPeriod): string {
  if (p.period === null) {
    return p.start === p.end ? shortDay(p.start) : `${shortDay(p.start)} to ${shortDay(p.end)}`;
  }
  return `${RANGE_WORD[p.range]} ${PERIOD_WORD[p.period]}`;
}

/** "3h 12m": a session's length. */
export function minutesText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return h ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}

/**
 * Analytics' filter (prototype `anFilters`), as the address holds it, so a period can be linked
 * to; each person's last one is remembered here so Usage and Sales share it. Applies as it changes.
 */
export function usePeriodFilter(): {
  filter: PeriodFilter;
  set: (change: Partial<PeriodFilter> | null) => void;
  query: string;
  scope: string;
  venueId: string | null;
} {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const { me } = useSession();
  const { filter: venue, all } = useVenues();
  const has = params.has("range");
  const filter: PeriodFilter = has
    ? {
        range: (params.get("range") as PeriodRange) ?? "last",
        period: (params.get("period") as PeriodName) ?? "7d",
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
        show: (params.get("show") as AnalyticsShow | null) ?? "",
      }
    : DEFAULT;
  const write = (f: PeriodFilter) => {
    const q = new URLSearchParams({ range: f.range });
    if (f.range === "custom") {
      if (f.from) q.set("from", f.from);
      if (f.to) q.set("to", f.to);
    } else q.set("period", f.period);
    if (f.show) q.set("show", f.show);
    try {
      sessionStorage.setItem(KEY, q.toString());
    } catch {
      // A browser that refuses storage starts each page on the last 7 days.
    }
    router.replace(`${path}?${q.toString()}`);
  };
  // Opened from the menu: the period this person last looked at.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when opened without a period
  useEffect(() => {
    if (has) return;
    try {
      const last = sessionStorage.getItem(KEY);
      if (last) router.replace(`${path}?${last}`);
    } catch {
      // Nothing remembered: the last 7 days.
    }
  }, []);
  const set = (change: Partial<PeriodFilter> | null) => {
    if (change === null) return write(DEFAULT);
    const next = { ...filter, ...change };
    // A new period starts on the grouping that suits it; Show changes it from there.
    if (!("show" in change)) next.show = "";
    if (change.range && change.range !== "custom" && !("period" in change)) {
      next.period = change.range === "current" ? "month" : "7d";
    }
    write(next);
  };
  const q = new URLSearchParams({ range: filter.range });
  if (filter.range === "custom") {
    q.set("from", filter.from || filter.to);
    q.set("to", filter.to || filter.from);
  } else q.set("period", filter.period);
  if (filter.show) q.set("show", filter.show);
  const venueId = venue === "all" ? null : venue;
  if (venueId) q.set("venueId", venueId);
  const scope =
    me.active.scope === "platform"
      ? "All businesses"
      : (all.find((v) => v.id === venueId)?.name ?? me.active.business?.name ?? "");
  return { filter, set, query: q.toString(), scope, venueId };
}

/** Range, Period (or From and To) and Show; Clear filters once it differs from the last 7 days. */
export function PeriodFilters({
  filter,
  set,
  shows,
}: {
  filter: PeriodFilter;
  set: (change: Partial<PeriodFilter> | null) => void;
  shows: AnalyticsShow[];
}) {
  const changed = filter.range !== "last" || filter.period !== "7d" || filter.show !== "";
  return (
    <section className="panel">
      <form className="audit-filters" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="ar">Range</label>
          <select
            id="ar"
            className="input"
            value={filter.range}
            onChange={(e) => set({ range: e.target.value as PeriodRange })}
          >
            {(["last", "current", "custom"] as const).map((r) => (
              <option key={r} value={r}>
                {RANGE_WORD[r]}
              </option>
            ))}
          </select>
        </div>
        {filter.range === "custom" ? (
          <>
            <div className="field date-pair">
              <label htmlFor="af">From</label>
              <input
                id="af"
                className="input"
                type="date"
                value={filter.from}
                onChange={(e) => set({ from: e.target.value })}
              />
            </div>
            <div className="field date-pair">
              <label htmlFor="at">To</label>
              <input
                id="at"
                className="input"
                type="date"
                value={filter.to}
                onChange={(e) => set({ to: e.target.value })}
              />
            </div>
          </>
        ) : (
          <div className="field">
            <label htmlFor="ap">Period</label>
            <select
              id="ap"
              className="input"
              value={filter.period}
              onChange={(e) => set({ period: e.target.value as PeriodName })}
            >
              {PERIODS[filter.range].map((p) => (
                <option key={p} value={p}>
                  {RANGE_WORD[filter.range]} {PERIOD_WORD[p]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="as">Show</label>
          <select
            id="as"
            className="input"
            value={filter.show || shows[0] || ""}
            onChange={(e) => set({ show: e.target.value as AnalyticsShow })}
          >
            {shows.map((s) => (
              <option key={s} value={s}>
                {SHOW_WORD[s]}
              </option>
            ))}
          </select>
        </div>
        {changed ? (
          <div className="audit-buttons">
            <Button className="ghost" onClick={() => set(null)}>
              Clear filters
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

/** Nothing recorded in the period. */
export function NothingHere({ title }: { title: string }) {
  return (
    <Panel title={title}>
      <p className="muted empty">Nothing in this period.</p>
    </Panel>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_LONG = [
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
  "Sundays",
];

/** "Up to 14 devices at once · Saturdays around 19:00". */
export function peakNote(peak: UsageReport["peak"]): string {
  if (!peak.at) return "No devices online in this period";
  return `Up to ${peak.max} ${peak.max === 1 ? "device" : "devices"} at once · ${WEEKDAYS_LONG[peak.at.weekday]} around ${String(peak.at.hour).padStart(2, "0")}:00`;
}

/** Peak hours (prototype `heatmap`): weekdays down, hours across, darker for more devices. */
export function Heatmap({ peak }: { peak: UsageReport["peak"] }) {
  const top = Math.max(peak.max, 1);
  return (
    <div className="heat" role="img" aria-label={`Busiest hours by weekday. ${peakNote(peak)}`}>
      <div />
      {peak.hours.map((h) => (
        <div key={h}>{h % 3 === 0 ? String(h).padStart(2, "0") : ""}</div>
      ))}
      {peak.days.map((row, d) => (
        <HeatRow key={WEEKDAYS[d]} day={WEEKDAYS[d] ?? ""} row={row} hours={peak.hours} top={top} />
      ))}
    </div>
  );
}

function HeatRow({
  day,
  row,
  hours,
  top,
}: {
  day: string;
  row: number[];
  hours: number[];
  top: number;
}) {
  return (
    <>
      <div>{day}</div>
      {row.map((n, i) => (
        <i
          key={hours[i]}
          style={{ "--a": (0.06 + (n / top) * 0.94).toFixed(2) } as React.CSSProperties}
          title={`${day} ${hours[i]}:00, ${n} ${n === 1 ? "device" : "devices"}`}
        />
      ))}
    </>
  );
}
