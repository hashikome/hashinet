import type { InvoiceState } from "@hashinet/types";
import { businessDayOf, dateOf } from "../analytics/business-day.js";

/**
 * Where an invoice stands on `today`: paid in full, or overdue once its due date has passed with
 * anything left, whatever came in (ADR-0013, 6).
 */
export function invoiceState(
  totalTsh: number,
  paidTsh: number,
  dueOn: string,
  today: string,
): InvoiceState {
  if (paidTsh >= totalTsh) return "paid";
  if (today > dueOn) return "overdue";
  return paidTsh > 0 ? "part_paid" : "due";
}

/** An invoice's money as of `now`: what was paid, what is left, and where it stands. */
export function invoiceSummary(totalTsh: number, paidTsh: number, dueOn: Date, now: Date) {
  const due = dateOf(dueOn);
  return {
    paidTsh,
    dueTsh: totalTsh - paidTsh,
    dueOn: due,
    state: invoiceState(totalTsh, paidTsh, due, businessDayOf(now)),
  };
}
