"use client";

import { useCan } from "@/lib/session";
import { Dialog } from "./dialog";
import { Button, ButtonLink } from "./ui";

/** What the paused action would have done, said in the dialog. */
const WHAT = {
  sell: "so new vouchers can't be sold",
  packages: "so packages and prices stay as they are, and new vouchers can't be sold",
} as const;

/**
 * Why an action is paused while the business's bill to HashiNet is overdue (ADR-0014, 2): the action
 * stays in view, quieter, and a tap opens this. The owner pays to get it back; everyone else hears
 * that the owner knows. Vouchers already sold keep working either way.
 */
export function BillPausedDialog({
  what,
  onClose,
}: {
  what: keyof typeof WHAT;
  onClose: () => void;
}) {
  const can = useCan();
  const pays = can("billing.read");
  return (
    <Dialog label="Selling is paused" className="sell" onClose={onClose}>
      <h2>Selling is paused</h2>
      <p>The bill to HashiNet is overdue, {WHAT[what]}.</p>
      <p className="note">
        {pays ? "Pay what is overdue to sell again." : "The owner has been told."} Vouchers already
        sold keep working.
      </p>
      <div className="dialog-actions">
        {pays ? (
          <ButtonLink kind="primary" href="/billing">
            Open Billing
          </ButtonLink>
        ) : null}
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
