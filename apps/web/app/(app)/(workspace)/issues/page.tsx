"use client";

import type { IssueKind, IssueList } from "@hashinet/types";
import { useState } from "react";
import { Button, Head, Panel, Pill, Table } from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { when } from "@/lib/dates";
import { issuePill, issueTitle, issueWhere, KIND_NAME } from "@/lib/issues";
import { LoadFailed, useLoad } from "@/lib/load";
import { matchesSearch } from "@/lib/search";
import { useCan, useSession } from "@/lib/session";

type Status = "open" | "stalled" | "resolved" | "all";

/**
 * Issues (prototype `issues`): everything that needs someone, open and resolved in one table,
 * narrowed by status, kind and a search. Each open row opens its page, where it is worked.
 */
export default function IssuesPage() {
  const { me } = useSession();
  const can = useCan();
  const platform = me.active.scope === "platform";
  const [status, setStatus] = useState<Status>("open");
  const [kind, setKind] = useState<IssueKind | "">("");
  const [search, setSearch] = useState("");
  const asked = status === "stalled" ? "open" : status;
  const list = useLoad(
    () => api.get<IssueList>(`/api/issues?status=${asked}`),
    [me.active.id, asked],
  );
  const rows = (list.data?.issues ?? []).filter(
    (i) =>
      (status !== "stalled" || i.stalled) &&
      (!kind || i.kind === kind) &&
      matchesSearch(
        search,
        issueTitle(i),
        issueWhere(i),
        KIND_NAME[i.kind],
        i.holder?.name ?? null,
      ),
  );
  const filtered = status !== "open" || kind !== "" || search !== "";
  const open = list.data?.openCount ?? 0;

  return (
    <>
      <Head
        title="Issues"
        sub={
          platform
            ? `${open} open · a router issue closes once the router serves; a setup closes when its venue's first guest gets online`
            : `${open} open · each closes itself once it is dealt with`
        }
      />
      {list.error ? <LoadFailed error={list.error} retry={list.reload} /> : null}
      <section className="panel">
        <form className="audit-filters" onSubmit={(e) => e.preventDefault()}>
          <div className="field grow">
            <label htmlFor="iq">Search</label>
            <input
              id="iq"
              className="input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {platform ? (
            <div className="field">
              <label htmlFor="ik">Kind</label>
              <select
                id="ik"
                className="input"
                value={kind}
                onChange={(e) => setKind(e.target.value as IssueKind | "")}
              >
                <option value="">All kinds</option>
                {(Object.keys(KIND_NAME) as IssueKind[])
                  .filter((k) => k !== "venue_package" || can("onboarding.manage"))
                  .map((k) => (
                    <option key={k} value={k}>
                      {KIND_NAME[k]}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="is">Status</label>
            <select
              id="is"
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
            >
              <option value="open">Open</option>
              <option value="stalled">Stalled</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </div>
          {filtered ? (
            <div className="audit-buttons">
              <Button
                className="ghost"
                onClick={() => {
                  setStatus("open");
                  setKind("");
                  setSearch("");
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : null}
        </form>
      </section>
      {list.data ? (
        <Panel title={`${rows.length} ${rows.length === 1 ? "item" : "items"}`}>
          {rows.length ? (
            <Table
              cols={[
                ["What"],
                ...(platform ? ([["Kind"]] as [string][]) : []),
                ["Status"],
                ["Started"],
                ["Responsible"],
              ]}
              rows={rows.map((i) => {
                const [label, pill] = issuePill(i);
                return {
                  key: i.id,
                  href: `/issues/${i.id}`,
                  cells: [
                    <div key="w">
                      <div className="name">{issueTitle(i)}</div>
                      <div className="sub">{issueWhere(i)}</div>
                    </div>,
                    ...(platform
                      ? [
                          <span className="nowrap" key="k">
                            {KIND_NAME[i.kind]}
                          </span>,
                        ]
                      : []),
                    <Pill key="p" kind={pill}>
                      {label}
                    </Pill>,
                    <span className="num nowrap" key="s">
                      {when(i.openedAt)}
                    </span>,
                    i.holder ? (
                      i.mine ? (
                        "You"
                      ) : (
                        i.holder.name
                      )
                    ) : (
                      <span className="muted nowrap" key="n">
                        Nobody yet
                      </span>
                    ),
                  ],
                };
              })}
            />
          ) : (
            <p className="muted empty">
              {filtered ? "Nothing matches these filters." : "No open issues."}
            </p>
          )}
        </Panel>
      ) : null}
    </>
  );
}
