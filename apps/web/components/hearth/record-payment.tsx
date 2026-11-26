"use client";

import { BILL_PAYMENT_METHODS, type BillPaymentMethod, type InvoiceRecord } from "@hashinet/types";
import { useState } from "react";
import { api } from "@/lib/api";
import { invoiceWhat, METHOD_NAME } from "@/lib/billing";
import { todayIso as today } from "@/lib/dates";
import { tsh } from "@/lib/money";
import { useSubmit } from "@/lib/submit";
import { Dialog } from "./dialog";
import { Button, Field } from "./ui";

/**
 * Record a payment (prototype `payForm`): the same dialog wherever it starts, a business's bill or
 * one invoice. It takes what actually arrived; a part payment leaves the rest due, and more than is
 * owed is refused. `invoiceId` settles that invoice; without it, the oldest first, unless the
 * dialog is given several open invoices and the payment names one (Settles).
 */
export function RecordPayment({
  businessId,
  invoiceId,
  owed = [],
  owedTsh,
  says,
  onClose,
  onDone,
}: {
  businessId: string;
  invoiceId: string | null;
  /** The business's open invoices, oldest first: with more than one, Settles offers each. */
  owed?: InvoiceRecord[];
  owedTsh: number;
  /** What is owed, said once: one invoice names itself; several are listed. */
  says: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, errors, run } = useSubmit();
  // Which invoice it settles: the oldest first, as usual, or the one the business paid for.
  const [settles, setSettles] = useState<string | null>(invoiceId);
  const chosen = owed.find((i) => i.id === settles) ?? null;
  const owes = chosen ? chosen.dueTsh : owedTsh;
  const [amount, setAmount] = useState(String(owedTsh));
  const [receivedOn, setReceivedOn] = useState(today());
  const [method, setMethod] = useState<BillPaymentMethod>("mobile_money");
  const [reference, setReference] = useState("");
  const n = Number(amount) || 0;
  const left =
    n <= 0
      ? "Enter the amount received"
      : n > owes
        ? `That is ${tsh(n - owes)} more than ${chosen ? "it owes" : "is owed"}`
        : n === owes
          ? chosen
            ? "Settles it"
            : "Settles everything owed"
          : `Leaves ${tsh(owes - n)} still due`;
  return (
    <Dialog label="Record a payment" onClose={onClose}>
      <h2>Record a payment</h2>
      <p className="muted">{says}</p>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const sent = await run(
            () =>
              api.post("/api/billing/payments", {
                businessId,
                invoiceId: settles,
                amountTsh: n,
                receivedOn,
                method,
                reference: method === "cash" ? "" : reference,
              }),
            `${tsh(n)} recorded.`,
          );
          if (sent) onDone();
        }}
      >
        {invoiceId === null && owed.length > 1 ? (
          <Field label="Settles" id="ps">
            <select
              id="ps"
              className="input"
              value={settles ?? ""}
              onChange={(e) => {
                const next = owed.find((i) => i.id === e.target.value) ?? null;
                setSettles(next?.id ?? null);
                setAmount(String(next ? next.dueTsh : owedTsh));
              }}
            >
              <option value="">The oldest first</option>
              {owed.map((i) => (
                <option key={i.id} value={i.id}>
                  {`${i.number}, ${invoiceWhat(i)} · ${tsh(i.dueTsh)}`}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field
          label="Amount received (TSh)"
          id="pa"
          error={errors.amountTsh ? `The amount ${errors.amountTsh}.` : undefined}
          hint={<span aria-live="polite">{left}</span>}
        >
          <input
            id="pa"
            className="input num"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Field
          label="Date received"
          id="pd"
          error={errors.receivedOn ? `The date ${errors.receivedOn}.` : undefined}
        >
          <input
            id="pd"
            className="input"
            type="date"
            max={today()}
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
          />
        </Field>
        <Field label="How it was paid" id="pm">
          <select
            id="pm"
            className="input"
            value={method}
            onChange={(e) => setMethod(e.target.value as BillPaymentMethod)}
          >
            {BILL_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_NAME[m]}
              </option>
            ))}
          </select>
        </Field>
        {method === "cash" ? null : (
          <Field label="Reference (optional)" id="pr" error={errors.reference}>
            <input
              id="pr"
              className="input"
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
        )}
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy} disabled={n <= 0 || n > owedTsh}>
            Record payment
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
