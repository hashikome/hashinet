"use client";

import type {
  PaymentWay,
  PaymentWayKind,
  PaymentWayList,
  PaymentWayRecord,
  VenuePaymentWay,
} from "@hashinet/types";
import Link from "next/link";
import { useState } from "react";
import { api, messageOf } from "@/lib/api";
import { shortDate } from "@/lib/dates";
import { LoadFailed, useLoad } from "@/lib/load";
import { useSubmit } from "@/lib/submit";
import { Dialog } from "../ui/dialog";
import { Button, Field, Panel, Pill, Table, useToast } from "../ui/ui";

const KINDS: [PaymentWayKind, string][] = [
  ["lipa_namba", "Lipa namba"],
  ["mobile_number", "Mobile money number"],
  ["bank_account", "Bank account"],
];
const KIND_NAME = Object.fromEntries(KINDS) as Record<PaymentWayKind, string>;
const SETTINGS_PAYMENTS = "/settings/payments";

/** One way to pay, as whoever sells reads it out at the counter. */
export function PayCard({ way }: { way: Pick<PaymentWay, "through" | "number" | "name"> }) {
  return (
    <div className="pay-to">
      <span className="lbl">Pay to · {way.through || "…"}</span>
      <b>{way.number || "…"}</b>
      <small>{way.name || "…"}</small>
    </div>
  );
}

/** What a way is, under its name in the table, unless its name already says it. */
function subOf(w: PaymentWayRecord): string | null {
  if (w.kind === "lipa_namba") return w.label === null ? null : w.through;
  return w.label === null ? KIND_NAME[w.kind] : `${KIND_NAME[w.kind]} · ${w.through}`;
}

/** How the business's people know a way: its label, or what it is and its number. */
const nameOf = (w: PaymentWay) => w.label ?? `${w.through} ${w.number}`;
/** A way in a list of choices: label, what it is, number and name. */
const choiceOf = (w: PaymentWay) =>
  `${w.label ? `${w.label}: ` : ""}${w.through} ${w.number} · ${w.name}`;

/** A business's ways to pay; `enabled` false reads none, for a reader who only sees their venue's. */
const useWays = (enabled = true) =>
  useLoad(
    "payment-ways",
    () => (enabled ? api.get<PaymentWayList>("/api/payment-ways") : Promise.resolve({ ways: [] })),
    [enabled],
  );

/** The way whoever sells at a venue reads out: the one loader for the venue page and Sell. */
export const paymentWayAt = (venueId: string) =>
  api.get<VenuePaymentWay>(`/api/venues/${venueId}/payment-way`);

/**
 * Settings › Payments (prototype `paydetails`): the business's ways to pay, a table with where each is
 * used. The owner and business managers add and change them in the shared dialog; the default can't
 * be removed, and removing another, after a confirmation, moves its venues to the default.
 */
export function PaymentWays({ edit }: { edit: boolean }) {
  const ways = useWays();
  const [open, setOpen] = useState<PaymentWayRecord | "new" | null>(null);
  const [removing, setRemoving] = useState<PaymentWayRecord | null>(null);
  const list = ways.data?.ways ?? [];
  const add = edit ? (
    <Button kind={list.length ? "secondary" : "primary"} icon="plus" onClick={() => setOpen("new")}>
      {list.length ? "Add a way" : "Add a way to pay"}
    </Button>
  ) : null;
  return (
    <Panel title={`Ways to pay · ${list.length}`} right={ways.data ? add : null}>
      {ways.error ? <LoadFailed error={ways.error} retry={ways.reload} /> : null}
      {ways.data ? (
        list.length ? (
          <>
            <p className="muted panel-lead">
              Venues use the default unless they choose another on their page. The default
              can&apos;t be removed: make another the default first.
            </p>
            <Table
              cols={[
                ["Way to pay"],
                ["Number and name"],
                ["Used at"],
                ["Added"],
                ...(edit ? ([[""]] as [string][]) : []),
              ]}
              rows={list.map((w) => ({
                key: w.id,
                cells: [
                  <span key="w">
                    <span className="name">{w.label ?? w.through}</span>
                    {w.isDefault ? (
                      <>
                        {" "}
                        <Pill>Default</Pill>
                      </>
                    ) : null}
                    {/* What it is, unless its name already says so. */}
                    {subOf(w) ? <div className="sub">{subOf(w)}</div> : null}
                  </span>,
                  <span key="n">
                    <span className="num nowrap">{w.number}</span>
                    <div className="sub">
                      {w.name}
                      {w.branch ? ` · ${w.branch}` : ""}
                    </div>
                  </span>,
                  w.venues.length ? (
                    w.venues.map((v) => v.name).join(", ")
                  ) : (
                    <span className="muted" key="u">
                      No venue
                    </span>
                  ),
                  <span key="a">
                    <span className="nowrap">{shortDate(w.addedAt)}</span>
                    {w.addedBy ? <div className="sub">{w.addedBy}</div> : null}
                  </span>,
                  ...(edit
                    ? [
                        <div className="actions row-actions" key="x">
                          <Button onClick={() => setOpen(w)}>Change</Button>
                          {w.isDefault ? null : (
                            <Button kind="danger" onClick={() => setRemoving(w)}>
                              Remove
                            </Button>
                          )}
                        </div>,
                      ]
                    : []),
                ],
              }))}
            />
          </>
        ) : (
          <p>No ways to pay yet. Until you add one, sales are cash only.</p>
        )
      ) : null}
      {open !== null ? (
        <WayDialog
          way={open === "new" ? null : open}
          first={list.length === 0}
          onClose={() => setOpen(null)}
          onSaved={ways.reload}
        />
      ) : null}
      {removing ? (
        <RemoveDialog
          way={removing}
          fallback={list.find((w) => w.isDefault) ?? null}
          onClose={() => setRemoving(null)}
          onSaved={ways.reload}
        />
      ) : null}
    </Panel>
  );
}

interface Draft {
  kind: PaymentWayKind;
  provider: string;
  number: string;
  name: string;
  branch: string;
  label: string;
  makeDefault: boolean;
}

/** Adding or changing a way: its kind first, then what that kind needs, with what sellers read. */
function WayDialog({
  way,
  first,
  onClose,
  onSaved,
}: {
  way: PaymentWayRecord | null;
  first: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [d, setD] = useState<Draft>({
    kind: way?.kind ?? "lipa_namba",
    provider: way?.provider ?? "",
    number: way?.number ?? "",
    name: way?.name ?? "",
    branch: way?.branch ?? "",
    label: way?.label ?? "",
    makeDefault: false,
  });
  const { busy, errors, run } = useSubmit();
  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setD({ ...d, [key]: e.target.value });
  const input = (key: keyof Draft, label: string, hint?: string, numeric = false) => (
    <Field label={label} id={`w-${key}`} hint={hint} error={errors[key]}>
      <input
        id={`w-${key}`}
        className="input"
        type="text"
        inputMode={numeric ? "numeric" : undefined}
        autoComplete="off"
        value={String(d[key])}
        onChange={set(key)}
        aria-invalid={errors[key] ? true : undefined}
      />
    </Field>
  );
  const fields =
    d.kind === "lipa_namba" ? (
      <>
        {input("provider", "Provider", "Whose Lipa namba it is, a network or a bank")}
        {input("number", "Lipa namba", undefined, true)}
        {input("name", "Name it shows", "As a guest's phone shows it when they pay")}
      </>
    ) : d.kind === "mobile_number" ? (
      <>
        {input("provider", "Network", "As guests know it")}
        {input("number", "Mobile money number", undefined, true)}
        {input("name", "Registered name", "As a guest's phone shows it when they pay")}
      </>
    ) : (
      <>
        {input("provider", "Bank")}
        {input("name", "Account name")}
        {input("number", "Account number", undefined, true)}
        {input("branch", "Branch (optional)")}
      </>
    );
  const through =
    d.kind === "lipa_namba"
      ? d.provider.trim()
        ? `${d.provider.trim()} Lipa namba`
        : "Lipa namba"
      : d.provider.trim();
  const save = async () => {
    const body = {
      kind: d.kind,
      number: d.number,
      name: d.name,
      label: d.label,
      makeDefault: d.makeDefault,
      provider: d.provider,
      ...(d.kind === "bank_account" ? { branch: d.branch } : {}),
    };
    const ok = await run(
      () =>
        way ? api.put(`/api/payment-ways/${way.id}`, body) : api.post("/api/payment-ways", body),
      "Saved. Venues using it show it from their next sale.",
    );
    if (ok) {
      await onSaved();
      onClose();
    }
  };
  return (
    <Dialog label={way ? "Change this way to pay" : "Add a way to pay"} onClose={onClose}>
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2>{way ? "Change this way to pay" : "Add a way to pay"}</h2>
        <fieldset className="field" aria-labelledby="w-kind">
          <span className="lbl" id="w-kind">
            Type
          </span>
          <div className="segs">
            {KINDS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`seg${k === d.kind ? " on" : ""}`}
                aria-pressed={k === d.kind}
                onClick={() => setD({ ...d, kind: k })}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        {fields}
        {input("label", "Label (optional)", "For you and your team, such as Lodge reception")}
        {first ? (
          <p className="muted small">
            Your first way is your default: venues with no choice of their own use it.
          </p>
        ) : way?.isDefault ? (
          <p className="muted small">
            This is your default: venues with no choice of their own use it.
          </p>
        ) : (
          <label className="check">
            <input
              type="checkbox"
              checked={d.makeDefault}
              onChange={(e) => setD({ ...d, makeDefault: e.target.checked })}
            />{" "}
            <span>Make it the default, for venues with no choice of their own</span>
          </label>
        )}
        <div className="field">
          <span className="lbl">What whoever sells reads out</span>
          <PayCard way={{ through, number: d.number.trim(), name: d.name.trim() }} />
        </div>
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Removing a way says what changes at the counter: which venues read it out, and what instead. */
function RemoveDialog({
  way,
  fallback,
  onClose,
  onSaved,
}: {
  way: PaymentWayRecord;
  fallback: PaymentWayRecord | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const users = way.venues.map((v) => v.name);
  const at =
    users.length > 1 ? `${users.slice(0, -1).join(", ")} and ${users.at(-1)}` : (users[0] ?? "");
  const one = users.length === 1;
  return (
    <Dialog label={`Remove ${nameOf(way)}`} onClose={onClose} alert>
      <h2>Remove {nameOf(way)}?</h2>
      <p className="muted">
        {users.length && fallback
          ? `${at} ${one ? "uses" : "use"} it; ${one ? "it moves" : "they move"} to your default, ${nameOf(fallback)}, and whoever sells there reads that out instead.`
          : "No venue uses it, so nothing changes at the counter."}{" "}
        Sales already made keep it in their record.
      </p>
      <div className="dialog-actions">
        <Button
          kind="danger"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.delete(`/api/payment-ways/${way.id}`);
              await onSaved();
              onClose();
              toast(
                users.length
                  ? `${nameOf(way)} removed. Venues that used it moved to your default.`
                  : `${nameOf(way)} removed.`,
              );
            } catch (e) {
              toast(messageOf(e));
              setBusy(false);
            }
          }}
        >
          Remove way to pay
        </Button>
        <Button data-cancel onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * A venue's Payments (prototype `venueWay`): the one of its business's ways that whoever sells here
 * reads out. Its managers choose among them; with one way, or for others, it is stated.
 */
export function VenueWay({ venueId, choose }: { venueId: string; choose: boolean }) {
  const toast = useToast();
  const here = useLoad("venue-payment-way", () => paymentWayAt(venueId), [venueId]);
  // Only those who choose read the business's list.
  const ways = useWays(choose);
  const [busy, setBusy] = useState(false);
  const error = here.error ?? ways.error;
  const settings = (
    <Link className="link" href={SETTINGS_PAYMENTS}>
      Settings › Payments
    </Link>
  );
  const body = (() => {
    if (!here.data || !ways.data) return null;
    const { way, choiceId } = here.data;
    const list = ways.data.ways;
    const fallback = list.find((w) => w.isDefault) ?? null;
    if (choose && list.length > 1 && fallback) {
      return (
        <div className="field venue-way">
          <label htmlFor="vw">Guests pay at this venue to</label>
          <select
            id="vw"
            className="input"
            value={choiceId ?? "default"}
            disabled={busy}
            onChange={async (e) => {
              const wayId = e.target.value === "default" ? null : e.target.value;
              setBusy(true);
              try {
                await api.put(`/api/venues/${venueId}/payment-way`, { wayId });
                await Promise.all([here.reload(), ways.reload()]);
                toast("Saved. Whoever sells here sees it from their next sale.");
              } catch (err) {
                toast(messageOf(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <option value="default">The business&apos;s default: {choiceOf(fallback)}</option>
            {list
              .filter((w) => !w.isDefault)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {choiceOf(w)}
                </option>
              ))}
          </select>
          <div className="hint">
            Whoever sells here reads it out. Ways to pay are kept in {settings}.
          </div>
        </div>
      );
    }
    return way ? (
      <p>
        Guests pay at this venue to <b>{choiceOf(way)}</b>.
      </p>
    ) : (
      <p>
        No ways to pay yet: sales here are cash only. An owner or business manager adds them in{" "}
        {choose ? settings : "Settings › Payments"}.
      </p>
    );
  })();
  return (
    <Panel title="Payments">
      {error ? (
        <LoadFailed
          error={error}
          retry={() => {
            void here.reload();
            void ways.reload();
          }}
        />
      ) : (
        body
      )}
    </Panel>
  );
}
