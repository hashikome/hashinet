"use client";

import type { IssueDetail, OnboardingStage, VenueOnboarding } from "@hashinet/types";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Breakdown, ReadyList, SetupRail, type Step } from "@/components/platform/onboarding";
import { Button, Panel } from "@/components/ui/ui";
import { fullDay, STATE } from "@/lib/billing";
import { PLAN, setupDay } from "@/lib/issues";
import { tsh } from "@/lib/money";
import { Contact } from "./contact";
import { ChangeLink, ConfirmForm, PayButton, ScheduleForm } from "./onboarding-forms";

/** Where each stage stands on the package's rail, and on the setup's. */
const PACKAGE_STEP: Record<OnboardingStage, number> = {
  choose: 0,
  confirm: 0,
  pay: 1,
  schedule: 2,
  "add-router": 3,
  "set-up": 3,
  "first-guest": 3,
  done: 3,
};
const SETUP_STEP: Record<OnboardingStage, number> = {
  choose: 0,
  confirm: 0,
  pay: 0,
  schedule: 0,
  "add-router": 0,
  "set-up": 1,
  "first-guest": 2,
  done: 3,
};

const agreedText = (o: VenueOnboarding) =>
  o.agreed
    ? [
        PLAN[o.agreed.plan].name,
        o.agreed.totalTsh === null
          ? ""
          : o.agreed.totalTsh > 0
            ? tsh(o.agreed.totalTsh)
            : "nothing to charge",
        o.setupDate ? setupDay(o.setupDate) : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

const preferenceText = (o: VenueOnboarding) =>
  !o.preference
    ? "No preference yet"
    : o.preference.plan
      ? `Prefers ${PLAN[o.preference.plan].name}`
      : "Wants advice";

/** A venue's package: call and confirm it, get it paid, schedule the setup (ADR-0013, 2). */
export function PackageSteps({
  onboarding: o,
  detail,
  lock,
  reload,
}: {
  onboarding: VenueOnboarding;
  detail: IssueDetail;
  /** Who else is responsible, when someone is: their steps are theirs until it is taken over. */
  lock: ReactNode | null;
  reload: () => Promise<void>;
}) {
  const first = detail.contact?.name.split(" ")[0] ?? "the owner";
  const steps: Step[] = [
    {
      title: "Call and confirm the package",
      todo: preferenceText(o),
      done: agreedText(o),
      body: (
        <>
          {detail.contact ? <Contact contact={detail.contact} /> : null}
          <p>
            {preferenceText(o)}. Go over the venue with {first}: its size, how many guests at peak,
            where the internet line comes in and where the router can go, what is already there, and
            how we will help. Then record what you agreed, line by line; it all goes on the
            business&apos;s one bill.
          </p>
          {o.may.confirm ? <ConfirmForm o={o} reload={reload} /> : lock}
        </>
      ),
    },
    {
      title: "Get it paid",
      todo: o.invoice ? `${tsh(o.invoice.dueTsh)} due` : "If there is a charge",
      done: o.invoice ? `${tsh(o.invoice.totalTsh)} paid` : "Nothing to charge",
      body: (
        <>
          {o.agreed ? <Breakdown agreed={o.agreed} /> : null}
          <p>
            {o.invoice
              ? `Invoice ${o.invoice.number}, due by ${fullDay(o.invoice.dueOn)}${o.invoice.paidTsh ? `: ${tsh(o.invoice.paidTsh)} paid, ${tsh(o.invoice.dueTsh)} left` : ""}. `
              : ""}
            The setup is scheduled once it is paid.
          </p>
          {o.may.pay && o.invoice ? (
            <PayButton o={o} reload={reload} />
          ) : (
            <p className="muted">The admin or a manager records it once it arrives.</p>
          )}
          {o.may.confirm ? <ChangeLink o={o} reload={reload} /> : null}
        </>
      ),
    },
    {
      title: "Schedule the setup",
      todo: "Then it goes to whoever goes",
      done: "",
      body: (
        <>
          <p>
            {agreedText(o)}. Agree a day with {first}; the setup then goes to the team, to whoever
            goes.
          </p>
          {o.may.schedule ? <ScheduleForm o={o} goesTo={detail.goesTo} reload={reload} /> : lock}
        </>
      ),
    },
  ];
  return <SetupRail title="What to do" steps={steps} now={PACKAGE_STEP[o.stage]} />;
}

/** A venue's setup, wherever it happens: add the router, set it up, check a phone. */
export function SetupSteps({
  onboarding: o,
  detail,
  lock,
  reload,
}: {
  onboarding: VenueOnboarding;
  detail: IssueDetail;
  lock: ReactNode | null;
  reload: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    await reload();
    setChecking(false);
  };
  const model = o.agreed?.lines.find((l) => l.kind === "mikrotik_router")?.description;
  const owner = detail.contact?.name.split(" ")[0] ?? "The owner";
  const openRouter = lock ?? (
    <div className="actions">
      <Link className="btn primary" href={`/venues/${o.venue.id}/router`}>
        <span>Open router</span>
      </Link>
    </div>
  );
  const steps: Step[] = [
    {
      title: "Add the router",
      todo: model ?? "The venue's own MikroTik router",
      done: "Added; it reached HashiNet",
      body: (
        <>
          <p>
            {model
              ? `Add the ${model} for ${o.venue.name}, then run its setup script on it, at the office or on site.`
              : `Add ${o.business.name}'s own MikroTik router, then run its setup script on it.`}{" "}
            {o.setupDate ? `The setup day is ${setupDay(o.setupDate)}. ` : ""}
            This step ticks itself when the router reaches HashiNet.
            {o.agreed?.note ? ` From the call: ${o.agreed.note}` : ""}
          </p>
          {detail.contact ? <Contact contact={detail.contact} /> : null}
          {openRouter}
        </>
      ),
    },
    {
      title: "Set it up",
      todo: "From its router page",
      done: "It serves",
      body: (
        <>
          <p>
            At the venue, the ISP router goes into the MikroTik router&apos;s port 1, and any other
            WiFi routers into its other ports, as access points. Then run Set up from the router
            page; this step ticks itself once it serves.
          </p>
          {o.ownerProtected ? null : (
            <p className="muted">
              {o.business.name}&apos;s owner hasn&apos;t protected their sign-in yet, so the venue
              serves no guest until they do.
            </p>
          )}
          {openRouter}
        </>
      ),
    },
    {
      title: "Check a phone",
      todo: "Closes this issue",
      done: "",
      body: (
        <>
          <p>
            With {owner} there, as they take their first steps: buy the first voucher from them, the
            hourly package, as {o.business.name}&apos;s first customer. Join the WiFi on your phone,
            see the portal, and get online with it. The issue closes by itself within a minute of
            the first guest getting online.
          </p>
          <ReadyList o={o} owner={owner} />
          {lock ?? (
            <div className="actions">
              <Button kind="primary" busy={checking} onClick={() => void check()}>
                Check now
              </Button>
              <Link className="btn secondary" href={`/venues/${o.venue.id}/router`}>
                <span>Open router</span>
              </Link>
            </div>
          )}
        </>
      ),
    },
  ];
  return <SetupRail title="What to do" steps={steps} now={SETUP_STEP[o.stage]} />;
}

/** What was agreed for the venue, read-only: the plan, its lines, the payment and the setup day. */
export function Agreed({ onboarding: o }: { onboarding: VenueOnboarding }) {
  if (!o.agreed) return null;
  return (
    <Panel title={`Package: ${PLAN[o.agreed.plan].name}`}>
      <Breakdown agreed={o.agreed} />
      <p className="muted">
        {[
          o.agreed.totalTsh === null
            ? ""
            : o.invoice
              ? `${o.invoice.number}: ${STATE[o.invoice.state][0].toLowerCase()}${o.invoice.state === "paid" ? "" : `, ${tsh(o.invoice.dueTsh)} left`}`
              : o.agreed.totalTsh
                ? "Not invoiced yet"
                : "Nothing to charge",
          o.setupDate ? `setup ${setupDay(o.setupDate)}` : "",
          o.agreed.note ?? "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </Panel>
  );
}
