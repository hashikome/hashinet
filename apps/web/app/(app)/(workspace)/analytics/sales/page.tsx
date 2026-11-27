"use client";

import type { PlatformSalesReport, SalesReport } from "@hashinet/types";
import { Suspense } from "react";
import {
  axisOf,
  NothingHere,
  PeriodFilters,
  periodTitle,
  SHOW_PER,
  usePeriodFilter,
} from "@/components/hearth/analytics";
import { LineChart } from "@/components/hearth/chart";
import { Figs, Head, Panel, Table } from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";
import { useSession } from "@/lib/session";

export default function SalesPage() {
  return (
    <Suspense>
      <Sales />
    </Suspense>
  );
}

/** Analytics › Sales: a business's takings, or, for HashiNet's team, sales across businesses. */
function Sales() {
  const { me } = useSession();
  return me.active.scope === "platform" ? <PlatformSales /> : <BusinessSales />;
}

/** A bar beside a figure, as long as its share of the largest. */
const bar = (value: number, top: number) => (
  <span className="bar-in" style={{ width: (value / Math.max(top, 1)) * 48 }} />
);

/** Sales (prototype `businessSales`): net takings, as Payments counts them. */
function BusinessSales() {
  const { me } = useSession();
  const { filter, set, query, scope } = usePeriodFilter();
  const report = useLoad("sales", () => api.get<SalesReport>(`/api/analytics/sales?${query}`), [
    query,
    me.active.id,
  ]);
  const r = report.data;
  const today = r?.period.range === "current" && r.period.period === "day";
  const days = Math.max(r?.period.days ?? 1, 1);
  const top = Math.max(...(r?.venues.map((v) => Number(v.takingsTsh)) ?? [0]));
  const first = r?.packages[0];
  return (
    <>
      <Head title="Sales" sub={r ? `${periodTitle(r.period)} · ${scope}` : scope} />
      <PeriodFilters filter={filter} set={set} shows={r?.period.shows ?? []} />
      {report.error ? <LoadFailed error={report.error} retry={report.reload} /> : null}
      {r === null ? null : r.empty ? (
        <NothingHere title="Sales" />
      ) : (
        <>
          <Figs
            items={[
              [
                "Takings",
                tsh(r.takingsTsh),
                today
                  ? "so far today"
                  : `${tsh(Math.round(Number(r.takingsTsh) / days))} a day on average`,
              ],
              [
                "Vouchers sold",
                r.vouchers,
                today
                  ? "at the counter and online"
                  : `${Math.round(r.vouchers / days)} a day on average`,
              ],
              [
                "Average sale",
                r.averageSaleTsh === null ? "None" : tsh(r.averageSaleTsh),
                "per voucher",
              ],
              [
                "Best seller",
                r.bestSeller?.name ?? "None",
                r.bestSeller
                  ? `${r.bestSeller.vouchers} ${r.bestSeller.vouchers === 1 ? "voucher" : "vouchers"}`
                  : "nothing sold",
              ],
            ]}
          />
          <Panel
            title={`Takings per ${SHOW_PER[r.period.show]}`}
            right={<span className="note">{tsh(r.takingsTsh)}</span>}
          >
            <LineChart
              values={r.series}
              axis={axisOf(r.period)}
              label={`Takings per ${SHOW_PER[r.period.show]}, ${tsh(r.takingsTsh)} in this period`}
            />
          </Panel>
          <div className="even">
            {r.venues.length > 1 ? (
              <Panel title="Takings by venue">
                <Table
                  cols={[["Venue"], ["Vouchers", true], ["Takings", true], ["Share", true]]}
                  rows={r.venues.map((v) => ({
                    key: v.venueId,
                    href: `/venues/${v.venueId}`,
                    cells: [
                      <span className="name nowrap" key="n">
                        {v.name}
                      </span>,
                      v.vouchers,
                      <span key="t">
                        {bar(Number(v.takingsTsh), top)}
                        {tsh(v.takingsTsh)}
                      </span>,
                      `${v.share}%`,
                    ],
                  }))}
                  total={["Total", r.vouchers, tsh(r.takingsTsh), "100%"]}
                />
              </Panel>
            ) : null}
            <Panel
              title="What guests buy"
              right={
                <span className="note">
                  {r.vouchers} {r.vouchers === 1 ? "voucher" : "vouchers"}
                </span>
              }
            >
              <ul className="mix">
                {r.packages.map((p) => (
                  <li key={p.name}>
                    <div className="mix-top">
                      <span>{p.name}</span>
                      <span className="num">
                        {p.vouchers} <span className="muted">· {tsh(p.takingsTsh)}</span>
                      </span>
                    </div>
                    <div className="track">
                      <span
                        style={{ width: `${r.vouchers ? (p.vouchers / r.vouchers) * 100 : 0}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              {first && r.packages.length > 1 && r.vouchers && Number(r.takingsTsh) > 0 ? (
                <p className="note">
                  {first.name} vouchers are {Math.round((first.vouchers / r.vouchers) * 100)}% of
                  sales but {Math.round((Number(first.takingsTsh) / Number(r.takingsTsh)) * 100)}%
                  of takings.
                </p>
              ) : null}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

/** Sales across businesses (prototype `platformAnalytics`): what they sell and HashiNet's fees. */
function PlatformSales() {
  const { filter, set, query, scope } = usePeriodFilter();
  const report = useLoad(
    "platform-sales",
    () => api.get<PlatformSalesReport>(`/api/analytics/platform-sales?${query}`),
    [query],
  );
  const r = report.data;
  const top = Math.max(...(r?.businesses.map((b) => Number(b.salesTsh)) ?? [0]));
  const fresh = r?.newBusinesses ?? [];
  return (
    <>
      <Head title="Sales" sub={r ? `${periodTitle(r.period)} · ${scope}` : scope} />
      <PeriodFilters filter={filter} set={set} shows={r?.period.shows ?? []} />
      {report.error ? <LoadFailed error={report.error} retry={report.reload} /> : null}
      {r === null ? null : (
        <>
          <Figs
            items={[
              [
                "Sales across businesses",
                tsh(r.salesTsh),
                `${r.businesses.length} ${r.businesses.length === 1 ? "business" : "businesses"}`,
              ],
              ["HashiNet fees", tsh(r.feesTsh), "on these sales, by each business's terms"],
              ["Venues serving", r.venuesServing, `${r.venuesNotServing} not serving`],
              [
                "New businesses",
                fresh.length,
                fresh.length ? fresh.map((b) => b.name).join(", ") : "none in this period",
              ],
            ]}
          />
          {r.empty ? (
            <NothingHere title="Sales" />
          ) : (
            <>
              <Panel
                title={`Sales per ${SHOW_PER[r.period.show]}`}
                right={<span className="note">{tsh(r.salesTsh)}</span>}
              >
                <LineChart
                  values={r.series}
                  axis={axisOf(r.period)}
                  label={`Sales per ${SHOW_PER[r.period.show]}, ${tsh(r.salesTsh)} in this period`}
                />
              </Panel>
              <Panel title="Businesses">
                <Table
                  cols={[
                    ["Business"],
                    ["Venues", true],
                    ["Sales", true],
                    ["Share", true],
                    ["HashiNet fee", true],
                  ]}
                  rows={r.businesses.map((b) => ({
                    key: b.businessId,
                    href: `/businesses/${b.businessId}`,
                    cells: [
                      <span className="name" key="n">
                        {b.name}
                      </span>,
                      b.venues,
                      <span key="s">
                        {bar(Number(b.salesTsh), top)}
                        {tsh(b.salesTsh)}
                      </span>,
                      `${b.share}%`,
                      tsh(b.feeTsh),
                    ],
                  }))}
                />
              </Panel>
            </>
          )}
        </>
      )}
    </>
  );
}
