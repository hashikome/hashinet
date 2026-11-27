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

/**
 * An invoice's money as of `now`: what was paid, what is left, and where it stands. A cancelled one
 * leaves nothing owed, whatever its total.
 */
export function invoiceSummary(
  invoice: { totalTsh: number; dueOn: Date; cancelledAt: Date | null },
  paidTsh: number,
  now: Date,
) {
  const due = dateOf(invoice.dueOn);
  return {
    paidTsh,
    dueTsh: invoice.cancelledAt ? 0 : invoice.totalTsh - paidTsh,
    dueOn: due,
    state: invoice.cancelledAt
      ? ("cancelled" as const)
      : invoiceState(invoice.totalTsh, paidTsh, due, businessDayOf(now)),
  };
}
