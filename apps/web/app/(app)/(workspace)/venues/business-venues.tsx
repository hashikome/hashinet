"use client";

import type { VenueTakings } from "@hashinet/types";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Head, Panel, Pill, Table } from "@/components/hearth/ui";
import { STATUS, sellingPill, VenueDialog } from "@/components/hearth/venues";
import { api } from "@/lib/api";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";
import { matchesSearch } from "@/lib/search";
import { useCan, useSession } from "@/lib/session";
import { useVenues } from "@/lib/venues";

/**
 * A business's Venues (prototype `venues`): each venue it reaches, open or not, how its routers
 * are doing, and what it took this week; the owner adds a venue here.
 */
export function BusinessVenues() {
  const { me } = useSession();
  const can = useCan();
  const router = useRouter();
  const { all, reload } = useVenues();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const money = can("analytics.read");
  const takings = useLoad(
    "venue-takings",
    () =>
      money
        ? api.get<VenueTakings>("/api/analytics/venue-takings")
        : Promise.resolve({ venues: [] }),
    [money, me.active.id],
  );
  const week = new Map((takings.data?.venues ?? []).map((t) => [t.venueId, t]));
  const list = all.filter((v) => matchesSearch(search, v.name, v.area, v.region));
  return (
    <>
      <Head
        title="Venues"
        sub={`${all.length} ${all.length === 1 ? "venue" : "venues"}`}
        actions={
          can("venue.create") ? (
            <Button kind="primary" icon="plus" onClick={() => setAdding(true)}>
              Add a venue
            </Button>
          ) : null
        }
      />
      {takings.error ? <LoadFailed error={takings.error} retry={takings.reload} /> : null}
      {all.length > 6 ? (
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
          </form>
        </section>
      ) : null}
      <Panel title={`${list.length} ${list.length === 1 ? "venue" : "venues"}`}>
        {list.length ? (
          <Table
            cols={[
              ["Venue"],
              ["Status"],
              ["Routers"],
              ...(money ? ([["Last 7 days", true]] as [string, boolean][]) : []),
            ]}
            rows={list.map((v) => {
              const [status, statusKind] = STATUS[v.status];
              const [selling, sellingKind] = sellingPill(v);
              const t = week.get(v.id);
              return {
                key: v.id,
                href: `/venues/${v.id}`,
                cells: [
                  <div key="n">
                    <div className="name">{v.name}</div>
                    <div className="sub">
                      {v.area}, {v.region}
                    </div>
                  </div>,
                  <Pill key="s" kind={statusKind}>
                    {status}
                  </Pill>,
                  <Pill key="r" kind={sellingKind}>
                    {selling}
                  </Pill>,
                  ...(money
                    ? [
                        <span key="w" className="nowrap">
                          {tsh(t?.weekTsh ?? 0)}
                        </span>,
                      ]
                    : []),
                ],
              };
            })}
          />
        ) : (
          <p className="muted empty">{all.length ? "Nothing matches." : "No venues yet."}</p>
        )}
      </Panel>
      {adding ? (
        <VenueDialog
          venue={null}
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            reload();
            router.push(`/venues/${id}`);
          }}
        />
      ) : null}
    </>
  );
}
