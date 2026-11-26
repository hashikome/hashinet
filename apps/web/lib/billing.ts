import type { BillPaymentMethod, InvoiceRecord, InvoiceState } from "@hashinet/types";
import type { PillKind } from "@/components/hearth/ui";
import { calendarDay, longDate } from "./dates";
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

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "November 2026" from YYYY-MM. */
export function monthName(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

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
