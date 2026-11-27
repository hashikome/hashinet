"use client";

import type {
  ServiceAccess,
  ServiceAccessDetail,
  ServiceAccessReason,
  ServiceAccessState,
} from "@hashinet/types";
import { useState } from "react";
import { api } from "@/lib/api";
import { fullDay as day } from "@/lib/billing";
import { calendarDay, shortDate, when } from "@/lib/dates";
import { tsh } from "@/lib/money";
import { useCan } from "@/lib/session";
import { useSubmit } from "@/lib/submit";
import { Dialog } from "./dialog";
import { Attention, Button, Field, Panel, Pill, type PillKind, Table } from "./ui";

const ACCESS: Record<ServiceAccess, [string, PillKind]> = {
  enabled: ["Enabled", "ok"],
  grace_period: ["Grace period", "wait"],
  read_only: ["Read-only", "bad"],
  suspended: ["Suspended", "bad"],
};

/** What each state means, as HashiNet's team reads it (ADR-0014, 2). */
const MEANS: Record<ServiceAccess, string> = {
  enabled: "",
  grace_period: "Everything works; its owner and managers have an issue about it.",
  read_only:
    "It can sign in and look, but sells no new vouchers. Vouchers already sold keep working.",
  suspended: "Its portal takes no new vouchers; devices online keep their time until it ends.",
};

const REASON: Record<ServiceAccessReason, string> = {
  payment_overdue: "Payment overdue",
  payment_received: "Payment received",
  payment_arranged: "Payment arranged",
  policy_violation: "Policy violation",
  customer_request: "Customer request",
  contract_ended: "Contract ended",
  issue_resolved: "Issue resolved",
  other: "Other",
};

/** How its access came to be: by its bills, with the figures, or set by hand and why. */
function accessWhy(a: ServiceAccessDetail): string {
  if (a.held) {
    const last = a.changes.find((c) => c.held);
    const until = a.heldUntil ? `, until ${day(a.heldUntil)}` : "";
    return `Set by hand${last ? `: ${REASON[last.reason].toLowerCase()}` : ""}${until}. ${MEANS[a.access]}`.trim();
  }
  if (a.access === "enabled" || a.overdueSince === null) return "By its bills: nothing is overdue.";
  // A reader who doesn't see money (a platform operator) reads the date alone.
  const owed = `${a.overdueTsh === null ? "Overdue" : `${tsh(a.overdueTsh)} overdue`} since ${day(a.overdueSince)}`;
  if (a.access === "read_only") {
    return `By its bills: ${owed}, and it was late before. Paying restores it. ${MEANS.read_only}`;
  }
  return a.lateBefore && a.pausesOn
    ? `By its bills: ${owed}. It goes read-only on ${day(a.pausesOn)}, as it was late before.`
    : `By its bills: ${owed}. Its first late bill, so it stays in its grace period until it pays. Call the owner.`;
}

/** The fact on its card: the state, and whether its bills or a hold set it. */
export function AccessFact({ access }: { access: ServiceAccessState }) {
  const [name, kind] = ACCESS[access.access];
  return (
    <div>
      <dt>Service access</dt>
      <dd>
        <Pill kind={kind}>{name}</Pill>
        <span className="sub">
          {access.held
            ? `Set by hand${access.heldUntil ? ` until ${day(access.heldUntil)}` : ""}`
            : "By its bills"}
        </span>
      </dd>
    </div>
  );
}

/**
 * A business's Service access for HashiNet's team (prototype `business`): why it is as it is, each
 * change with who made it, and Change service access.
 */
export function ServiceAccessPanels({
  businessId,
  name,
  access,
  onChanged,
}: {
  businessId: string;
  name: string;
  access: ServiceAccessDetail;
  onChanged: () => void;
}) {
  const can = useCan();
  const [changing, setChanging] = useState(false);
  const change = can("business.access") ? (
    <Button onClick={() => setChanging(true)}>Change service access</Button>
  ) : null;
  return (
    <>
      {access.access !== "enabled" || access.held ? (
        <Attention
          title={`Service access: ${ACCESS[access.access][0].toLowerCase()}`}
          bad={!access.selling}
          action={change}
        >
          {accessWhy(access)}
        </Attention>
      ) : null}
      <Panel
        title="Service access"
        right={access.access === "enabled" && !access.held ? change : null}
      >
        {access.changes.length ? (
          <Table
            cols={[["When"], ["State"], ["Why"], ["By"]]}
            rows={access.changes.map((c) => ({
              key: c.id,
              cells: [
                <span className="nowrap" key="w">
                  {when(c.at)}
                </span>,
                <span key="s">
                  <Pill kind={ACCESS[c.access][1]}>{ACCESS[c.access][0]}</Pill>
                  {c.held && c.heldUntil ? (
                    <div className="sub">Until {shortDate(calendarDay(c.heldUntil))}</div>
                  ) : null}
                </span>,
                <span key="r">
                  {REASON[c.reason]}
                  {c.note ? <div className="sub">{c.note}</div> : null}
                </span>,
                c.by ?? "Its bills",
              ],
            }))}
          />
        ) : (
          <p className="muted">
            Enabled since it joined. Its bills set it from here on: a grace period once a
            month&apos;s fees are overdue.
          </p>
        )}
      </Panel>
      {changing ? (
        <ChangeDialog
          businessId={businessId}
          name={name}
          access={access}
          suspends={can("business.suspend")}
          onClose={() => setChanging(false)}
          onDone={() => {
            setChanging(false);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

type SetBy = "bills" | ServiceAccess;
const FOR = [
  ["", "Until someone changes it"],
  ["7", "7 days"],
  ["14", "14 days"],
  ["30", "30 days"],
] as const;

/** By its bills is the usual way; by hand holds a state for a time or until changed (ADR-0014, 4). */
function ChangeDialog({
  businessId,
  name,
  access,
  suspends,
  onClose,
  onDone,
}: {
  businessId: string;
  name: string;
  access: ServiceAccessDetail;
  suspends: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, errors, run } = useSubmit();
  const options: [SetBy, string][] = [
    ["bills", "By its bills"],
    ["enabled", "Enabled"],
    ["grace_period", "Grace period"],
    ["read_only", "Read-only"],
    // Only the platform admin suspends; nothing suspends a business by itself.
    ...(suspends ? ([["suspended", "Suspended"]] as [SetBy, string][]) : []),
  ];
  const [setBy, setSetBy] = useState<SetBy>(access.held ? "bills" : "enabled");
  const [days, setDays] = useState<string>("");
  const [reason, setReason] = useState<ServiceAccessReason>("payment_arranged");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  return (
    <Dialog label="Change service access" onClose={onClose}>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(
            () =>
              api.put(
                `/api/businesses/${businessId}/service-access`,
                setBy === "bills"
                  ? { mode: "bills", reason, note, message }
                  : {
                      mode: "hold",
                      access: setBy,
                      days: days ? Number(days) : null,
                      reason,
                      note,
                      message,
                    },
              ),
            `${name}'s service access changed. Its owners have been emailed.`,
          );
          if (ok) onDone();
        }}
      >
        <h2>Change service access</h2>
        <p className="muted">
          {name} is {ACCESS[access.access][0].toLowerCase()},{" "}
          {access.held ? "set by hand" : "by its bills"}. Its owners get an email with the reason
          and your message, never the note.
        </p>
        <Field label="Set by" id="as">
          <select
            id="as"
            className="input"
            value={setBy}
            onChange={(e) => setSetBy(e.target.value as SetBy)}
          >
            {options.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {setBy === "bills" ? null : (
          <Field label="For" id="ag" hint="Then it follows its bills again." error={errors.days}>
            <select
              id="ag"
              className="input"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            >
              {FOR.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Reason" id="ar">
          <select
            id="ar"
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value as ServiceAccessReason)}
          >
            {(Object.keys(REASON) as ServiceAccessReason[]).map((r) => (
              <option key={r} value={r}>
                {REASON[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Note for the team"
          id="an"
          hint="Kept in its history only."
          error={errors.note ? `The note ${errors.note}.` : undefined}
        >
          <input
            id="an"
            className="input"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <Field label="Message to the owners (optional)" id="am" error={errors.message}>
          <input
            id="am"
            className="input"
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy} disabled={!note.trim()}>
            Change access
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
