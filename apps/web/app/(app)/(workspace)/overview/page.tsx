"use client";

import {
  ONBOARDING_PLANS,
  type OnboardingPlan,
  type OnboardingStage,
  type PaymentsReceived,
  type RouterList,
  type RouterRecord,
  type SessionList,
  type TodaySummary,
  type VenueOnboarding,
  type VenueRecord,
} from "@hashinet/types";
import Link from "next/link";
import { useState } from "react";
import { Breakdown, ReadyList, SetupRail, type Step } from "@/components/hearth/onboarding";
import { ProtectNotice } from "@/components/hearth/protect";
import { SellButton, useSell } from "@/components/hearth/sell";
import {
  Attention,
  Button,
  ButtonLink,
  CONDITION,
  Figs,
  Head,
  Panel,
  SettingRow,
  Table,
} from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { calendarDay, clock, dayName, longDate, weekday } from "@/lib/dates";
import { timeLeft } from "@/lib/duration";
import { PLAN, setupDay } from "@/lib/issues";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";
import { useCan, useSession } from "@/lib/session";
import { useSubmit } from "@/lib/submit";
import { useVenues } from "@/lib/venues";

/**
 * A business's Overview (prototype `overview`): is everything all right, what sold today, and what
 * needs the owner. Until a router serves there are no figures, so it says what happens next instead.
 */
export default function OverviewPage() {
  const { me } = useSession();
  const { shown, filter } = useVenues();
  const { sales } = useSell();
  const venueId = filter === "all" ? "" : filter;
  const today = useLoad(
    () => api.get<TodaySummary>(`/api/analytics/today${venueId ? `?venueId=${venueId}` : ""}`),
    [venueId, me.active.id, sales],
  );
  const routers = useLoad(() => api.get<RouterList>("/api/routers"), [me.active.id]);
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
  const { sales } = useSell();
  const venueQuery = venue ? `&venueId=${venue.id}` : "";
  const ending = useLoad(
    () => api.get<SessionList>(`/api/sessions?status=connected&order=ending&limit=4${venueQuery}`),
    [me.active.id, venueQuery],
  );
  const mine = useLoad(
    () => api.get<PaymentsReceived>(`/api/payments/received?by=me&day=${today.day}${venueQuery}`),
    [me.active.id, venueQuery, today.day, sales],
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

/** Where each stage stands on the owner's four steps. */
const OWNER_STEP: Record<OnboardingStage, number> = {
  choose: 0,
  confirm: 1,
  pay: 1,
  schedule: 1,
  "add-router": 2,
  "set-up": 2,
  "first-guest": 3,
  done: 3,
};

/** A venue's way online, as its owner sees it: one set of steps wherever it starts. */
function GettingStarted({ o, reload }: { o: VenueOnboarding; reload: () => Promise<void> }) {
  const { busy, run } = useSubmit();
  const [plan, setPlan] = useState<OnboardingPlan | "">(o.preference?.plan ?? "");
  const mayChoose = o.may.prefer;
  const send = async (choice: OnboardingPlan | null) => {
    const sent = await run(
      () => api.put(`/api/venues/${o.venue.id}/onboarding/preference`, { plan: choice }),
      choice
        ? `${PLAN[choice].name} sent. HashiNet's team calls you within a working day.`
        : "Asked. HashiNet's team calls you within a working day to advise.",
    );
    if (sent) await reload();
  };
  const chosen = o.preference?.plan ? PLAN[o.preference.plan] : null;
  const agreed = o.agreed;
  const steps: Step[] = [
    {
      title: "Choose how its router comes",
      todo: "A few seconds",
      done: chosen ? chosen.name : o.preference ? "You asked to talk first" : "Agreed on the call",
      body: (
        <>
          <p>
            HashiNet runs on a <b>MikroTik router</b> at {o.venue.name}. It sits behind your
            internet router, puts your WiFi behind the portal, and sells your vouchers. Tell us how
            you would like it to come; this is a preference, and nothing is charged until we agree
            it with you.
          </p>
          {mayChoose ? (
            <form
              className="form wide"
              onSubmit={(e) => {
                e.preventDefault();
                if (plan) void send(plan);
              }}
            >
              <div className="pkg-pick three" role="radiogroup" aria-label="How the router comes">
                {ONBOARDING_PLANS.map((p) => (
                  <label className="pkg" key={p}>
                    <input
                      type="radio"
                      name="pref"
                      value={p}
                      checked={plan === p}
                      onChange={() => setPlan(p)}
                    />
                    <span>
                      <b>{PLAN[p].name}</b>
                      <span className="sub">{PLAN[p].text}</span>
                      <span className="needs">You need: {PLAN[p].needs}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="actions">
                <Button kind="primary" type="submit" busy={busy} disabled={!plan}>
                  Send my choice
                </Button>
                <Button busy={busy} onClick={() => void send(null)}>
                  Talk to the team first
                </Button>
              </div>
              <p className="muted small">
                Not sure which fits? Talk to the team first; we call you and advise.
              </p>
            </form>
          ) : (
            <p className="muted">The owner chooses this.</p>
          )}
        </>
      ),
    },
    {
      title: "HashiNet's team calls you",
      todo: "Within a working day",
      done: agreed
        ? `${PLAN[agreed.plan].name}${agreed.totalTsh ? ` · ${tsh(agreed.totalTsh)}${o.paid ? " paid" : " due"}` : ""}`
        : "",
      body: (
        <>
          <p>
            We call you within a working day. We go over {o.venue.name}: how big it is, how many
            guests at peak, where the internet line comes in and where the router can go. Then we
            agree the package and what it costs, line by line, and a day for the setup.
          </p>
          {agreed ? (
            <>
              <Breakdown agreed={agreed} />
              <p>
                {o.paid
                  ? `Paid ${tsh(o.paid.amountTsh)}. We agree the setup day with you next.`
                  : agreed.totalTsh && agreed.dueOn
                    ? `${tsh(agreed.totalTsh)} is due by ${longDate(calendarDay(agreed.dueOn))}, all on one bill from HashiNet. The setup is scheduled once it is paid.`
                    : "Nothing to charge. We agree the setup day with you next."}
              </p>
            </>
          ) : (
            <p className="muted">
              {chosen
                ? `You chose ${chosen.name}: ${chosen.text} You can change your mind on the call.`
                : "You asked to talk it through first: we advise you which fits on the call."}
            </p>
          )}
        </>
      ),
    },
    {
      title: "The setup visit",
      todo: o.setupDate ? setupDay(o.setupDate) : "A day we agree",
      done: "Done",
      body: (
        <>
          <p>
            {o.setupDate ? (
              <>
                <b>{setupDay(o.setupDate)}</b>.{" "}
              </>
            ) : null}
            HashiNet&apos;s team{" "}
            {agreed?.plan === "connect"
              ? "sets up your MikroTik router"
              : "brings your MikroTik router and installs it"}{" "}
            at {o.venue.name}
            {agreed?.plan === "launch"
              ? ", with the provider's seller for the new line; you register it in the business's name there"
              : ""}
            . Be there yourself: you take the first steps with us, and sell us the first voucher,
            the hourly package. Before the day:
          </p>
          <ReadyList o={o} owner={null} />
        </>
      ),
    },
    {
      title: "Guests get online",
      todo: o.ownerProtected ? "Then you start selling" : "Once your sign-in is protected",
      done: "",
      body: o.ownerProtected ? (
        <p>Check it with your own phone, then print vouchers and start selling.</p>
      ) : (
        <p>
          Before {o.venue.name} starts serving, protect your sign-in with an authenticator app or a
          passkey, from Account and security.
        </p>
      ),
    },
  ];
  return (
    <SetupRail title={`Getting ${o.venue.name} online`} steps={steps} now={OWNER_STEP[o.stage]} />
  );
}
