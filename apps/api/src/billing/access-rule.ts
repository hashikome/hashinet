import type { SellingPause, ServiceAccess } from "@hashinet/types";
import { addDays } from "../core/time/business-day.js";
import { invoiceState } from "./invoice-state.js";

/** A business can't sell while it is read-only or suspended (ADR-0014, 2). */
export const sellingStopped = (access: ServiceAccess) =>
  access === "read_only" || access === "suspended";

/** Why a business can't sell: its overdue bill, or a hold by HashiNet's team; null while it sells. */
export const pauseOf = (b: { access: ServiceAccess; accessHeld: boolean }): SellingPause | null =>
  sellingStopped(b.access) ? (b.accessHeld ? "held" : "overdue") : null;

/** Days from a bill's due date to read-only, for a business that was late before (ADR-0014, 2). */
export const READ_ONLY_AFTER_DAYS = 14;

/** A month's fees, as the rule reads them: one-off charges never count, as each is paid before what
 * it buys. Days are business days (YYYY-MM-DD). */
export interface FeesBill {
  dueOn: string;
  totalTsh: number;
  payments: { amountTsh: number; receivedOn: string }[];
}

export type AccessByBills =
  | { access: "enabled" }
  | {
      access: "grace_period" | "read_only";
      /** The first day it held. */
      since: string;
      /** The oldest overdue bill's due date. */
      overdueSince: string;
      overdueTsh: number;
      /** An earlier month was paid after its due date. */
      lateBefore: boolean;
      /** When selling pauses: 14 days after the due date for a business late before, else never. */
      pausesOn: string | null;
    };

const paidOf = (b: FeesBill) => b.payments.reduce((sum, p) => sum + p.amountTsh, 0);

/** The day a bill was paid in full, or null while anything is left. */
function paidInFullOn(b: FeesBill): string | null {
  let paid = 0;
  for (const p of [...b.payments].sort((x, y) => x.receivedOn.localeCompare(y.receivedOn))) {
    paid += p.amountTsh;
    if (paid >= b.totalTsh) return p.receivedOn;
  }
  return null;
}

/**
 * What a business may do by its bills (owner, 26 November 2026): its oldest overdue month of fees
 * starts a grace period the day after its due date, and read-only 14 days after it. Never on a first
 * missed payment (ADR-0014, 2): only a business late before, one whose earlier month was paid after
 * its due date, goes read-only; any other stays in its grace period until it pays.
 */
export function accessByBills(bills: FeesBill[], today: string): AccessByBills {
  const overdue = bills
    .filter((b) => invoiceState(b.totalTsh, paidOf(b), b.dueOn, today) === "overdue")
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const oldest = overdue[0];
  if (!oldest) return { access: "enabled" };
  const lateBefore = bills.some((b) => {
    if (b.dueOn >= oldest.dueOn) return false;
    const paidOn = paidInFullOn(b);
    return paidOn !== null && paidOn > b.dueOn;
  });
  const pausesOn = lateBefore ? addDays(oldest.dueOn, READ_ONLY_AFTER_DAYS) : null;
  const facts = {
    overdueSince: oldest.dueOn,
    overdueTsh: overdue.reduce((sum, b) => sum + b.totalTsh - paidOf(b), 0),
    lateBefore,
    pausesOn,
  };
  return pausesOn !== null && today >= pausesOn
    ? { access: "read_only", since: pausesOn, ...facts }
    : { access: "grace_period", since: addDays(oldest.dueOn, 1), ...facts };
}
