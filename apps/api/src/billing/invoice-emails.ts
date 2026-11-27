import type { InvoiceRecord } from "@hashinet/types";
import type { EmailMessage } from "../email/email-sender.js";

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

/** "TSh 5,250". */
export const tsh = (n: number) => `TSh ${n.toLocaleString("en-US")}`;

/** "7 December 2026" from YYYY-MM-DD. */
export function longDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "November 2026" from YYYY-MM. */
export const monthName = (period: string) => longDay(`${period}-01`).replace(/^1 /, "");

/** What an invoice is for, in a sentence's words. */
export function invoiceSubject(invoice: InvoiceRecord): string {
  if (invoice.kind === "monthly_fees" && invoice.period) {
    return `HashiNet's fees for ${monthName(invoice.period)}`;
  }
  return invoice.kind === "site_slot"
    ? `${invoice.venueName ?? "Your venue"}'s extra site`
    : `${invoice.venueName ?? "Your venue"}'s onboarding`;
}

/** An invoice as issued, to the business's owner: what it is, how much, by when, and where to pay. */
export function invoiceEmail(to: string, invoice: InvoiceRecord, billing: string): EmailMessage {
  const what = invoiceSubject(invoice);
  return {
    to,
    subject: `Invoice ${invoice.number}: ${what}`,
    text: [
      `${what}, for ${invoice.businessName}: ${tsh(invoice.totalTsh)}, due by ${longDay(invoice.dueOn)}.`,
      "",
      `See the invoice, and how to pay, on Billing: ${billing}`,
      "",
      `Use ${invoice.number} as the reference when you pay.`,
    ].join("\n"),
  };
}

/** An unpaid invoice withdrawn, to the business's owner: which one, why, and that nothing is owed on it. */
export function cancelledEmail(
  to: string,
  invoice: InvoiceRecord,
  reason: string,
  billing: string,
): EmailMessage {
  const what = invoiceSubject(invoice);
  return {
    to,
    subject: `Invoice ${invoice.number} is cancelled`,
    text: [
      `${what}, for ${invoice.businessName}: invoice ${invoice.number}, ${tsh(invoice.totalTsh)}, is cancelled. ${reason} Nothing is owed on it.`,
      "",
      `It stays on Billing, marked cancelled: ${billing}`,
    ].join("\n"),
  };
}

/** What a business owes, invoice by invoice, to its owner: on request, or on a due date left unpaid. */
export function reminderEmail(to: string, owed: InvoiceRecord[], billing: string): EmailMessage {
  const total = owed.reduce((sum, i) => sum + i.dueTsh, 0);
  const name = owed[0]?.businessName ?? "Your business";
  return {
    to,
    subject: `${name} owes HashiNet ${tsh(total)}`,
    text: [
      `${name} owes HashiNet ${tsh(total)}:`,
      "",
      ...owed.map(
        (i) =>
          `- ${i.number}, ${invoiceSubject(i)}: ${tsh(i.dueTsh)}, ${i.state === "overdue" ? "overdue since" : "due by"} ${longDay(i.dueOn)}`,
      ),
      "",
      `See your invoices, and how to pay, on Billing: ${billing}`,
      "",
      "Use the invoice number as the reference when you pay. If you have paid already, thank you: it shows once HashiNet records it.",
    ].join("\n"),
  };
}
