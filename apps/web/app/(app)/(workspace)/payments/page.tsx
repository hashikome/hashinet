"use client";

import type { PaymentsReceived, RevenueSource, TodaySummary } from "@hashinet/types";
import { useState } from "react";
import { Button, CopyText, Figs, Head, Panel, Pill, Table, tsh } from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { when } from "@/lib/dates";
import { LoadFailed, useLoad } from "@/lib/load";
import { useSession } from "@/lib/session";
import { useVenues } from "@/lib/venues";

const METHOD: Record<RevenueSource, string> = {
  cash: "Cash",
  mobile_money: "Mobile money",
  card: "Card",
};

/** "November 2026", from "2026-11". */
const monthName = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * Payments (prototype `payments`): what guests paid this business in a month. In slice 1 every
 * payment is a printed voucher a guest used, or a sale already paid; confirming a counter sale
 * comes with selling at the counter (slice 2).
 */
export default function PaymentsPage() {
  const { me } = useSession();
  const { all, shown, filter } = useVenues();
  const [month, setMonth] = useState<string | null>(null);
  const [more, setMore] = useState<PaymentsReceived["payments"]>([]);
  const [next, setNext] = useState<string | null>(null);
  const venueId = filter === "all" ? null : filter;
  const path = (before: string | null) => {
    const q = new URLSearchParams();
    if (month) q.set("month", month);
    if (venueId) q.set("venueId", venueId);
    if (before) q.set("before", before);
    return `/api/payments/received?${q}`;
  };
  const list = useLoad(async () => {
    const page = await api.get<PaymentsReceived>(path(null));
    setMore([]);
    setNext(page.nextBefore);
    return page;
  }, [me.active.id, month, venueId]);

  const today = useLoad(
    () => api.get<TodaySummary>(`/api/analytics/today${venueId ? `?venueId=${venueId}` : ""}`),
    [me.active.id, venueId],
  );
  const data = list.data;
  const label = data ? monthName(data.month) : "";
  const current = data ? data.month === data.months[0] : true;
  const scope = shown.length === 1 ? shown[0]?.name : "All venues";
  const rows = data ? [...data.payments, ...more] : [];
  const showsVenue = all.length > 1;

  return (
    <>
      <Head title="Payments" sub={`${label ? `${label} · ` : ""}what guests paid · ${scope}`} />
      {list.error ? <LoadFailed error={list.error} retry={list.reload} /> : null}
      {data ? (
        <>
          <Figs
            items={[
              ["Received", tsh(Number(data.totalTsh)), `${label}${current ? " so far" : ""}`],
              [
                "Today",
                tsh(Number(today.data?.takingsTsh ?? 0)),
                `${today.data?.sold ?? 0} ${today.data?.sold === 1 ? "voucher" : "vouchers"} so far`,
              ],
            ]}
          />
          {data.months.length > 1 ? (
            <section className="panel">
              <form className="audit-filters" onSubmit={(e) => e.preventDefault()}>
                <div className="field">
                  <label htmlFor="pay-month">Month</label>
                  <select
                    id="pay-month"
                    className="input"
                    value={data.month}
                    onChange={(e) => setMonth(e.target.value)}
                  >
                    {data.months.map((m) => (
                      <option key={m} value={m}>
                        {monthName(m)}
                      </option>
                    ))}
                  </select>
                </div>
              </form>
            </section>
          ) : null}
          <Panel title={`${data.count} ${data.count === 1 ? "payment" : "payments"}`}>
            {rows.length ? (
              <Table
                cols={[
                  ["Time"],
                  ["Package"],
                  ["Paid by"],
                  ["Amount", true],
                  ["Status"],
                  ...(showsVenue ? ([["Venue"]] as [string][]) : []),
                ]}
                rows={rows.map((p) => ({
                  key: p.id,
                  cells: [
                    <span className="nowrap" key="t">
                      {when(p.occurredAt)}
                    </span>,
                    p.packageName ?? "A package since removed",
                    <span key="m">
                      {METHOD[p.source]}
                      <div className="sub">
                        {p.kind === "printed" ? (
                          "Printed voucher"
                        ) : p.reference ? (
                          <CopyText text={p.reference} />
                        ) : (
                          "Recorded here"
                        )}
                      </div>
                    </span>,
                    tsh(Number(p.amountTsh)),
                    <Pill key="s" kind="ok">
                      Paid
                    </Pill>,
                    ...(showsVenue ? [p.venueName ?? ""] : []),
                  ],
                }))}
              />
            ) : (
              <p className="muted empty">
                No payments yet. A printed voucher counts once a guest uses it.
              </p>
            )}
            {next ? (
              <div className="actions" style={{ marginTop: 12 }}>
                <Button
                  onClick={async () => {
                    const page = await api.get<PaymentsReceived>(path(next));
                    setMore((m) => [...m, ...page.payments]);
                    setNext(page.nextBefore);
                  }}
                >
                  Load more
                </Button>
              </div>
            ) : null}
          </Panel>
        </>
      ) : null}
    </>
  );
}
