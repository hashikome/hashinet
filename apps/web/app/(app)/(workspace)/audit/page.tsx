"use client";

import { AUDIT_ACTIONS, type AuditAction, type AuditEntry, type AuditList } from "@hashinet/types";
import { useEffect, useState } from "react";
import { Button, Head, Panel, Pill, Table } from "@/components/ui/ui";
import { api } from "@/lib/api";
import { ACTION_NAME, changeLines, OUTCOME, targetOf } from "@/lib/audit";
import { when } from "@/lib/dates";
import { LoadFailed, useLoad } from "@/lib/load";
import { ROLE_NAME } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { useVenues } from "@/lib/venues";

const PAGE = 50;
// Reads have their own list; this one is what people changed.
const ACTIONS = AUDIT_ACTIONS.filter((a) => a !== "voucher.read").toSorted((a, b) =>
  ACTION_NAME[a].localeCompare(ACTION_NAME[b]),
);

interface Filters {
  search: string;
  venueId: string;
  action: AuditAction | "";
  from: string;
  to: string;
}
const NONE: Filters = { search: "", venueId: "", action: "", from: "", to: "" };

/** Audit log (prototype `audit`): what was done in the workspace, newest first. */
export default function AuditPage() {
  const { me } = useSession();
  const { all } = useVenues();
  const platform = me.active.scope === "platform";
  const [f, setF] = useState<Filters>(NONE);
  const [typed, setTyped] = useState("");
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setTyped(f.search.trim()), 250);
    return () => clearTimeout(timer);
  }, [f.search]);
  const query = (before: string | null) => {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (typed) q.set("search", typed);
    if (f.venueId) q.set("venueId", f.venueId);
    if (f.action) q.set("action", f.action);
    if (f.from) q.set("from", f.from);
    if (f.to) q.set("to", f.to);
    if (before) q.set("before", before);
    return `/api/audit?${q}`;
  };
  const list = useLoad("audit", async () => {
    const page = await api.get<AuditList>(query(null));
    setMore([]);
    setNext(page.nextBefore);
    return page.entries;
  }, [me.active.id, typed, f.venueId, f.action, f.from, f.to]);
  const entries = [...(list.data ?? []), ...more];
  const showsVenue = platform || all.length > 1;
  const filtered = f.search || f.venueId || f.action || f.from || f.to;
  const place = all.length === 1 && all[0] ? all[0].name : me.active.business?.name;
  const where = place ? `Everything done in ${place}` : "What your team and HashiNet did";
  const set = (patch: Partial<Filters>) => setF((was) => ({ ...was, ...patch }));

  return (
    <>
      <Head title="Audit log" sub={`${where}, newest first. Times in East Africa Time.`} />
      <section className="panel" aria-label="Filters">
        <form className="audit-filters" onSubmit={(e) => e.preventDefault()}>
          <div className="field grow">
            <label htmlFor="aq">Who</label>
            <input
              id="aq"
              className="input"
              type="search"
              value={f.search}
              onChange={(e) => set({ search: e.target.value })}
            />
          </div>
          {all.length > 1 ? (
            <div className="field">
              <label htmlFor="av">Venue</label>
              <select
                id="av"
                className="input"
                value={f.venueId}
                onChange={(e) => set({ venueId: e.target.value })}
              >
                <option value="">All venues</option>
                {all.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="aa">Action</label>
            <select
              id="aa"
              className="input"
              value={f.action}
              onChange={(e) => {
                const action = ACTIONS.find((a) => a === e.target.value);
                set({ action: action ?? "" });
              }}
            >
              <option value="">All actions</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_NAME[a]}
                </option>
              ))}
            </select>
          </div>
          <div className="field date-pair">
            <label htmlFor="af">From</label>
            <input
              id="af"
              className="input"
              type="date"
              value={f.from}
              onChange={(e) => set({ from: e.target.value })}
            />
          </div>
          <div className="field date-pair">
            <label htmlFor="at">To</label>
            <input
              id="at"
              className="input"
              type="date"
              value={f.to}
              onChange={(e) => set({ to: e.target.value })}
            />
          </div>
          {filtered ? (
            <div className="audit-buttons">
              <Button className="ghost" onClick={() => setF(NONE)}>
                Clear filters
              </Button>
            </div>
          ) : null}
        </form>
      </section>
      {list.error ? <LoadFailed error={list.error} retry={list.reload} /> : null}
      <Panel
        title={`${entries.length}${next ? "+" : ""} ${entries.length === 1 ? "event" : "events"}`}
      >
        {list.data === null ? null : entries.length ? (
          <Table
            cols={[
              ["Time"],
              ["Who"],
              ["Action"],
              ["Target"],
              ["Outcome"],
              ["Change"],
              ...(platform ? ([["Business"]] as [string][]) : []),
              ...(showsVenue ? ([["Venue"]] as [string][]) : []),
            ]}
            rows={entries.map((e) => ({
              key: e.id,
              cells: [
                <span key="t" className="num nowrap">
                  {when(e.createdAt)}
                </span>,
                e.actor ? (
                  <div key="a">
                    <div className="name">{e.actor.name}</div>
                    <div className="sub">{ROLE_NAME[e.actor.role]}</div>
                  </div>
                ) : (
                  "HashiNet"
                ),
                ACTION_NAME[e.action],
                targetOf(e),
                <Pill key="o" kind={OUTCOME[e.outcome][1]}>
                  {OUTCOME[e.outcome][0]}
                </Pill>,
                changeLines(e).length ? (
                  <div key="c" className="small">
                    {changeLines(e).map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                ) : (
                  <span key="c" className="muted">
                    —
                  </span>
                ),
                ...(platform ? [e.business?.name ?? "HashiNet"] : []),
                ...(showsVenue ? [e.venue?.name ?? "—"] : []),
              ],
            }))}
          />
        ) : (
          <p className="muted empty">
            {filtered ? "No events match these filters." : "Nothing has been done yet."}
          </p>
        )}
        {next ? (
          <div className="audit-more" style={{ marginTop: 12 }}>
            <Button
              onClick={async () => {
                const page = await api.get<AuditList>(query(next));
                setMore((m) => [...m, ...page.entries]);
                setNext(page.nextBefore);
              }}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </Panel>
    </>
  );
}
