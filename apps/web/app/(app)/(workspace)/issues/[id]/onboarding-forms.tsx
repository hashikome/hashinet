"use client";

import {
  type IssueDetail,
  ONBOARDING_LINE_DESCRIBED,
  ONBOARDING_LINE_KINDS,
  ONBOARDING_PLANS,
  ONBOARDING_STARTING_LINES,
  type OnboardingLineKind,
  type OnboardingPlan,
  type VenueOnboarding,
} from "@hashinet/types";
import { useState } from "react";
import { RecordPayment } from "@/components/platform/record-payment";
import { Button, Field } from "@/components/ui/ui";
import { api } from "@/lib/api";
import { todayIso } from "@/lib/dates";
import { LINE_NAME, PLAN, setupDay } from "@/lib/issues";
import { tsh } from "@/lib/money";
import { ROLE_NAME } from "@/lib/nav";
import { useSubmit } from "@/lib/submit";

interface Draft {
  kind: OnboardingLineKind;
  description: string;
  amount: string;
}

/** What each line's Details asks for; whether it is required is the shared rule. */
const DETAILS_HINT: Record<OnboardingLineKind, string> = {
  onboarding_fee: "What it covers, such as travel and a day's work",
  mikrotik_router: "The model that fits the venue",
  isp_router: "Its model",
  internet_line: "Its speed",
  other: "Say what it is",
};

const draftOf = (kinds: OnboardingLineKind[], keep: Draft[]): Draft[] =>
  kinds.map((kind) => keep.find((d) => d.kind === kind) ?? { kind, description: "", amount: "" });

export function ConfirmForm({ o, reload }: { o: VenueOnboarding; reload: () => Promise<void> }) {
  const { busy, errors, setErrors, run } = useSubmit();
  const [plan, setPlan] = useState<OnboardingPlan>(
    o.agreed?.plan ?? o.preference?.plan ?? "install",
  );
  const [lines, setLines] = useState<Draft[]>(
    o.agreed
      ? o.agreed.lines.map((l) => ({
          kind: l.kind,
          description: l.description ?? "",
          amount: l.amountTsh === null ? "" : String(l.amountTsh),
        }))
      : draftOf(ONBOARDING_STARTING_LINES[plan], []),
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
        const sent = await run(
          () =>
            api.post(`/api/venues/${o.venue.id}/onboarding/confirm`, {
              plan,
              lines: lines.map((l) => ({
                kind: l.kind,
                description: l.description.trim() || null,
                amountTsh: Number(l.amount),
              })),
              note: note.trim() || null,
            }),
          `${PLAN[plan].name} confirmed: ${total ? tsh(total) : "nothing to charge"}.`,
        );
        if (sent) await reload();
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
                label={
                  ONBOARDING_LINE_DESCRIBED.includes(l.kind) ? "Details" : "Details (optional)"
                }
                id={`ld${n}`}
                error={err("description") ? `The details ${err("description")}.` : undefined}
                hint={DETAILS_HINT[l.kind]}
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
        label="Notes from the call (optional)"
        id="pn"
        hint="The venue, the guests at peak, where the line comes in"
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

/** Records what came in on the package's invoice, in the shared dialog. */
export function PayButton({ o, reload }: { o: VenueOnboarding; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const invoice = o.invoice;
  if (!invoice) return null;
  return (
    <>
      <div className="actions">
        <Button kind="primary" onClick={() => setOpen(true)}>
          Record payment
        </Button>
      </div>
      {open ? (
        <RecordPayment
          businessId={o.business.id}
          invoiceId={invoice.id}
          owedTsh={invoice.dueTsh}
          says={`${o.business.name} owes ${tsh(invoice.dueTsh)} for ${o.business.name === o.venue.name ? "its" : `${o.venue.name}'s`} onboarding, invoice ${invoice.number}. The setup is scheduled once it is paid.`}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            void reload();
          }}
        />
      ) : null}
    </>
  );
}

/** Reopens the package form while nothing is paid. */
export function ChangeLink({ o, reload }: { o: VenueOnboarding; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (open) return <ConfirmForm o={o} reload={reload} />;
  return (
    <div>
      <button className="link" type="button" onClick={() => setOpen(true)}>
        Change the package
      </button>
    </div>
  );
}

export function ScheduleForm({
  o,
  goesTo,
  reload,
}: {
  o: VenueOnboarding;
  goesTo: IssueDetail["goesTo"];
  reload: () => Promise<void>;
}) {
  const { busy, errors, run } = useSubmit();
  const [date, setDate] = useState(o.setupDate ?? "");
  const [goes, setGoes] = useState("");
  return (
    <form
      className="form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const sent = await run(
          () =>
            api.post(`/api/venues/${o.venue.id}/onboarding/schedule`, {
              date,
              goesId: goes || null,
            }),
          `Setup scheduled for ${setupDay(date)}. It is in Issues for the team.`,
        );
        if (sent) await reload();
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
            min={todayIso()}
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Who goes" id="sw" hint="They see the setup in their Issues">
          <select id="sw" className="input" value={goes} onChange={(e) => setGoes(e.target.value)}>
            <option value="">Anyone on the team</option>
            {goesTo.map((m) => (
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
