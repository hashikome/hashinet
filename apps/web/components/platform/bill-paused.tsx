"use client";

import { useCan, useSession } from "@/lib/session";
import { Dialog } from "../ui/dialog";
import { Button, ButtonLink } from "../ui/ui";

/** What the paused action would have done, said in the dialog. */
const WHAT = {
  sell: "so new vouchers can't be sold",
  packages: "so packages and prices stay as they are, and new vouchers can't be sold",
} as const;

/**
 * Why an action is paused while its business can't sell (ADR-0014, 2): the action stays in view,
 * quieter, and a tap opens this. Paused by an overdue bill, the owner pays to get it back; paused
 * by HashiNet's team, the owner hears why from them. Vouchers already sold keep working either way.
 */
export function PausedDialog({ what, onClose }: { what: keyof typeof WHAT; onClose: () => void }) {
  const can = useCan();
  const { me } = useSession();
  const owner = can("billing.read");
  const byBill = me.active.pause !== "held";
  return (
    <Dialog label="Selling is paused" className="sell" onClose={onClose}>
      <h2>Selling is paused</h2>
      <p>
        {byBill
          ? `The bill to HashiNet is overdue, ${WHAT[what]}.`
          : `HashiNet's team has paused selling for this business, ${WHAT[what]}.`}
      </p>
      <p className="note">
        {byBill && owner
          ? "Pay what is overdue to sell again."
          : owner
            ? "HashiNet's team has emailed you why, and what brings it back."
            : "The owner has been told."}{" "}
        Vouchers already sold keep working.
      </p>
      <div className="dialog-actions">
        {byBill && owner ? (
          <ButtonLink kind="primary" href="/billing">
            Open Billing
          </ButtonLink>
        ) : null}
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
