"use client";

import type { RouterList, RouterRecord, TodaySummary } from "@hashinet/types";
import { ProtectNotice } from "@/components/hearth/protect";
import {
  Attention,
  ButtonLink,
  CONDITION,
  Figs,
  Head,
  Panel,
  SettingRow,
  Table,
} from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { clock, dayName, weekday } from "@/lib/dates";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";
import { useCan, useSession } from "@/lib/session";
import { useVenues } from "@/lib/venues";

/**
 * A business's Overview (prototype `overview`): is everything all right, what sold today, and what
 * needs the owner. Until a router serves there are no figures, so it says what happens next instead.
 */
export default function OverviewPage() {
  const { me } = useSession();
  const can = useCan();
  const { shown, filter } = useVenues();
  const venueId = filter === "all" ? "" : filter;
  const today = useLoad(
    () => api.get<TodaySummary>(`/api/analytics/today${venueId ? `?venueId=${venueId}` : ""}`),
    [venueId, me.active.id],
  );
  const routers = useLoad(() => api.get<RouterList>("/api/routers"), [me.active.id]);
  const one = shown.length === 1 ? shown[0] : null;
  const inView = (routers.data?.routers ?? []).filter((r) => shown.some((v) => v.id === r.venueId));
  const serving = inView.filter((r) => r.condition !== "setting-up");
  const mayPrint = can("voucher.print");
  const sub = `${one ? `${one.name} · ` : ""}${dayName(new Date())}${today.at ? ` · updated ${clock(today.at)}` : ""}`;

  if (today.error || routers.error) {
    return (
      <>
        <Head title="Overview" sub={sub} />
        <LoadFailed
          error={today.error ?? routers.error ?? ""}
          retry={() => {
            void today.reload();
            void routers.reload();
          }}
        />
      </>
    );
  }
  if (!today.data || !routers.data) return <Head title="Overview" sub={sub} />;

  if (serving.length === 0) return <SettingUp sub={sub} />;

  const t = today.data;
  const offline = inView.filter(
    (r) => r.condition === "offline" || r.condition === "needs-attention",
  );
  const routerFact: [string, string, string] =
    inView.length === 1 && inView[0]
      ? ["Router", CONDITION[inView[0].condition][0], routerDetail(inView[0])]
      : [
          "Routers serving",
          String(inView.filter((r) => r.condition === "serving").length),
          offline.length === 0
            ? "all serving"
            : offline.length === 1
              ? `${offline[0]?.name} is offline`
              : `${offline.length} offline`,
        ];
  return (
    <>
      <Head
        title="Overview"
        sub={sub}
        actions={
          mayPrint ? (
            <ButtonLink href="/vouchers/print" kind="primary">
              Print vouchers
            </ButtonLink>
          ) : null
        }
      />
      <ProtectNotice />
      {offline.map((r) => (
        <Attention
          key={r.id}
          bad
          title={`${r.venueName}'s router is offline`}
          action={<ButtonLink href={`/venues/${r.venueId}/router`}>Open router</ButtonLink>}
        >
          {r.lastSeenAt
            ? `Last heard from ${dayName(r.lastSeenAt)} at ${clock(r.lastSeenAt)}.`
            : "It has not reached HashiNet yet."}{" "}
          Guests can&apos;t get online there until it is back; their time keeps counting once it
          reconnects.
        </Attention>
      ))}
      <Figs
        items={[
          ["Online now", String(t.onlineNow), "devices on the WiFi"],
          [
            "Takings today",
            tsh(t.takingsTsh),
            `${tsh(t.lastWeekTakingsTsh)} by now last ${weekday(new Date(Date.now() - 7 * 86_400_000))}`,
          ],
          ["Vouchers sold today", String(t.sold), "printed and sold here"],
          routerFact,
        ]}
      />
      <Panel title="Sold today">
        {t.byPackage.length ? (
          <Table
            cols={[["Package"], ["Sold", true], ["Takings", true]]}
            rows={t.byPackage.map((p) => ({
              key: p.packageId ?? "none",
              cells: [p.name ?? "A package since removed", p.sold, tsh(p.takingsTsh)],
            }))}
            total={["Today", t.sold, tsh(t.takingsTsh)]}
          />
        ) : (
          <p className="muted empty">
            Nothing sold yet today. A voucher counts once a guest uses it, or when it is sold here.
          </p>
        )}
      </Panel>
    </>
  );
}

const routerDetail = (r: RouterRecord) =>
  [r.model, r.rosVersion ? `RouterOS ${r.rosVersion}` : null].filter(Boolean).join(" · ") || r.name;

/**
 * Before any router serves: HashiNet's team sets the router up (slice 1 has no self-service setup),
 * and the owner gets ready meanwhile. No figures yet, so none are shown.
 */
function SettingUp({ sub }: { sub: string }) {
  const { me } = useSession();
  const can = useCan();
  const first = me.name.split(/\s+/)[0] ?? me.name;
  return (
    <>
      <Head title={`Karibu, ${first}`} sub={sub} />
      <ProtectNotice />
      <Panel title="HashiNet's team is setting up your router">
        <p className="muted">
          Once it is installed and serving, guests join your WiFi, see your portal and get online
          with your vouchers. This page then shows who is online and what sold today.
        </p>
      </Panel>
      <Panel title="Get ready meanwhile">
        <ul className="rows">
          {can("package.read") ? (
            <SettingRow
              title="Packages"
              sub="What guests buy: time, devices and price"
              action={<ButtonLink href="/packages">Review</ButtonLink>}
            />
          ) : null}
          <SettingRow
            title="Account and security"
            sub="Your name, how you sign in, and how HashiNet looks"
            action={<ButtonLink href="/account">Open</ButtonLink>}
          />
        </ul>
      </Panel>
    </>
  );
}
