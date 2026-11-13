"use client";

import type { BusinessDetail, GuestCounts, IssueList, OnboardingStage } from "@hashinet/types";
import Link from "next/link";
import { use, useEffect } from "react";
import { BusinessMark } from "@/components/hearth/icons";
import { ButtonLink, CONDITION, CopyText, Panel, Pill, Table } from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { longDate } from "@/lib/dates";
import { issueTitle } from "@/lib/issues";
import { LoadFailed, useLoad } from "@/lib/load";
import { ROLE_NAME } from "@/lib/nav";
import { useCan, useSession } from "@/lib/session";

/** How far a venue is on its way to serving guests, before its router serves. */
const STAGE: Record<Exclude<OnboardingStage, "done">, string> = {
  choose: "Choosing how its router comes",
  confirm: "Package to agree",
  pay: "Waiting for payment",
  schedule: "Setup to schedule",
  "add-router": "Router to add",
  "set-up": "Being set up",
  "first-guest": "Waiting for its first guest",
};

/**
 * A business as HashiNet's team sees it (prototype `business`): who it is and who owns it, what
 * needs someone there, its venues on their way to serving with their guests as counts, and its
 * owners and managers. What a business does inside itself is its own (ADR-0014).
 */
export default function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useSession();
  const can = useCan();
  const data = useLoad(async () => {
    const [business, counts, issues] = await Promise.all([
      api.get<BusinessDetail>(`/api/businesses/${id}`),
      api.get<GuestCounts>("/api/guest-counts"),
      can("issue.read") ? api.get<IssueList>("/api/issues?status=open") : null,
    ]);
    return { business, counts, issues };
  }, [id, me.active.id]);
  const b = data.data?.business;
  useEffect(() => {
    if (b) document.title = `${b.name} · HashiNet`;
  }, [b]);
  const crumb = (
    <div className="crumb">
      <Link href="/businesses">Businesses</Link> /
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
  if (!data.data || !b) return crumb;
  const counts = new Map(data.data.counts.venues.map((c) => [c.venue.id, c]));
  const open = (data.data.issues?.issues ?? []).filter((i) => i.business?.id === b.id);

  return (
    <>
      {crumb}
      <aside className="profile-card">
        <div className="panel profile-body">
          <BusinessMark name={b.name} size={64} />
          <div>
            <h1>{b.name}</h1>
            <p className="profile-address">
              {b.area}, {b.region}
            </p>
            <p>Joined {longDate(b.createdAt)}</p>
          </div>
          <dl className="profile-list">
            <div>
              <dt>Owner</dt>
              <dd>
                {b.owner ? (
                  <>
                    {b.owner.name}
                    <span className="sub">
                      <CopyText text={b.owner.email} />
                      {b.owner.phone ? (
                        <>
                          {" · "}
                          <CopyText text={b.owner.phone} />
                        </>
                      ) : null}
                    </span>
                  </>
                ) : (
                  <span className="muted">Not accepted yet</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Venues</dt>
              <dd>{b.venues.length}</dd>
            </div>
          </dl>
        </div>
      </aside>
      {open.length ? (
        <Panel title={`Needs someone · ${open.length}`}>
          <Table
            cols={[["What"], ["Responsible"], [""]]}
            rows={open.map((i) => ({
              key: i.id,
              href: `/issues/${i.id}`,
              cells: [
                <div className="name" key="t">
                  {issueTitle(i)}
                </div>,
                i.holder ? (i.mine ? "You" : i.holder.name) : "Nobody yet",
                <ButtonLink key="a" href={`/issues/${i.id}`}>
                  Open issue
                </ButtonLink>,
              ],
            }))}
          />
        </Panel>
      ) : null}
      <Panel title={`Venues · ${b.venues.length}`}>
        {b.venues.length ? (
          <Table
            cols={[
              ["Venue"],
              ["Status"],
              ["Routers", true],
              ["Online now", true],
              ["Mid-session", true],
            ]}
            rows={b.venues.map((v) => {
              const [state, kind] = CONDITION[v.condition];
              const c = counts.get(v.id);
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
                  c?.onlineNow ?? 0,
                  c?.midSession ?? 0,
                ],
              };
            })}
          />
        ) : (
          <p className="muted empty">No venues yet.</p>
        )}
        <p className="muted small">
          Guests are counts here; their devices, codes and sessions are {b.name}&apos;s own.
        </p>
      </Panel>
      <Panel title="Owners and managers">
        <Table
          cols={[["Name"], ["Role"], ["Venues"]]}
          rows={b.people.map((p) => ({
            key: p.membershipId,
            cells: [
              <div key="n">
                <div className="name">{p.name}</div>
                <div className="sub">
                  <CopyText text={p.email} />
                </div>
              </div>,
              ROLE_NAME[p.role],
              p.venues.length ? (
                p.venues.join(", ")
              ) : (
                <span className="muted" key="v">
                  Every venue
                </span>
              ),
            ],
          }))}
        />
      </Panel>
    </>
  );
}
