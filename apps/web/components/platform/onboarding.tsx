"use client";

import {
  ONBOARDING_PLANS,
  type OnboardingPlan,
  type OnboardingStage,
  type VenueOnboarding,
} from "@hashinet/types";
import { type ReactNode, useState } from "react";
import { api } from "@/lib/api";
import { fullDay } from "@/lib/billing";
import { LINE_NAME, PLAN, setupDay } from "@/lib/issues";
import { tsh } from "@/lib/money";
import { useSubmit } from "@/lib/submit";
import { Button, Panel } from "../ui/ui";

/* A venue's way to serving guests, as the team and the owner both see it (prototype `.setup`). */

export interface Step {
  title: string;
  /** Under the title on the rail: what it waits for, or how it went. */
  todo: string;
  done: string;
  body: ReactNode;
}

/** The steps down a rail, the current one open beside it (prototype `.setup`). */
export function SetupRail({ steps, now, title }: { steps: Step[]; now: number; title: string }) {
  const step = steps[now];
  return (
    <Panel title={title}>
      <div className="setup">
        <ol className="todo checklist setup-rail">
          {steps.map((s, n) => (
            <li
              key={s.title}
              className={n < now ? "done" : n === now ? "now" : ""}
              aria-current={n === now ? "step" : undefined}
            >
              <div>
                <h3>{s.title}</h3>
                <div className="sub">{n < now ? s.done : s.todo}</div>
              </div>
            </li>
          ))}
        </ol>
        {step ? (
          <div className="setup-now">
            <h3>{step.title}</h3>
            {step.body}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * What the package is, line by line, with what each costs and the total when the reader sees
 * money (HashiNet's operators see what to bring, not its price).
 */
export function Breakdown({ agreed }: { agreed: NonNullable<VenueOnboarding["agreed"]> }) {
  const total = agreed.totalTsh;
  return (
    <table className="lines-table">
      <tbody>
        {agreed.lines.map((l, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are in their agreed order
          <tr key={n}>
            <td>
              {LINE_NAME[l.kind]}
              {l.description ? <span className="sub">{l.description}</span> : null}
            </td>
            {l.amountTsh === null ? null : (
              <td className="r num">{l.amountTsh ? tsh(l.amountTsh) : "Free"}</td>
            )}
          </tr>
        ))}
      </tbody>
      {total === null ? null : (
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="r num">{tsh(total)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/**
 * What the owner gets ready before the first guest (ADR-0013, 2): their protected sign-in and a
 * package on sale. The first guest is HashiNet's team, buying the first voucher from them.
 */
export function ReadyList({ o, owner }: { o: VenueOnboarding; owner: string | null }) {
  // Said to the owner themselves (null), or to HashiNet's team about them.
  const todo = (yours: string, theirs: string) => (owner ? `${owner} ${theirs}` : yours);
  const items: [boolean, string, string][] = [
    [
      o.ownerProtected,
      "Sign-in protected",
      todo(
        "Protect your sign-in, in Account and security",
        "protects their sign-in, in Account and security",
      ),
    ],
    [
      o.ready.packagesOnSale > 0,
      `${o.ready.packagesOnSale} ${o.ready.packagesOnSale === 1 ? "package" : "packages"} on sale`,
      todo("Put a package on sale, in Packages", "puts a package on sale, in Packages"),
    ],
  ];
  return (
    <ul className="ready">
      {items.map(([done, yes, todo]) => (
        <li key={todo} className={done ? "done" : ""}>
          <span className="sr-only">{done ? "Done: " : "Still to do: "}</span>
          {done ? yes : todo}
        </li>
      ))}
    </ul>
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
export function GettingStarted({ o, reload }: { o: VenueOnboarding; reload: () => Promise<void> }) {
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
        ? `${PLAN[agreed.plan].name}${agreed.totalTsh ? ` · ${tsh(agreed.totalTsh)}${o.invoice?.state === "paid" ? " paid" : " due"}` : ""}`
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
                {o.invoice?.state === "paid"
                  ? `Paid ${tsh(o.invoice.totalTsh)}. We agree the setup day with you next.`
                  : o.invoice
                    ? `${tsh(o.invoice.dueTsh)} is due by ${fullDay(o.invoice.dueOn)}, on invoice ${o.invoice.number}, all on one bill from HashiNet. The setup is scheduled once it is paid.`
                    : agreed.totalTsh
                      ? "Its invoice is on its way by email."
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
