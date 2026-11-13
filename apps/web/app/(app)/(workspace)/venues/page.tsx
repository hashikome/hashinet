"use client";

import type { BusinessList, GuestCounts } from "@hashinet/types";
import { useState } from "react";
import { CONDITION, Head, Panel, Pill, Table } from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { STAGE } from "@/lib/issues";
import { LoadFailed, useLoad } from "@/lib/load";
import { useSession } from "@/lib/session";

/**
 * Venues across every business (prototype `venues`, the platform's): where each is on its way to
 * serving, its routers and its guests as counts. Each business edits its own.
 */
export default function VenuesPage() {
  const { me } = useSession();
  const [search, setSearch] = useState("");
  const [business, setBusiness] = useState("");
  const data = useLoad(async () => {
    const [b, counts] = await Promise.all([
      api.get<BusinessList>("/api/businesses"),
      api.get<GuestCounts>("/api/guest-counts"),
    ]);
    return { businesses: b.businesses, counts };
  }, [me.active.id]);
  const all = (data.data?.businesses ?? []).flatMap((b) =>
    b.venues.map((v) => ({ ...v, business: { id: b.id, name: b.name } })),
  );
  const counts = new Map((data.data?.counts.venues ?? []).map((c) => [c.venue.id, c]));
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const list = all.filter(
    (v) =>
      (!business || v.business.id === business) &&
      words.every((w) =>
        `${v.name} ${v.area} ${v.region} ${v.business.name}`.toLowerCase().includes(w),
      ),
  );
  const businesses = data.data?.businesses ?? [];
  return (
    <>
      <Head
        title="Venues"
        sub={`${all.length} ${all.length === 1 ? "venue" : "venues"} · every business. Each business edits its own.`}
      />
      {data.error ? <LoadFailed error={data.error} retry={data.reload} /> : null}
      <section className="panel">
        <form className="audit-filters" onSubmit={(e) => e.preventDefault()}>
          <div className="field grow">
            <label htmlFor="vq">Search</label>
            <input
              id="vq"
              className="input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {businesses.length > 1 ? (
            <div className="field">
              <label htmlFor="vb">Business</label>
              <select
                id="vb"
                className="input"
                value={business}
                onChange={(e) => setBusiness(e.target.value)}
              >
                <option value="">All businesses</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </form>
      </section>
      {data.data ? (
        <Panel title={`${list.length} ${list.length === 1 ? "venue" : "venues"}`}>
          {list.length ? (
            <Table
              cols={[["Venue"], ["Status"], ["Routers", true], ["Online now", true], ["Business"]]}
              rows={list.map((v) => {
                const [state, kind] = CONDITION[v.condition];
                return {
                  key: v.id,
                  href: `/venues/${v.id}/router`,
                  cells: [
                    <div key="n">
                      <div className="name">{v.name}</div>
                      <div className="sub">
                        {v.area}, {v.region}
                      </div>
                    </div>,
                    v.stage === "done" ? (
                      <Pill key="s" kind={kind}>
                        {state}
                      </Pill>
                    ) : (
                      <Pill key="s" kind="wait">
                        {STAGE[v.stage]}
                      </Pill>
                    ),
                    v.routers,
                    counts.get(v.id)?.onlineNow ?? 0,
                    v.business.name,
                  ],
                };
              })}
            />
          ) : (
            <p className="muted empty">
              {all.length ? "Nothing matches these filters." : "No venues yet."}
            </p>
          )}
        </Panel>
      ) : null}
    </>
  );
}
