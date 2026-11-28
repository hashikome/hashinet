"use client";

import type {
  PaymentsReceived,
  RouterList,
  RouterRecord,
  SessionList,
  TodaySummary,
  VenueOnboarding,
  VenueRecord,
} from "@hashinet/types";
import Link from "next/link";
import { ProtectNotice } from "@/components/people/protect";
import { GettingStarted } from "@/components/platform/onboarding";
import { SellButton } from "@/components/sales/sell";
import {
  Attention,
  ButtonLink,
  CONDITION,
  DOWN,
  Figs,
  Head,
  Panel,
  SettingRow,
  Table,
} from "@/components/ui/ui";
import { api } from "@/lib/api";
import { clock, dayName, weekday } from "@/lib/dates";
import { timeLeft } from "@/lib/duration";
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
  const { shown, filter } = useVenues();
  const venueId = filter === "all" ? "" : filter;
  const today = useLoad(
    "today",
    () => api.get<TodaySummary>(`/api/analytics/today${venueId ? `?venueId=${venueId}` : ""}`),
    [venueId, me.active.id],
  );
  const routers = useLoad("routers", () => api.get<RouterList>("/api/routers"), [me.active.id]);
  const one = shown.length === 1 ? shown[0] : null;
  const inView = (routers.data?.routers ?? []).filter((r) => shown.some((v) => v.id === r.venueId));
  const serving = inView.filter((r) => r.condition !== "setting-up");
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
  if (me.active.role === "venue_operator") {
    return <OperatorToday today={today.data} routers={inView} sub={sub} venue={one} />;
  }

  const t = today.data;
  const offline = inView.filter((r) => r.condition !== "serving" && r.condition !== "setting-up");
  const routerFact: [string, string, string] =
    inView.length === 1 && inView[0]
      ? ["Router", CONDITION[inView[0].condition][0], routerDetail(inView[0])]
      : [
          "Routers serving",
          String(inView.filter((r) => r.condition === "serving").length),
          offline.length === 0
            ? "all serving"
            : offline.length === 1 && offline[0]
              ? `${offline[0].name} ${DOWN[offline[0].condition]}`
              : `${offline.length} not serving`,
        ];
  return (
    <>
      <Head title="Overview" sub={sub} actions={<SellButton />} />
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
          ["Vouchers sold today", String(t.sold), "at the counter and online"],
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
          <p className="muted empty">Nothing sold yet today. Each sale counts as it is made.</p>
        )}
      </Panel>
    </>
  );
}

/**
 * An operator's day at their venue (prototype `operatorToday`): who is online and whose time ends
 * soon, what they sold, and the cash they hand over: their cash sales less the cash they gave back.
 */
function OperatorToday({
  today,
  routers,
  sub,
  venue,
}: {
  today: TodaySummary;
  routers: RouterRecord[];
  sub: string;
  venue: VenueRecord | null;
}) {
  const { me } = useSession();
  const venueQuery = venue ? `&venueId=${venue.id}` : "";
  const ending = useLoad(
    "ending-soon",
    () => api.get<SessionList>(`/api/sessions?status=connected&order=ending&limit=4${venueQuery}`),
    [me.active.id, venueQuery],
  );
  const mine = useLoad(
    "my-sales",
    () => api.get<PaymentsReceived>(`/api/payments/received?by=me&day=${today.day}${venueQuery}`),
    [me.active.id, venueQuery, today.day],
  );
  const router = routers[0];
  return (
    <>
      <Head title={`${venue?.name ?? "Your venues"} today`} sub={sub} actions={<SellButton />} />
      <Figs
        items={[
          ["Online now", String(today.onlineNow), "devices"],
          ["Sold today", String(today.sold), "vouchers"],
          ["Cash today", tsh(today.yourCashTsh), "to hand over"],
          router
            ? ["Router", CONDITION[router.condition][0], routerDetail(router)]
            : ["Router", "Not set up", ""],
        ]}
      />
      <div className="two">
        <Panel
          title="Ending soon"
          right={
            ending.data && ending.data.stats.connected > 0 ? (
              <Link className="link" href="/sessions">
                All {ending.data.stats.connected}
              </Link>
            ) : null
          }
        >
          {ending.data?.sessions.length ? (
            <ul className="rows">
              {ending.data.sessions.map((s) => (
                <li key={s.id}>
                  <div>
                    <b>{s.deviceName ?? s.macAddress}</b>
                    <span className="sub">
                      {s.packageName ?? "A package since removed"} · since {clock(s.startedAt)}
                    </span>
                  </div>
                  <span className="num">{timeLeft(s.voucherExpiresAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted empty">Nobody is online right now.</p>
          )}
        </Panel>
        <Panel
          title="Your sales today"
          right={
            <Link className="link" href="/vouchers">
              Vouchers
            </Link>
          }
        >
          {mine.data?.payments.length ? (
            <Table
              cols={[["Package"], ["Paid by"], ["When"], ["Price", true]]}
              rows={mine.data.payments.map((p) => ({
                key: p.id,
                cells: [
                  p.packageName ?? "A package since removed",
                  p.source === "mobile_money" ? "Mobile money" : "Cash",
                  clock(p.occurredAt),
                  tsh(p.amountTsh),
                ],
              }))}
              total={["Cash to hand over", "", "", tsh(today.yourCashTsh)]}
            />
          ) : (
            <p className="muted empty">Nothing sold yet today. Tap Sell for the first guest.</p>
          )}
        </Panel>
      </div>
    </>
  );
}

const routerDetail = (r: RouterRecord) =>
  [r.model, r.rosVersion ? `RouterOS ${r.rosVersion}` : null].filter(Boolean).join(" · ") || r.name;

/**
 * Before any router serves (prototype `ownerSettingUp`): the steps to guests getting online, the
 * current one open beside them, and what the owner can get ready meanwhile. No figures yet.
 */
function SettingUp({ sub }: { sub: string }) {
  const { me } = useSession();
  const can = useCan();
  const { shown } = useVenues();
  const first = me.name.split(/\s+/)[0] ?? me.name;
  const venue = shown[0];
  const onboarding = useLoad(
    "onboarding",
    () =>
      venue && can("onboarding.read")
        ? api.get<VenueOnboarding>(`/api/venues/${venue.id}/onboarding`)
        : Promise.resolve(null),
    [venue?.id, me.active.id],
  );
  return (
    <>
      <Head
        title={`Karibu, ${first}`}
        sub={venue ? `${venue.name} is created. Four steps and your guests are online.` : sub}
      />
      <ProtectNotice />
      {onboarding.error ? <LoadFailed error={onboarding.error} retry={onboarding.reload} /> : null}
      {onboarding.data ? <GettingStarted o={onboarding.data} reload={onboarding.reload} /> : null}
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
