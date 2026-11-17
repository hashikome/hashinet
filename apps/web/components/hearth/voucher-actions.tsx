"use client";

import { groupedCode, type VoucherListItem } from "@hashinet/types";
import { useState } from "react";
import { api } from "@/lib/api";
import { when } from "@/lib/dates";
import { tsh } from "@/lib/money";
import { useSubmit } from "@/lib/submit";
import { Dialog } from "./dialog";
import { Button, Field } from "./ui";

type Method = "cash" | "mobile_money";

/**
 * A refund (ADR-0017, 7): the full price back while the voucher is not used yet, recorded with how
 * it went back. For an owner or a manager; the voucher stops working.
 */
export function RefundDialog({
  voucher,
  onClose,
  onDone,
}: {
  voucher: VoucherListItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<Method>("cash");
  const [phone, setPhone] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const { busy, errors, run } = useSubmit();
  const mobile = method === "mobile_money";
  const price = tsh(voucher.priceTsh);
  const error = (key: string, what: string) =>
    errors[key] ? { error: `The ${what} ${errors[key]}.` } : {};
  return (
    <Dialog label={`Refund ${price}`} onClose={onClose}>
      <h2>Refund {price}</h2>
      <p className="muted">
        <span className="nowrap">{groupedCode(voucher.code)}</span> · {voucher.packageName}. The
        full price goes back to the guest, and the voucher stops working.
      </p>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(
            () =>
              api.post(`/api/vouchers/${voucher.id}/refund`, {
                method,
                phone: mobile ? phone.trim() : null,
                reference: mobile ? reference.trim() : null,
                reason: reason.trim() || null,
              }),
            `Refund of ${price} recorded. The voucher no longer works.`,
          );
          if (ok) onDone();
        }}
      >
        <fieldset className="field" aria-labelledby="rf-by">
          <span className="lbl" id="rf-by">
            Refunded by
          </span>
          <div className="segs">
            {(
              [
                ["cash", "Cash"],
                ["mobile_money", "Mobile money"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={`seg${m === method ? " on" : ""}`}
                aria-pressed={m === method}
                onClick={() => setMethod(m)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        {mobile ? (
          <>
            <Field label="Guest's mobile money number" id="rfn" {...error("phone", "number")}>
              <input
                id="rfn"
                className="input"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <Field
              label="Reference"
              id="rfr"
              hint="From the mobile money message"
              {...error("reference", "reference")}
            >
              <input
                id="rfr"
                className="input"
                autoComplete="off"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          </>
        ) : null}
        <Field label="Reason (optional)" id="rfw" {...error("reason", "reason")}>
          <input
            id="rfw"
            className="input"
            autoComplete="off"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div className="dialog-actions">
          <Button
            kind="primary"
            type="submit"
            busy={busy}
            disabled={mobile && (phone.replace(/\D/g, "").length < 10 || !reference.trim())}
          >
            Record refund
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Release (ADR-0015, 6): a voucher in use is freed for the guest whose phone changed; its devices
 * and sessions go, its time runs on. Whoever is at the counter does it, with the voucher in hand.
 */
export function ReleaseDialog({
  voucher,
  onClose,
  onDone,
}: {
  voucher: VoucherListItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, run } = useSubmit();
  const code = groupedCode(voucher.code);
  return (
    <Dialog label={`Release voucher ${code}`} onClose={onClose}>
      <h2>
        Release voucher <span className="nowrap">{code}</span>?
      </h2>
      <p className="muted">
        {voucher.packageName}
        {voucher.expiresAt ? ` · until ${when(voucher.expiresAt)}` : ""}
      </p>
      <p>Do this only with the voucher in the guest's hand.</p>
      <ul className="facts-list">
        <li>Its devices go offline now.</li>
        <li>Its time keeps running.</li>
        <li>The next device signs in with the code alone.</li>
      </ul>
      <div className="dialog-actions">
        <Button
          kind="primary"
          busy={busy}
          onClick={async () => {
            const ok = await run(
              () => api.post(`/api/vouchers/${voucher.id}/release`),
              "Released. The guest signs in on their new device with the code.",
            );
            if (ok) onDone();
          }}
        >
          Release
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}
