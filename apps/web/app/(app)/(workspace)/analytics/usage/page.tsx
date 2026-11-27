"use client";

import type { UsageReport } from "@hashinet/types";
import { Suspense } from "react";
import {
  axisOf,
  Bar,
  Heatmap,
  NothingHere,
  PeriodFilters,
  peakNote,
  periodTitle,
  SHOW_PER,
  usePeriodFilter,
} from "@/components/hearth/analytics";
import { LineChart } from "@/components/hearth/chart";
import { Figs, Head, Panel, Table } from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { dataSize } from "@/lib/data-size";
import { hoursAndMinutes } from "@/lib/duration";
import { LoadFailed, useLoad } from "@/lib/load";
import { useSession } from "@/lib/session";

export default function UsagePage() {
  return (
    <Suspense>
      <Usage />
    </Suspense>
  );
}

/**
 * Analytics › Usage (prototype `usage`): how the WiFi was used, from the sessions the routers
 * report. Counts only: no device or session is listed here.
 */
function Usage() {
  const { me } = useSession();
  const { filter, set, query, scope } = usePeriodFilter();
  const report = useLoad("usage", () => api.get<UsageReport>(`/api/analytics/usage?${query}`), [
    query,
    me.active.id,
  ]);
  const r = report.data;
  const platform = me.active.scope === "platform";
  return (
    <>
      <Head title="Usage" sub={r ? `${periodTitle(r.period)} · ${scope}` : scope} />
      <PeriodFilters filter={filter} set={set} served={r?.period ?? null} />
      {report.error ? <LoadFailed error={report.error} retry={report.reload} /> : null}
      {r === null ? null : r.empty ? (
        <NothingHere title="Usage" />
      ) : (
        <>
          <Figs
            items={[
              ["Devices", r.devices, `${r.returning} came back on another day`],
              ["Sessions", r.sessions, `${r.sessionsPerDay} a day on average`],
              [
                "Average session",
                r.averageSessionMinutes === null
                  ? "None yet"
                  : hoursAndMinutes(r.averageSessionMinutes),
                "from joining to leaving",
              ],
              ["Data used", dataSize(r.dataBytes), `${dataSize(r.dataPerSessionBytes)} a session`],
            ]}
          />
          <Panel
            title={`Sessions per ${SHOW_PER[r.period.show]}`}
            right={<span className="note">{r.sessions} sessions</span>}
          >
            <LineChart
              values={r.series}
              axis={axisOf(r.period)}
              unit={SHOW_PER[r.period.show]}
              label={`Sessions per ${SHOW_PER[r.period.show]}, ${r.sessions} in this period`}
            />
          </Panel>
          <Panel title="Peak hours" right={<span className="note">{peakNote(r.peak)}</span>}>
            <Heatmap peak={r.peak} />
          </Panel>
          {r.venues.length > 1 ? (
            <Panel title="Busiest venues">
              <Table
                cols={[
                  ["Venue"],
                  ["Devices", true],
                  ["Sessions", true],
                  ["Data used", true],
                  ["Online now", true],
                  ...(platform ? ([["Business"]] as [string][]) : []),
                ]}
                rows={r.venues.map((v) => {
                  const top = Math.max(...r.venues.map((x) => x.sessions), 1);
                  return {
                    key: v.venueId,
                    href: `/venues/${v.venueId}`,
                    cells: [
                      <span className="name" key="n">
                        {v.name}
                      </span>,
                      v.devices,
                      <span key="s">
                        <Bar value={v.sessions} top={top} />
                        {v.sessions}
                      </span>,
                      dataSize(v.dataBytes),
                      v.onlineNow,
                      ...(platform ? [v.business ?? ""] : []),
                    ],
                  };
                })}
              />
            </Panel>
          ) : null}
        </>
      )}
    </>
  );
}
