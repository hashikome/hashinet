import type { InvoiceLineRecord, InvoiceRecord } from "@hashinet/types";
import { dateOf } from "../../core/time/business-day.js";
import { Prisma } from "../../generated/prisma/client.js";
import { paidOf } from "./business-lock.js";
import { invoiceSummary } from "./invoice-state.js";

export const INVOICE_INCLUDE = {
  business: { select: { name: true } },
  venue: { select: { name: true } },
  lines: { orderBy: { position: "asc" } },
  allocations: {
    include: { payment: { select: { receivedOn: true, method: true, reference: true } } },
    orderBy: { payment: { receivedOn: "asc" } },
  },
} as const satisfies Prisma.InvoiceInclude;
export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

export function invoiceRecord(row: InvoiceRow, now: Date): InvoiceRecord {
  const paidTsh = paidOf(row);
  const lines: InvoiceLineRecord[] = row.lines.map((l) => ({
    label: l.label,
    venueId: l.venueId,
    onboardingKind: l.onboardingKind,
    netSalesTsh: l.netSalesTsh,
    servedBp: l.servedBp,
    minimumTsh: l.minimumTsh,
    amountTsh: l.amountTsh,
  }));
  return {
    id: row.id,
    number: row.number,
    businessId: row.businessId,
    businessName: row.business.name,
    kind: row.kind,
    period: row.period === null ? null : dateOf(row.period).slice(0, 7),
    venueName: row.kind === "monthly_fees" ? null : (row.venue?.name ?? null),
    issuedAt: row.issuedAt.toISOString(),
    totalTsh: row.totalTsh,
    ...invoiceSummary(row, paidTsh, now),
    lines,
    payments: row.allocations.map((a) => ({
      receivedOn: dateOf(a.payment.receivedOn),
      method: a.payment.method,
      reference: a.payment.reference,
      amountTsh: a.amountTsh,
    })),
  };
}
