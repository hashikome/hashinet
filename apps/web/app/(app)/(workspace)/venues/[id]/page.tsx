"use client";

import type { SalesReport, VenueDetail, VenueOnboarding, VenueTakings } from "@hashinet/types";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { axisOf, SHOW_PER } from "@/components/analytics/analytics";
import { GettingStarted } from "@/components/platform/onboarding";
import { LineChart } from "@/components/ui/chart";
import { BusinessMark } from "@/components/ui/icons";
import { Button, CopyText, Figs, Panel, Pill } from "@/components/ui/ui";
import { VenueWay } from "@/components/venues/payment-ways";
import { SitesPanel } from "@/components/venues/sites";
import { STATUS, sellingPill, VenueDialog } from "@/components/venues/venues";
import { api } from "@/lib/api";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";
import { useCan, useSession } from "@/lib/session";
import { useVenues } from "@/lib/venues";

/**
 * A venue's page (prototype `venue`): a profile card with who runs it and how its routers are
 * doing, then the venue's own panels: its takings and the way to pay its counter reads out, or,
 * before its router serves, its way online. One page for every role; each sees what their role has.
 */
export default function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useSession();
  const can = useCan();
  const { reload: reloadVenues } = useVenues();
  const [editing, setEditing] = useState(false);
  // A business's own figures: HashiNet's team reads a venue's sales from Analytics.
  const money = me.active.scope === "business" && can("analytics.read");
  const data = useLoad("venue", async () => {
    const detail = await api.get<VenueDetail>(`/api/venues/${id}`);
    const settingUp = detail.venue.selling.state === "not-set-up";
    const [onboarding, takings, week] = await Promise.all([
      settingUp && can("onboarding.read")
        ? api.get<VenueOnboarding>(`/api/venues/${id}/onboarding`)
        : null,
      !settingUp && money ? api.get<VenueTakings>("/api/analytics/venue-takings") : null,
      !settingUp && money
        ? api.get<SalesReport>(`/api/analytics/sales?range=last&period=7d&show=day&venueId=${id}`)
        : null,
    ]);
    return { ...detail, onboarding, takings, week };
  }, [id, me.active.id]);
  const v = data.data?.venue;
  useEffect(() => {
    if (v) document.title = `${v.name} · HashiNet`;
  }, [v]);
  const crumb = (
    <div className="crumb">
      <Link href="/venues">Venues</Link> /
    </div>
  );
  if (data.error) {
    return (
      <>
        {crumb}
        <LoadFailed error={data.error} retry={data.reload} />
      </>
    );
  }
  if (!data.data || !v) return crumb;
  const { managers, onboarding, takings, week } = data.data;
  const [status, statusKind] = STATUS[v.status];
  const [routers, routersKind] = sellingPill(v);
  const t = takings?.venues.find((x) => x.venueId === v.id) ?? null;

  return (
    <>
      {crumb}
      <aside className="profile-card">
        <div className="panel profile-body">
          <BusinessMark name={v.name} size={64} />
          <div>
            <h1>{v.name}</h1>
            <p className="profile-address">
              {v.area}, {v.region}
            </p>
          </div>
          <dl className="profile-list">
            <div>
              <dt>Status</dt>
              <dd>
                <Pill kind={statusKind}>{status}</Pill>
              </dd>
            </div>
            <div>
              <dt>Managers</dt>
              <dd>
                {managers.length
                  ? managers.map((m) => (
                      <div key={m.email}>
                        {m.name}
                        <span className="sub">
                          <CopyText text={m.email} />
                        </span>
                      </div>
                    ))
                  : "Its owner"}
              </dd>
            </div>
            <div>
              <dt>Routers</dt>
              <dd>
                {can("router.read") ? (
                  <Link className="link" href={`/venues/${v.id}/router`}>
                    {routers}
                  </Link>
                ) : (
                  <Pill kind={routersKind}>{routers}</Pill>
                )}
              </dd>
            </div>
          </dl>
          {can("venue.update") ? (
            <div className="profile-actions">
              <Button onClick={() => setEditing(true)}>Edit venue</Button>
            </div>
          ) : null}
        </div>
      </aside>
      {onboarding ? (
        <GettingStarted o={onboarding} reload={data.reload} />
      ) : (
        <>
          {t ? (
            <Figs
              items={[
                [
                  "Takings today",
                  tsh(t.todayTsh),
                  `${t.soldToday} ${t.soldToday === 1 ? "voucher" : "vouchers"}`,
                ],
                [
                  "Last 7 days",
                  tsh(t.weekTsh),
                  `${t.soldWeek} ${t.soldWeek === 1 ? "voucher" : "vouchers"}`,
                ],
              ]}
            />
          ) : null}
          {week ? (
            <Panel
              title="Sales, last 7 days"
              right={<span className="note">{tsh(week.takingsTsh)} this week</span>}
            >
              <LineChart
                values={week.series}
                axis={axisOf(week.period)}
                unit={SHOW_PER[week.period.show]}
                height={220}
                label={`Takings per day at ${v.name}, ${tsh(week.takingsTsh)} in 7 days`}
              />
            </Panel>
          ) : null}
          <VenueWay venueId={v.id} choose={can("venue.payment_way.choose")} />
          <SitesPanel venueId={v.id} venueName={v.name} />
        </>
      )}
      {editing ? (
        <VenueDialog
          venue={v}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reloadVenues();
            void data.reload();
          }}
        />
      ) : null}
    </>
  );
}
