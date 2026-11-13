"use client";

import {
  type IssueDetail,
  ONBOARDING_LINE_KINDS,
  ONBOARDING_PAID_BY,
  ONBOARDING_PLANS,
  ONBOARDING_STARTING_LINES,
  type OnboardingLineKind,
  type OnboardingPaidBy,
  type OnboardingPlan,
  type TeamList,
  type VenueOnboarding,
} from "@hashinet/types";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Breakdown, SetupRail as Rail, type Step } from "@/components/hearth/onboarding";
import { Button, Field, Panel, useToast } from "@/components/hearth/ui";
import { ApiRequestError, api, messageOf } from "@/lib/api";
import { longDate } from "@/lib/dates";
import { LINE_NAME, PAID_BY, PLAN, setupDay } from "@/lib/issues";
import { tsh } from "@/lib/money";
import { ROLE_NAME } from "@/lib/nav";
import { useCan } from "@/lib/session";
import { Contact } from "./contact";

const agreedText = (o: VenueOnboarding) =>
  o.agreed
    ? [
        PLAN[o.agreed.plan].name,
        o.agreed.totalTsh > 0 ? tsh(o.agreed.totalTsh) : "nothing to charge",
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
  team,
  lock,
  reload,
}: {
  onboarding: VenueOnboarding;
  detail: IssueDetail;
  team: TeamList | null;
  lock: ReactNode;
  reload: () => Promise<void>;
}) {
  const can = useCan();
  const manage = can("onboarding.manage");
  const now = o.stage === "pay" ? 1 : o.stage === "schedule" ? 2 : 0;
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
          {manage ? <ConfirmForm o={o} reload={reload} /> : null}
        </>
      ),
    },
    {
      title: "Get it paid",
      anyone: true,
      todo: o.agreed?.totalTsh ? `${tsh(o.agreed.totalTsh)} due` : "If there is a charge",
      done: o.paid ? `${tsh(o.paid.amountTsh)} paid` : "Nothing to charge",
      body: (
        <>
          {o.agreed ? <Breakdown agreed={o.agreed} /> : null}
          <p>
            {o.agreed?.dueOn
              ? `Due by ${longDate(`${o.agreed.dueOn}T12:00:00+03:00`)}, in full. `
              : ""}
            The setup is scheduled once it is paid.
          </p>
          {manage ? (
            <PaymentForm o={o} reload={reload} />
          ) : (
            <p className="muted">The admin or a manager records it once it arrives.</p>
          )}
          {o.changeable && !lock && manage ? <ChangeLink o={o} reload={reload} /> : null}
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
          {manage ? <ScheduleForm o={o} team={team} reload={reload} /> : null}
        </>
      ),
    },
  ];
  return <Rail steps={steps} now={now} lock={lock} />;
}

/** A venue's setup, wherever it happens: add the router, set it up, check a phone. */
export function SetupSteps({
  onboarding: o,
  detail,
  lock,
}: {
  onboarding: VenueOnboarding;
  detail: IssueDetail;
  lock: ReactNode;
}) {
  const now = o.stage === "add-router" ? 0 : o.stage === "set-up" ? 1 : 2;
  const router = `/venues/${o.venue.id}/router`;
  const model = o.agreed?.lines.find((l) => l.kind === "mikrotik_router")?.description;
  const open = (label: string) => (
    <div className="actions">
      <Link className="btn primary" href={router}>
        <span>{label}</span>
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
          {open("Open router")}
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
          {open("Open router")}
        </>
      ),
    },
    {
      title: "Check a phone",
      todo: "Closes this issue",
      done: "",
      body: (
        <p>
          Join the WiFi on a phone, see {o.business.name}&apos;s portal, and get online with a
          voucher. The issue closes when the first guest is online.
        </p>
      ),
    },
  ];
  return <Rail steps={steps} now={now} lock={lock} />;
}

/** Errors the API names per field, as sentences beside them. */
function useErrors() {
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fail = (e: unknown) => {
    if (e instanceof ApiRequestError && e.details) setErrors(e.details);
    else toast(messageOf(e));
  };
  return { errors, setErrors, fail };
}

interface Draft {
  kind: OnboardingLineKind;
  description: string;
  amount: string;
}
const draftOf = (kinds: OnboardingLineKind[], keep: Draft[] = []): Draft[] =>
  kinds.map((kind) => keep.find((d) => d.kind === kind) ?? { kind, description: "", amount: "" });

function ConfirmForm({ o, reload }: { o: VenueOnboarding; reload: () => Promise<void> }) {
  const toast = useToast();
  const { errors, setErrors, fail } = useErrors();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<OnboardingPlan>(
    o.agreed?.plan ?? o.preference?.plan ?? "install",
  );
  const [lines, setLines] = useState<Draft[]>(
    o.agreed
      ? o.agreed.lines.map((l) => ({
          kind: l.kind,
          description: l.description ?? "",
          amount: String(l.amountTsh),
        }))
      : draftOf(ONBOARDING_STARTING_LINES[plan]),
  );
  const [note, setNote] = useState(o.agreed?.note ?? "");
  const total = lines.reduce((n, l) => n + (Number(l.amount) || 0), 0);
  const set = (n: number, patch: Partial<Draft>) =>
    setLines((all) => all.map((l, i) => (i === n ? { ...l, ...patch } : l)));
  return (
    <form
      className="form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        // An empty amount is a question left open, not "free": the form asks for 0.
        const blank = lines.findIndex((l) => l.amount.trim() === "");
        if (blank >= 0) {
          setErrors({ [`lines.${blank}.amountTsh`]: "is required: enter 0 if it is free" });
          return;
        }
        setBusy(true);
        setErrors({});
        try {
          await api.post(`/api/venues/${o.venue.id}/onboarding/confirm`, {
            plan,
            lines: lines.map((l) => ({
              kind: l.kind,
              description: l.description.trim() || null,
              amountTsh: Number(l.amount),
            })),
            note: note.trim() || null,
          });
          await reload();
          toast(`${PLAN[plan].name} confirmed: ${total ? tsh(total) : "nothing to charge"}.`);
        } catch (err) {
          fail(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="pkg-pick" role="radiogroup" aria-label="Package">
        {ONBOARDING_PLANS.map((p) => (
          <label className="pkg" key={p}>
            <input
              type="radio"
              name="plan"
              value={p}
              checked={plan === p}
              onChange={() => {
                setPlan(p);
                setLines((all) => draftOf(ONBOARDING_STARTING_LINES[p], all));
              }}
            />
            <span>
              <b>{PLAN[p].name}</b>
              <span className="sub">{PLAN[p].text}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="lines">
        {lines.map((l, n) => {
          const err = (k: string) => errors[`lines.${n}.${k}`];
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are edited in place
            <div className="line" key={n}>
              {l.kind === "onboarding_fee" ? (
                // Every package has its one onboarding fee: it stays, and stays a fee.
                <div className="field">
                  <span className="lbl">What</span>
                  <div className="line-fixed">{LINE_NAME.onboarding_fee}</div>
                </div>
              ) : (
                <Field label="What" id={`lk${n}`}>
                  <select
                    id={`lk${n}`}
                    className="input"
                    value={l.kind}
                    onChange={(e) => set(n, { kind: e.target.value as OnboardingLineKind })}
                  >
                    {ONBOARDING_LINE_KINDS.filter((k) => k !== "onboarding_fee").map((k) => (
                      <option key={k} value={k}>
                        {LINE_NAME[k]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field
                label="Details"
                id={`ld${n}`}
                error={err("description") ? `The details ${err("description")}.` : undefined}
                hint={
                  l.kind === "mikrotik_router"
                    ? "The model that fits the venue"
                    : l.kind === "onboarding_fee"
                      ? "What it covers, such as travel and a day's work"
                      : "Optional"
                }
              >
                <input
                  id={`ld${n}`}
                  className="input"
                  maxLength={160}
                  value={l.description}
                  onChange={(e) => set(n, { description: e.target.value })}
                />
              </Field>
              <Field
                label="Amount (TSh)"
                id={`la${n}`}
                error={err("amountTsh") ? `The amount ${err("amountTsh")}.` : undefined}
              >
                <input
                  id={`la${n}`}
                  className="input num"
                  inputMode="numeric"
                  value={l.amount}
                  onChange={(e) => set(n, { amount: e.target.value.replace(/\D/g, "") })}
                />
              </Field>
              {l.kind !== "onboarding_fee" ? (
                <Button
                  className="ghost line-remove"
                  aria-label={`Remove ${LINE_NAME[l.kind]}`}
                  onClick={() => setLines((all) => all.filter((_, i) => i !== n))}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          );
        })}
        {errors.lines ? <div className="hint danger">The package {errors.lines}.</div> : null}
        <div className="line-total">
          <Button
            onClick={() =>
              setLines((all) => [...all, { kind: "other", description: "", amount: "" }])
            }
          >
            Add a line
          </Button>
          <span>
            Total <b className="num">{tsh(total)}</b>
          </span>
        </div>
      </div>
      <Field
        label="Notes from the call"
        id="pn"
        hint="Optional: the venue, the guests at peak, where the line comes in"
      >
        <textarea
          id="pn"
          className="input"
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="actions">
        <Button kind="primary" type="submit" busy={busy}>
          Confirm package
        </Button>
      </div>
    </form>
  );
}

function PaymentForm({ o, reload }: { o: VenueOnboarding; reload: () => Promise<void> }) {
  const toast = useToast();
  const { errors, fail } = useErrors();
  const [busy, setBusy] = useState(false);
  const [by, setBy] = useState<OnboardingPaidBy>("mobile_money");
  const [amount, setAmount] = useState(String(o.agreed?.totalTsh ?? ""));
  return (
    <form
      className="form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api.post(`/api/venues/${o.venue.id}/onboarding/payment`, {
            amountTsh: Number(amount),
            by,
          });
          await reload();
          toast(`${tsh(Number(amount))} recorded. Schedule the setup next.`);
        } catch (err) {
          fail(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="row-fields">
        <Field
          label="Amount received (TSh)"
          id="pa"
          error={errors.amountTsh ? `The amount ${errors.amountTsh}.` : undefined}
        >
          <input
            id="pa"
            className="input num"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Field label="How it came" id="pb">
          <select
            id="pb"
            className="input"
            value={by}
            onChange={(e) => setBy(e.target.value as OnboardingPaidBy)}
          >
            {ONBOARDING_PAID_BY.map((p) => (
              <option key={p} value={p}>
                {PAID_BY[p]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="actions">
        <Button kind="primary" type="submit" busy={busy}>
          Record payment
        </Button>
      </div>
    </form>
  );
}

/** Reopens the package form while nothing is paid. */
function ChangeLink({ o, reload }: { o: VenueOnboarding; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div>
        <button className="link" type="button" onClick={() => setOpen(true)}>
          Change the package
        </button>
      </div>
    );
  }
  return <ConfirmForm o={o} reload={reload} />;
}

function ScheduleForm({
  o,
  team,
  reload,
}: {
  o: VenueOnboarding;
  team: TeamList | null;
  reload: () => Promise<void>;
}) {
  const toast = useToast();
  const { errors, fail } = useErrors();
  const [busy, setBusy] = useState(false);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(
    new Date(),
  );
  const [date, setDate] = useState(o.setupDate ?? "");
  const [goes, setGoes] = useState("");
  return (
    <form
      className="form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api.post(`/api/venues/${o.venue.id}/onboarding/schedule`, {
            date,
            goesId: goes || null,
          });
          toast(`Setup scheduled for ${setupDay(date)}. It is in Issues for the team.`);
          await reload();
        } catch (err) {
          fail(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="row-fields">
        <Field
          label="Setup date"
          id="sd"
          error={errors.date ? `The date ${errors.date}.` : undefined}
        >
          <input
            id="sd"
            className="input"
            type="date"
            min={today}
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Who goes" id="sw" hint="They see the setup in their Issues">
          <select id="sw" className="input" value={goes} onChange={(e) => setGoes(e.target.value)}>
            <option value="">Anyone on the team</option>
            {(team?.members ?? []).map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.name}, {ROLE_NAME[m.role].toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="actions">
        <Button kind="primary" type="submit" busy={busy} disabled={!date}>
          Schedule setup
        </Button>
      </div>
    </form>
  );
}

/** What was agreed for the venue, read-only: the plan, its lines, the payment and the setup day. */
export function Agreed({ onboarding: o }: { onboarding: VenueOnboarding }) {
  const can = useCan();
  if (!o.agreed) return null;
  // What it cost is for the admin and managers; the technician who goes sees what to bring.
  const money = can("onboarding.manage");
  return (
    <Panel title={`Package: ${PLAN[o.agreed.plan].name}`}>
      <Breakdown agreed={o.agreed} money={money} />
      <p className="muted">
        {[
          !money
            ? ""
            : o.paid
              ? `${tsh(o.paid.amountTsh)} paid by ${PAID_BY[o.paid.by].toLowerCase()}`
              : o.agreed.totalTsh
                ? "Not paid yet"
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
