"use client";

import type { PaymentWay, VenuePaymentDetails } from "@hashinet/types";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { LoadFailed, useLoad } from "@/lib/load";
import { useSubmit } from "@/lib/submit";
import { Button, Field, Panel } from "./ui";

/** At most three ways to pay at a venue (the API and the database hold it too). */
const MAX_WAYS = 3;
const BLANK: PaymentWay = { through: "", number: "", name: "" };

/** One way to pay, as whoever sells reads it out at the counter. */
export function PayCard({ way }: { way: PaymentWay }) {
  return (
    <div className="pay-to">
      <span className="lbl">Pay to · {way.through}</span>
      <b>{way.number}</b>
      <small>{way.name}</small>
    </div>
  );
}

/**
 * A venue's payment details (ADR-0017, 4): where guests pay it by mobile money, read out at the
 * counter. Each way shows as whoever sells sees it; a form opens only to add or change one, and
 * saving sends the whole list.
 */
export function PaymentDetails({ venueId, edit }: { venueId: string; edit: boolean }) {
  const details = useLoad(
    () => api.get<VenuePaymentDetails>(`/api/venues/${venueId}/payment-details`),
    [venueId],
  );
  // The way open in the form: its place in the list, or "new".
  const [open, setOpen] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<PaymentWay>(BLANK);
  const { busy, errors, run } = useSubmit();
  const ways = details.data?.ways ?? [];
  // Opening the form takes the person to its first field.
  useEffect(() => {
    if (open !== null) document.getElementById("w-through")?.focus();
  }, [open]);

  const save = async (next: PaymentWay[], done: string) => {
    const ok = await run(
      () => api.put(`/api/venues/${venueId}/payment-details`, { ways: next }),
      done,
    );
    if (ok) {
      setOpen(null);
      await details.reload();
    }
  };
  const start = (at: number | "new") => {
    setDraft(at === "new" ? BLANK : (ways[at] ?? BLANK));
    setOpen(at);
  };
  const error = (n: number, key: keyof PaymentWay, what: string) => {
    const message = errors[`ways.${n}.${key}`];
    return message ? { error: `The ${what} ${message}.` } : {};
  };
  const at = open === "new" ? ways.length : (open ?? 0);
  const form = (
    <form
      className="form way-form"
      noValidate
      aria-labelledby="wf-h"
      onSubmit={(e) => {
        e.preventDefault();
        const next =
          open === "new" ? [...ways, draft] : ways.map((w, i) => (i === open ? draft : w));
        void save(next, "Saved. Whoever sells sees it from their next sale.");
      }}
    >
      <h3 id="wf-h">{open === "new" ? "Add a way to pay" : "Change this way to pay"}</h3>
      <Field
        label="Paid through"
        id="w-through"
        hint="A Lipa namba, a bank or a mobile money network"
        {...error(at, "through", "name of what it is paid through")}
      >
        <input
          id="w-through"
          className="input"
          value={draft.through}
          onChange={(e) => setDraft({ ...draft, through: e.target.value })}
        />
      </Field>
      <Field label="Number" id="w-number" {...error(at, "number", "number")}>
        <input
          id="w-number"
          className="input"
          inputMode="numeric"
          value={draft.number}
          onChange={(e) => setDraft({ ...draft, number: e.target.value })}
        />
      </Field>
      <Field
        label="Name"
        id="w-name"
        hint="As the payment shows it to the guest"
        {...error(at, "name", "name")}
      >
        <input
          id="w-name"
          className="input"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </Field>
      <div className="actions">
        <Button
          kind="primary"
          type="submit"
          busy={busy}
          disabled={!draft.through.trim() || !draft.number.trim() || !draft.name.trim()}
        >
          Save
        </Button>
        <Button onClick={() => setOpen(null)}>Cancel</Button>
      </div>
    </form>
  );

  return (
    <Panel
      title="Payment details"
      right={
        edit && open === null && details.data && ways.length < MAX_WAYS ? (
          <div className="actions">
            <Button
              kind={ways.length ? "secondary" : "primary"}
              icon="plus"
              onClick={() => start("new")}
            >
              {ways.length ? "Add a way" : "Add a way to pay"}
            </Button>
          </div>
        ) : null
      }
    >
      {details.error ? <LoadFailed error={details.error} retry={details.reload} /> : null}
      {details.data ? (
        <div className="pay-set">
          <p className="muted">Whoever sells reads these out when a guest pays by mobile money.</p>
          {ways.length ? (
            <div className="ways">
              {ways.map((w, i) =>
                open === i ? (
                  <div key={`${w.through}${w.number}`}>{form}</div>
                ) : (
                  <div className="way" key={`${w.through}${w.number}`}>
                    <PayCard way={w} />
                    {edit && open === null ? (
                      <div className="way-acts">
                        <Button onClick={() => start(i)}>Change</Button>
                        <Button
                          busy={busy}
                          onClick={() =>
                            void save(
                              ways.filter((_, k) => k !== i),
                              `${w.through} removed. Sellers no longer see it.`,
                            )
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ),
              )}
            </div>
          ) : open === null ? (
            <p>No payment details yet.</p>
          ) : null}
          {open === "new" ? form : null}
        </div>
      ) : null}
    </Panel>
  );
}
