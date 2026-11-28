import type { FeeTerms, OnboardingLineKind } from "@hashinet/types";
import { Injectable } from "@nestjs/common";
import { REVENUE_EVENTS } from "../../analytics/revenue-events.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import {
  addDays,
  businessDayOf,
  businessDayStart,
  dateOf,
  monthOf,
  nextMonth,
} from "../../core/time/business-day.js";
import { type InvoiceKind, Prisma } from "../../generated/prisma/client.js";
import { passedSetup } from "../../network/routers/router-journey.js";
import { BillReminders } from "./bill-reminders.js";
import { businessFeeTerms } from "./billing-settings.js";
import { lockBusiness } from "./business-lock.js";
import { type Span, servedShare, venueFee } from "./fee.js";
import { cancelledEmail, invoiceEmail } from "./invoice-emails.js";
import { INVOICE_INCLUDE, type InvoiceRow, invoiceRecord } from "./invoice-record.js";
import { OwnerMail } from "./owner-mail.js";

/** A month's invoice is due on this day of the next month; a one-off charge 7 days after it. */
const MONTH_DUE_DAY = 7;
const CHARGE_DUE_DAYS = 7;

/** HashiNet bills from November 2026, the first month its fees ran; no earlier month is invoiced. */
export const BILLING_STARTS = "2026-11-01";

/**
 * What businesses owe HashiNet (ADR-0013, 3 and 6): each month's fees, issued once on the 1st for
 * the month before, and a venue's onboarding charge, issued when its package is confirmed. An
 * invoice is kept as issued.
 */
@Injectable()
export class Invoices {
  constructor(
    private readonly db: PrismaService,
    private readonly ownerMail: OwnerMail,
    private readonly reminders: BillReminders,
  ) {}

  /**
   * Issues every business's invoice for the month starting `period` (YYYY-MM-01), once each: a
   * business already invoiced for it, or owing nothing, gets none. Returns how many were issued.
   */
  async issueMonth(period: string, now = new Date()): Promise<number> {
    const from = businessDayStart(period);
    const to = businessDayStart(nextMonth(period));
    const month = new Date(`${period}T00:00:00Z`);
    // A month is priced in one pass, once: after it, nothing that changes is billed back into it.
    if (await this.db.invoiceRun.findUnique({ where: { period: month } })) return 0;
    const pending = { invoices: { none: { period: month } } } satisfies Prisma.BusinessWhereInput;
    const sales = await this.db.$queryRaw<{ venue_id: string; net: string }[]>`
      WITH ${REVENUE_EVENTS}
      SELECT venue_id, COALESCE(SUM(amount), 0)::numeric(14,2)::text AS net
      FROM revenue_events
      WHERE occurred_at >= ${from} AND occurred_at < ${to} AND venue_id IS NOT NULL
      GROUP BY venue_id`;
    const netOf = new Map(sales.map((s) => [s.venue_id, Math.round(Number(s.net))]));
    const businesses = await this.db.business.findMany({
      where: pending,
      include: {
        venues: {
          orderBy: { name: "asc" },
          include: {
            onboarding: { select: { completedAt: true } },
            routers: {
              select: {
                lastSetup: true,
                outages: {
                  where: {
                    startedAt: { lt: to },
                    OR: [{ endedAt: null }, { endedAt: { gt: from } }],
                  },
                  select: { startedAt: true, endedAt: true },
                },
              },
            },
          },
        },
      },
    });

    let issued = 0;
    for (const business of businesses) {
      const terms = businessFeeTerms(business);
      const lines = business.venues.flatMap((venue) => {
        // A closed business or a venue out of service owes its fee on what it sold, no minimum.
        const serving = business.status === "active" && venue.status === "active";
        const line = this.venueLine(venue, netOf.get(venue.id) ?? 0, terms, {
          period,
          from,
          to,
          now,
          serving,
        });
        return line ? [line] : [];
      });
      const total = lines.reduce((sum, l) => sum + l.amountTsh, 0);
      if (total <= 0) continue;
      const invoice = await this.db.$transaction((tx) =>
        this.create(tx, {
          businessId: business.id,
          kind: "monthly_fees",
          period: month,
          venueId: null,
          dueOn: `${nextMonth(period).slice(0, 8)}${String(MONTH_DUE_DAY).padStart(2, "0")}`,
          lines,
          now,
        }),
      );
      if (invoice) {
        issued++;
        await this.emailOwners(invoice);
      }
    }
    await this.db.invoiceRun.create({ data: { period: month, completedAt: now } });
    // The owners' bill issues, in one pass once every invoice is out.
    if (issued > 0) await this.reminders.syncBillIssues(null, now);
    return issued;
  }

  /** A venue's line on a month's invoice, or none when it owes nothing that month. */
  private venueLine(
    venue: {
      id: string;
      name: string;
      onboarding: { completedAt: Date | null } | null;
      routers: { lastSetup: unknown; outages: { startedAt: Date; endedAt: Date | null }[] }[];
    },
    netSalesTsh: number,
    terms: FeeTerms,
    {
      period,
      from,
      to,
      now,
      serving,
    }: { period: string; from: Date; to: Date; now: Date; serving: boolean },
  ) {
    const setUp = venue.routers.filter((r) => passedSetup(r.lastSetup));
    const completed = venue.onboarding?.completedAt ?? null;
    // The minimum counts from the first full month after the venue's setup, while a router serves.
    const minimumApplies =
      serving &&
      completed !== null &&
      setUp.length > 0 &&
      period >= nextMonth(monthOf(businessDayOf(completed)));
    const share = minimumApplies
      ? servedShare(
          from,
          to,
          setUp.map((r): Span[] => r.outages.map((o) => ({ start: o.startedAt, end: o.endedAt }))),
          now,
        )
      : null;
    const { feeTsh, minimumTsh } = venueFee({ netSalesTsh, servedShare: share }, terms);
    if (feeTsh <= 0) return null;
    return {
      venueId: venue.id,
      label: venue.name,
      onboardingKind: null,
      netSalesTsh,
      servedBp: share === null ? null : Math.round(share * 10_000),
      minimumTsh,
      amountTsh: feeTsh,
    };
  }

  /**
   * Brings a venue's onboarding invoice in line with its confirmed package: one line per package
   * line, due 7 days after confirming, none for a free package. Run in the transaction that
   * confirms it, holding the business row as a payment does, so no payment lands between the two;
   * the caller emails the invoice it returns once that commits. A paid invoice stays as it is.
   */
  async syncOnboarding(
    venueId: string,
    tx: Prisma.TransactionClient,
    now = new Date(),
  ): Promise<InvoiceRow | null> {
    const onboarding = await tx.venueOnboarding.findUnique({
      where: { venueId },
      include: { lines: { orderBy: { position: "asc" } }, venue: { select: { businessId: true } } },
    });
    if (!onboarding?.confirmedAt) return null;
    await lockBusiness(tx, onboarding.venue.businessId);
    const lines = onboarding.lines.map((l) => ({
      venueId,
      label: l.description ?? "",
      onboardingKind: l.kind,
      netSalesTsh: null,
      servedBp: null,
      minimumTsh: null,
      amountTsh: l.amountTsh,
    }));
    const total = lines.reduce((sum, l) => sum + l.amountTsh, 0);
    const dueOn = addDays(businessDayOf(onboarding.confirmedAt), CHARGE_DUE_DAYS);
    const existing = await tx.invoice.findFirst({
      where: { kind: "onboarding", venueId, cancelledAt: null },
      include: { allocations: { select: { id: true } } },
    });
    if (existing) {
      if (existing.allocations.length > 0) return null;
      // Made free before anything was paid: withdrawn, and kept with its number.
      if (total <= 0) {
        return this.cancel(
          tx,
          existing.id,
          "Its onboarding package was changed to one with no charge.",
        );
      }
      if (existing.totalTsh === total && dateOf(existing.dueOn) === dueOn) return null;
      // Changed on the call before anything was paid: the same invoice, its lines as agreed now.
      return tx.invoice.update({
        where: { id: existing.id },
        data: {
          totalTsh: total,
          dueOn: new Date(`${dueOn}T00:00:00Z`),
          lines: { deleteMany: {}, create: lines.map((l, position) => ({ ...l, position })) },
        },
        include: INVOICE_INCLUDE,
      });
    }
    if (total <= 0) return null;
    return this.create(tx, {
      businessId: onboarding.venue.businessId,
      kind: "onboarding",
      period: null,
      venueId,
      dueOn,
      lines,
      now,
    });
  }

  /**
   * A venue's extra site, invoiced once at its price, due 7 days later, as an onboarding charge is
   * (slice 5). Run in the transaction that adds the site, holding the business row; the caller
   * tells the owners once it commits (`chargeChanged`).
   */
  issueSlot(
    tx: Prisma.TransactionClient,
    slot: { businessId: string; venueId: string; host: string; priceTsh: number },
    now = new Date(),
  ): Promise<InvoiceRow | null> {
    return this.create(tx, {
      businessId: slot.businessId,
      kind: "site_slot",
      period: null,
      venueId: slot.venueId,
      dueOn: addDays(businessDayOf(now), CHARGE_DUE_DAYS),
      lines: [
        {
          venueId: slot.venueId,
          label: slot.host,
          onboardingKind: null,
          netSalesTsh: null,
          servedBp: null,
          minimumTsh: null,
          amountTsh: slot.priceTsh,
        },
      ],
      now,
    });
  }

  /**
   * Withdraws an unpaid invoice in the caller's transaction, which has checked that nothing was
   * paid on it: it is kept with its number as history and is never owed again. The owners hear
   * once it commits (`chargeChanged`).
   */
  cancel(tx: Prisma.TransactionClient, id: string, reason: string, now = new Date()) {
    return tx.invoice.update({
      where: { id },
      data: { cancelledAt: now, cancelReason: reason },
      include: INVOICE_INCLUDE,
    });
  }

  /**
   * After a one-off charge was issued, changed or cancelled: its owners hear which, and their bill
   * issue follows.
   */
  async chargeChanged(businessId: string, ...invoices: (InvoiceRow | null)[]): Promise<void> {
    for (const invoice of invoices) if (invoice) await this.emailOwners(invoice);
    await this.reminders.syncBillIssues(businessId);
  }

  /** Confirmed packages with a charge and no invoice: what a crash between the two left behind. */
  async issueMissingOnboarding(now = new Date()): Promise<void> {
    const missing = await this.db.venueOnboarding.findMany({
      where: {
        confirmedAt: { not: null },
        lines: { some: { amountTsh: { gt: 0 } } },
        venue: { invoices: { none: { kind: "onboarding", cancelledAt: null } } },
      },
      select: { venueId: true },
    });
    for (const m of missing) {
      const invoice = await this.db.$transaction((tx) => this.syncOnboarding(m.venueId, tx, now));
      if (invoice) await this.chargeChanged(invoice.businessId, invoice);
    }
  }

  /** A new invoice with the next number, or null when one already holds its place. */
  private async create(
    tx: Prisma.TransactionClient,
    input: {
      businessId: string;
      kind: InvoiceKind;
      period: Date | null;
      venueId: string | null;
      dueOn: string;
      lines: {
        venueId: string | null;
        label: string;
        onboardingKind: OnboardingLineKind | null;
        netSalesTsh: number | null;
        servedBp: number | null;
        minimumTsh: number | null;
        amountTsh: number;
      }[];
      now: Date;
    },
  ): Promise<InvoiceRow | null> {
    try {
      const [next] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('invoice_number_seq') AS n`;
      const month = businessDayOf(input.now).slice(0, 7);
      return await tx.invoice.create({
        data: {
          number: `INV-${month}-${String(next?.n ?? 0).padStart(4, "0")}`,
          businessId: input.businessId,
          kind: input.kind,
          period: input.period,
          venueId: input.venueId,
          issuedAt: input.now,
          dueOn: new Date(`${input.dueOn}T00:00:00Z`),
          totalTsh: input.lines.reduce((sum, l) => sum + l.amountTsh, 0),
          lines: { create: input.lines.map((l, position) => ({ ...l, position })) },
        },
        include: INVOICE_INCLUDE,
      });
    } catch (err) {
      // Another run issued it first: once a month, once a venue.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
      throw err;
    }
  }

  /** An invoice as issued, or its cancellation and why, emailed to its owners. */
  private emailOwners(invoice: InvoiceRow): Promise<void> {
    const record = invoiceRecord(invoice, new Date());
    const reason = invoice.cancelReason;
    return this.ownerMail.send(invoice.businessId, (to, billing) =>
      reason === null
        ? invoiceEmail(to, record, billing)
        : cancelledEmail(to, record, reason, billing),
    );
  }
}
