"use client";

import type { BusinessList, RouterCondition, RouterList } from "@hashinet/types";
import { useState } from "react";
import { CONDITION, Head, Panel, Pill, Table } from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { LoadFailed, useLoad } from "@/lib/load";
import { matchesSearch } from "@/lib/search";
import { useSession } from "@/lib/session";

/**
 * Routers across every business (prototype `routers`, the platform's): only routers that exist; a
 * venue still waiting for one is in Issues and Venues.
 */
export default function RoutersPage() {
  const { me } = useSession();
  const [search, setSearch] = useState("");
  const [state, setState] = useState<RouterCondition | "">("");
  const data = useLoad(async () => {
    const [r, b] = await Promise.all([
      api.get<RouterList>("/api/routers"),
      api.get<BusinessList>("/api/businesses"),
    ]);
    return { routers: r.routers, businesses: b.businesses };
  }, [me.active.id]);
  const businessOf = new Map(
    (data.data?.businesses ?? []).flatMap((b) => b.venues.map((v) => [v.id, b.name] as const)),
  );
  const all = data.data?.routers ?? [];
  const list = all.filter(
    (r) =>
      (!state || r.condition === state) &&
      matchesSearch(search, r.name, r.model, r.venueName, businessOf.get(r.venueId) ?? null),
  );
  const serving = all.filter((r) => r.condition === "serving").length;
  const down = all.filter(
    (r) => r.condition === "offline" || r.condition === "needs-attention",
  ).length;
  const states = [...new Set(all.map((r) => r.condition))];
  return (
    <>
      <Head
        title="Routers"
        sub={`${serving} serving${down ? `, ${down} offline` : ""} · every business`}
      />
      {data.error ? <LoadFailed error={data.error} retry={data.reload} /> : null}
      {all.length ? (
        <section className="panel">
          <form className="audit-filters" onSubmit={(e) => e.preventDefault()}>
            <div className="field grow">
              <label htmlFor="rq">Search</label>
              <input
                id="rq"
                className="input"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {states.length > 1 ? (
              <div className="field">
                <label htmlFor="rs">Status</label>
                <select
                  id="rs"
                  className="input"
                  value={state}
                  onChange={(e) => setState(e.target.value as RouterCondition | "")}
                >
                  <option value="">All statuses</option>
                  {states.map((c) => (
                    <option key={c} value={c}>
                      {CONDITION[c][0]}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </form>
        </section>
      ) : null}
      {data.data ? (
        <Panel title={`${list.length} ${list.length === 1 ? "router" : "routers"}`}>
          {list.length ? (
            <Table
              cols={[
                ["Router"],
                ["RouterOS"],
                ["Status"],
                ["Devices", true],
                ["Business"],
                ["Venue"],
              ]}
              rows={list.map((r) => {
                const [label, kind] = CONDITION[r.condition];
                return {
                  key: r.id,
                  href: `/venues/${r.venueId}/router`,
                  cells: [
                    <div key="n">
                      <div className="name">{r.name}</div>
                      {r.model ? <div className="sub">{r.model}</div> : null}
                    </div>,
                    r.rosVersion ?? (
                      <span className="muted" key="o">
                        Not connected
                      </span>
                    ),
                    <Pill key="s" kind={kind}>
                      {label}
                    </Pill>,
                    r.connectedDevices,
                    businessOf.get(r.venueId) ?? "",
                    r.venueName,
                  ],
                };
              })}
            />
          ) : (
            <p className="muted empty">
              {all.length
                ? "Nothing matches these filters."
                : "No routers yet. HashiNet's team adds the first during a venue's setup."}
            </p>
          )}
        </Panel>
      ) : null}
    </>
  );
}
