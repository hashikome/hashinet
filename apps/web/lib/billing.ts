import type {
  BillingAccount,
  BillPaymentMethod,
  InvoiceRecord,
  InvoiceState,
} from "@hashinet/types";
import type { PillKind } from "@/components/hearth/ui";
import { calendarDay, longDate, monthName } from "./dates";
import { tsh } from "./money";

export const METHOD_NAME: Record<BillPaymentMethod, string> = {
  mobile_money: "Mobile money",
  bank_transfer: "Bank transfer",
  cash: "Cash",
};

/** An invoice's state as its pill says it (prototype `billPill`). */
export const STATE: Record<InvoiceState, [string, PillKind]> = {
  due: ["Due", "wait"],
  part_paid: ["Part paid", "wait"],
  paid: ["Paid", "ok"],
  overdue: ["Overdue", "bad"],
};

/** What an invoice is for: "November 2026 fees", "Bahari Beach Bar onboarding". */
export function invoiceWhat(i: InvoiceRecord): string {
  return i.kind === "monthly_fees" && i.period
    ? `${monthName(i.period)} fees`
    : `${i.venueName ?? "A venue's"} onboarding`;
}

/** "7 December 2026", a calendar day as written in full. */
export const fullDay = (day: string) => longDate(calendarDay(day));

/**
 * What a business owes, said once (prototype `owesLine`): one invoice names itself; several are
 * listed, the oldest settled first.
 */
export function owesLine(name: string, owed: InvoiceRecord[]): string {
  const total = owed.reduce((sum, i) => sum + i.dueTsh, 0);
  if (owed.length === 1 && owed[0])
    return `${name} owes ${tsh(total)} for ${invoiceWhat(owed[0])}.`;
  return `${name} owes ${tsh(total)}: ${owed.map((i) => `${invoiceWhat(i)} ${tsh(i.dueTsh)}`).join(", ")}. A payment settles the oldest bill first.`;
}

/** Its business sells nothing now: read-only or suspended (ADR-0014, 2). */
export const sellingPaused = (a: BillingAccount) =>
  a.access.access === "read_only" || a.access.access === "suspended";

/** What an owner owes, as a title (prototype `bill-due`): what is overdue, or what is due by when. */
export function owedTitle(a: BillingAccount): string {
  const first = a.owed[0];
  if (a.overdueTsh > 0) {
    return `${sellingPaused(a) ? "Selling is paused: " : ""}${tsh(a.overdueTsh)} is overdue`;
  }
  return first ? `${tsh(a.dueTsh)} is due by ${fullDay(first.dueOn)}` : "Nothing is owed";
}

/** What is owed, invoice by invoice, then what paying it keeps or brings back. */
export function owedText(a: BillingAccount): string {
  const list = a.owed.map((i) => `${invoiceWhat(i)}: ${tsh(i.dueTsh)}`).join(" · ");
  const then = sellingPaused(a)
    ? "Pay what is overdue to sell again."
    : a.access.pausesOn
      ? `Pay what is overdue by ${fullDay(a.access.pausesOn)} to keep selling.`
      : "";
  return then ? `${list}. ${then}` : list;
}

/** The owner's bill issue, once selling has paused (prototype `bill-due`): short, and what to do. */
export function pausedText(a: BillingAccount): string {
  const since = a.access.overdueSince ? ` since ${fullDay(a.access.overdueSince)}` : "";
  return `Your bill of ${tsh(a.access.overdueTsh)} has been overdue${since}. Pay it to sell again. Vouchers already sold keep working.`;
}
