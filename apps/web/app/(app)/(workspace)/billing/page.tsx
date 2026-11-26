"use client";

import type { BillingAccount, BillingOverview, BillingRow, BillState } from "@hashinet/types";
import { useState } from "react";
import { BillActions, HowToPay, InvoicesPanel, percent } from "@/components/hearth/billing";
import { Attention, Figs, Head, Panel, Pill, type PillKind, Table } from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { fullDay, invoiceWhat, monthName } from "@/lib/billing";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";
import { useSession } from "@/lib/session";

/** HashiNet's own Payments for its staff; an owner's Billing for a business. */
export default function BillingPage() {
  const { me } = useSession();
  return me.active.scope === "platform" ? <Payments /> : <OwnerBilling />;
}

/**
 * Billing (prototype `ownerBilling`): how a business pays HashiNet. Its terms, what is due, how
 * to pay and its invoices. Only its owner sees it.
 */
function OwnerBilling() {
  const { me } = useSession();
  const load = useLoad("billing-account", () => api.get<BillingAccount>("/api/billing/account"), [
    me.active.id,
  ]);
  const head = <Head title="Billing" sub="How you pay for HashiNet" />;
  if (load.error) {
    return (
      <>
        {head}
        <LoadFailed error={load.error} retry={load.reload} />
      </>
    );
  }
  const a = load.data;
  if (!a) return head;
  const late = a.owed.filter((i) => i.state === "overdue");
  const first = a.owed[0];
  return (
    <>
      {head}
      {first ? (
        <Attention
          bad={late.length > 0}
          title={
            late.length
              ? `${tsh(a.overdueTsh)} is overdue`
              : `${tsh(a.dueTsh)} is due by ${fullDay(first.dueOn)}`
          }
        >
          {a.owed.map((i) => `${invoiceWhat(i)}: ${tsh(i.dueTsh)}`).join(" · ")}
        </Attention>
      ) : null}
      <Panel title={`${percent(a.terms.rateBp)} of each venue's sales`}>
        <p className="muted">
          At least {tsh(a.terms.minimumTsh)} a month per venue, and {percent(a.terms.lowerRateBp)}{" "}
          on sales above {tsh(a.terms.lowerRateAboveTsh)} a month.
        </p>
      </Panel>
      <HowToPay payTo={a.payTo} />
      <InvoicesPanel invoices={a.invoices} />
    </>
  );
}

const STATE: Record<BillState, [string, PillKind]> = {
  overdue: ["Overdue", "bad"],
  part_paid: ["Part paid", "wait"],
  due: ["Due", "wait"],
  paid: ["Paid", "ok"],
  open: ["Open", "neutral"],
  no_fee: ["No fee", "neutral"],
};

type By = "Month" | "Quarter" | "Year" | "Custom";

/** The periods to pick from, newest first: each a label and its first and last month. */
function periods(by: By, months: string[]): [string, string, string][] {
  const newest = [...months].reverse();
  if (by === "Month") return newest.map((m) => [monthName(m), m, m]);
  const groups = new Map<string, string[]>();
  for (const m of months) {
    const [y, n] = m.split("-").map(Number) as [number, number];
    const key = by === "Year" ? String(y) : `Q${Math.ceil(n / 3)} ${y}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.entries()]
    .reverse()
    .map(([label, list]) => [label, list[0] ?? "", list.at(-1) ?? ""]);
}

/**
 * Payments (prototype `billing`): every business's bill for a month, a quarter, a year or a range,
 * with what was paid and what is due, and Record payment and Remind on each. A row opens that
 * business's bill.
 */
function Payments() {
  const [by, setBy] = useState<By>("Month");
  const [range, setRange] = useState<[string, string] | null>(null);
  const [custom, setCustom] = useState<[string, string] | null>(null);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<BillState | "">("");
  // The first load picks the newest month; later ones keep what the reader chose.
  const load = useLoad("billing-overview", async () => {
    const [from, to] = range ?? [null, null];
    if (from && to) return api.get<BillingOverview>(`/api/billing/overview?from=${from}&to=${to}`);
    const now = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" })
      .format(new Date())
      .slice(0, 7);
    return api.get<BillingOverview>(`/api/billing/overview?from=${now}&to=${now}`);
  }, [range?.[0], range?.[1]]);
  const o = load.data;
  const months = o?.months ?? [];
  const list = periods(by, months);
  const label =
    o === null
      ? ""
      : o.from === o.to
        ? monthName(o.from)
        : (list.find(([, f, t]) => f === o.from && t === o.to)?.[0] ??
          `${monthName(o.from)} to ${monthName(o.to)}`);
  const rows = (o?.rows ?? []).filter(
    (r) =>
      (!state || r.state === state) &&
      `${r.name} ${r.ownerName ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const t = o?.totals;
  const pick = (next: By) => {
    setBy(next);
    if (next === "Custom") {
      const both = (o ? [o.from, o.to] : ["", ""]) as [string, string];
      setCustom(both);
      return;
    }
    const first = periods(next, months)[0];
    if (first) setRange([first[1], first[2]]);
  };
  const rate = (r: BillingRow) => {
    if (r.lowerRate && r.salesTsh > 0) {
      return (
        <>
          <span className="num">{((r.feesTsh / r.salesTsh) * 100).toFixed(1)}%</span>
          <div className="sub">lower rate above the threshold</div>
        </>
      );
    }
    return (
      <>
        <span className="num">{percent(r.rateBp)}</span>
        {r.minimum ? <div className="sub nowrap">Minimum</div> : null}
      </>
    );
  };
  return (
    <>
      <Head
        title="Payments"
        sub={`${label}${label ? " · " : ""}What each business owes HashiNet`}
      />
      {load.error ? <LoadFailed error={load.error} retry={load.reload} /> : null}
      {t ? (
        <Figs
          items={[
            [
              "Billed",
              tsh(t.billedTsh),
              `${t.venues} ${t.venues === 1 ? "venue" : "venues"} · ${tsh(t.salesTsh)} in sales`,
            ],
            [
              "Paid",
              tsh(t.paidTsh),
              t.billedTsh
                ? `${Math.round((t.paidTsh / t.billedTsh) * 100)}% collected`
                : "nothing billed",
            ],
            [
              "Due",
              tsh(t.dueTsh),
              t.owing
                ? `from ${t.owing} ${t.owing === 1 ? "business" : "businesses"}`
                : "nothing owed",
            ],
            [
              "Overdue",
              tsh(t.overdueTsh),
              t.overdue.length ? t.overdue.join(", ") : "none past its date",
            ],
          ]}
        />
      ) : null}
      <section className="panel">
        <form className="audit-filters" onSubmit={(e) => e.preventDefault()}>
          <div className="field grow">
            <label htmlFor="bq">Search</label>
            <input
              id="bq"
              className="input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="bb">By</label>
            <select
              id="bb"
              className="input"
              value={by}
              onChange={(e) => pick(e.target.value as By)}
            >
              {(["Month", "Quarter", "Year", "Custom"] as const).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          {by === "Custom" && custom ? (
            <>
              {(["From", "To"] as const).map((which, n) => (
                <div className="field date-pair" key={which}>
                  <label htmlFor={`b${which}`}>{which}</label>
                  <select
                    id={`b${which}`}
                    className="input"
                    value={custom[n]}
                    onChange={(e) => {
                      const next: [string, string] =
                        n === 0 ? [e.target.value, custom[1]] : [custom[0], e.target.value];
                      const ordered = next.toSorted() as [string, string];
                      setCustom(next);
                      setRange(ordered);
                    }}
                  >
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {monthName(m)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </>
          ) : (
            <div className="field">
              <label htmlFor="bp">{by}</label>
              <select
                id="bp"
                className="input"
                value={o ? `${o.from}|${o.to}` : ""}
                onChange={(e) => setRange(e.target.value.split("|") as [string, string])}
              >
                {list.map(([l, f, to]) => (
                  <option key={l} value={`${f}|${to}`}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="bs">Status</label>
            <select
              id="bs"
              className="input"
              value={state}
              onChange={(e) => setState(e.target.value as BillState | "")}
            >
              <option value="">All</option>
              {(Object.keys(STATE) as BillState[]).map((s) => (
                <option key={s} value={s}>
                  {STATE[s][0]}
                </option>
              ))}
            </select>
          </div>
        </form>
      </section>
      {o ? (
        <Panel title={`${rows.length} ${rows.length === 1 ? "business" : "businesses"}`}>
          {rows.length ? (
            <Table
              cols={[
                ["Business"],
                ["Sales", true],
                ["Rate", true],
                ["Billed", true],
                ["Paid", true],
                ["Amount due", true],
                ["Status"],
                [""],
              ]}
              rows={rows.map((r) => ({
                key: r.businessId,
                href: `/billing/${r.businessId}`,
                cells: [
                  <div key="b">
                    <div className="name">{r.name}</div>
                    <div className="sub">{r.ownerName ?? "No owner yet"}</div>
                  </div>,
                  <span className="nowrap" key="s">
                    {tsh(r.salesTsh)}
                  </span>,
                  <div key="r">{rate(r)}</div>,
                  <div key="f">
                    <span className="nowrap">{tsh(r.billedTsh)}</span>
                    {r.oneOffTsh ? (
                      <div className="sub nowrap">{tsh(r.oneOffTsh)} one-off</div>
                    ) : null}
                  </div>,
                  <span className="nowrap" key="p">
                    {tsh(r.paidTsh)}
                  </span>,
                  <span className="nowrap" key="d">
                    {tsh(r.dueTsh)}
                  </span>,
                  <div key="st">
                    <Pill kind={STATE[r.state][1]}>{STATE[r.state][0]}</Pill>
                    {r.state === "open" && o.invoicedOn ? (
                      <div className="sub">Billed on {fullDay(o.invoicedOn)}</div>
                    ) : r.monthsBilled > 1 && r.state !== "paid" ? (
                      <div className="sub">
                        {r.monthsPaid} of {r.monthsBilled} months paid
                      </div>
                    ) : null}
                  </div>,
                  <BillActions
                    key="a"
                    row
                    businessId={r.businessId}
                    ownerName={r.ownerName}
                    owedTsh={r.dueTsh}
                    says={`${r.name} owes ${tsh(r.dueTsh)}. A payment settles the oldest bill first.`}
                    onDone={load.reload}
                  />,
                ],
              }))}
            />
          ) : (
            <p className="muted empty">Nothing matches these filters.</p>
          )}
        </Panel>
      ) : null}
      <p className="muted small">
        Fees are counted on each sold voucher&apos;s price, less refunds, with a minimum a month per
        serving venue. One-off charges are onboarding. A payment settles the oldest bill first.
      </p>
    </>
  );
}
