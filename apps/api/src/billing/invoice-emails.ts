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
  return invoice.kind === "monthly_fees" && invoice.period
    ? `HashiNet's fees for ${monthName(invoice.period)}`
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
