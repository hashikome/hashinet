import type {
  FeeTerms,
  InvoiceLineRecord,
  InvoiceRecord,
  InvoiceState,
  OnboardingLineKind,
} from "@hashinet/types";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Principal } from "../access/principal.js";
import { businessDayOf, businessDayStart } from "../analytics/business-day.js";
import { REVENUE_EVENTS } from "../analytics/revenue-events.js";
import { AuditLog } from "../audit/audit-log.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { EMAIL_SENDER, type EmailSender } from "../email/email-sender.js";
import { Prisma } from "../generated/prisma/client.js";
import { apiError } from "../http/error-envelope.js";
import { captureFailure } from "../observability/telemetry.js";
import { passedSetup } from "../routers/router-journey.js";
import { businessFeeTerms } from "./billing-settings.js";
import { type Span, servedShare, venueFee } from "./fee.js";
import { invoiceEmail, reminderEmail } from "./invoice-emails.js";

/** HashiNet bills from November 2026, the first month its fees ran; no earlier month is invoiced. */
export const BILLING_STARTS = "2026-11-01";
/** A month's invoice is due on this day of the next month; a one-off charge 7 days after it. */
const MONTH_DUE_DAY = 7;
const CHARGE_DUE_DAYS = 7;

/** "2026-12-01" from "2026-11-01": the first day of the month after. */
export function nextMonth(firstDay: string): string {
  const [y, m] = firstDay.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** The first day of the month a business day falls in. */
const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

/** A day `n` days after another, both YYYY-MM-DD. */
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A DATE column as YYYY-MM-DD; Prisma reads it as midnight UTC. */
const dayOf = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Where an invoice stands on `today`: paid in full, or overdue once its due date has passed with
 * anything left, whatever came in (ADR-0013, 6).
 */
export function invoiceState(totalTsh: number, paidTsh: number, dueOn: string, today: string) {
  if (paidTsh >= totalTsh) return "paid" satisfies InvoiceState;
  if (today > dueOn) return "overdue" satisfies InvoiceState;
  return paidTsh > 0 ? ("part_paid" satisfies InvoiceState) : ("due" satisfies InvoiceState);
}

const INVOICE_INCLUDE = {
  business: { select: { name: true } },
  venue: { select: { name: true } },
  lines: { orderBy: { position: "asc" } },
  allocations: {
    include: { payment: { select: { receivedOn: true, method: true, reference: true } } },
    orderBy: { payment: { receivedOn: "asc" } },
  },
} as const satisfies Prisma.InvoiceInclude;
type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

/**
 * What businesses owe HashiNet (ADR-0013, 3 and 6): each month's fees, issued once on the 1st for
 * the month before, and a venue's onboarding charge, issued when its package is confirmed. An
 * invoice is kept as issued.
 */
@Injectable()
export class Invoices {
  constructor(
    private readonly db: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly audit: AuditLog,
  ) {}

  /**
   * Issues every business's invoice for the month starting `period` (YYYY-MM-01), once each: a
   * business already invoiced for it, or owing nothing, gets none. Returns how many were issued.
   */
  async issueMonth(period: string, now = new Date()): Promise<number> {
    const from = businessDayStart(period);
    const to = businessDayStart(nextMonth(period));
    const sales = await this.db.$queryRaw<{ venue_id: string; net: string }[]>`
      WITH ${REVENUE_EVENTS}
      SELECT venue_id, COALESCE(SUM(amount), 0)::numeric(14,2)::text AS net
      FROM revenue_events
      WHERE occurred_at >= ${from} AND occurred_at < ${to} AND venue_id IS NOT NULL
      GROUP BY venue_id`;
    const netOf = new Map(sales.map((s) => [s.venue_id, Math.round(Number(s.net))]));
    const already = new Set(
      (
        await this.db.invoice.findMany({
          where: { period: new Date(`${period}T00:00:00Z`) },
          select: { businessId: true },
        })
      ).map((i) => i.businessId),
    );
    const businesses = await this.db.business.findMany({
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
      if (already.has(business.id)) continue;
      const terms = businessFeeTerms(business);
      const lines = business.venues.flatMap((venue) => {
        const line = this.venueLine(venue, netOf.get(venue.id) ?? 0, terms, period, from, to, now);
        return line ? [line] : [];
      });
      const total = lines.reduce((sum, l) => sum + l.amountTsh, 0);
      if (total <= 0) continue;
      const invoice = await this.create({
        businessId: business.id,
        kind: "monthly_fees",
        period: new Date(`${period}T00:00:00Z`),
        venueId: null,
        dueOn: `${nextMonth(period).slice(0, 8)}${String(MONTH_DUE_DAY).padStart(2, "0")}`,
        lines,
        now,
      });
      if (invoice) {
        issued++;
        await this.emailOwners(invoice);
      }
    }
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
    period: string,
    from: Date,
    to: Date,
    now: Date,
  ) {
    const setUp = venue.routers.filter((r) => passedSetup(r.lastSetup));
    const completed = venue.onboarding?.completedAt ?? null;
    // The minimum counts from the first full month after the venue's setup, while a router serves.
    const minimumApplies =
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
   * Issues, or brings up to date, a venue's onboarding invoice once its package is confirmed: one
   * line per package line, due 7 days later. A package that is free has none. Run after the
   * confirmation commits; the job catches one a crash left behind.
   */
  async issueOnboarding(venueId: string, now = new Date()): Promise<void> {
    const onboarding = await this.db.venueOnboarding.findUnique({
      where: { venueId },
      include: { lines: { orderBy: { position: "asc" } }, venue: { select: { businessId: true } } },
    });
    if (!onboarding?.confirmedAt) return;
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
    const existing = await this.db.invoice.findFirst({ where: { kind: "onboarding", venueId } });
    const dueOn = addDays(businessDayOf(onboarding.confirmedAt), CHARGE_DUE_DAYS);
    if (existing) {
      // Anything paid on it, and it stays as it is: the package no longer changes.
      if (await this.db.billAllocation.count({ where: { invoiceId: existing.id } })) return;
      if (total <= 0) {
        await this.db.invoice.delete({ where: { id: existing.id } });
        return;
      }
      const same = existing.totalTsh === total && dayOf(existing.dueOn) === dueOn;
      if (same) return;
      // Changed on the call before it was paid: the same invoice, its lines as agreed now.
      const updated = await this.db.invoice.update({
        where: { id: existing.id },
        data: {
          totalTsh: total,
          dueOn: new Date(`${dueOn}T00:00:00Z`),
          lines: { deleteMany: {}, create: lines.map((l, position) => ({ ...l, position })) },
        },
        include: INVOICE_INCLUDE,
      });
      await this.emailOwners(updated);
      return;
    }
    if (total <= 0) return;
    const invoice = await this.create({
      businessId: onboarding.venue.businessId,
      kind: "onboarding",
      period: null,
      venueId,
      dueOn,
      lines,
      now,
    });
    if (invoice) await this.emailOwners(invoice);
  }

  /** Confirmed packages with a charge and no invoice: what a crash between the two left behind. */
  async issueMissingOnboarding(now = new Date()): Promise<void> {
    const missing = await this.db.venueOnboarding.findMany({
      where: {
        confirmedAt: { not: null },
        lines: { some: { amountTsh: { gt: 0 } } },
        venue: { invoices: { none: { kind: "onboarding" } } },
      },
      select: { venueId: true },
    });
    for (const m of missing) await this.issueOnboarding(m.venueId, now);
  }

  /** A new invoice with the next number, or null when one already holds its place. */
  private async create(input: {
    businessId: string;
    kind: "monthly_fees" | "onboarding";
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
  }): Promise<InvoiceRow | null> {
    try {
      return await this.db.$transaction(async (tx) => {
        const [next] = await tx.$queryRaw<
          { n: bigint }[]
        >`SELECT nextval('invoice_number_seq') AS n`;
        const month = businessDayOf(input.now).slice(0, 7);
        return tx.invoice.create({
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
      });
    } catch (err) {
      // Another run issued it first: once a month, once a venue.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
      throw err;
    }
  }

  /** The owners of the business hear of it by email; a failure to send is reported, not fatal. */
  private async emailOwners(invoice: InvoiceRow): Promise<void> {
    const owners = await this.db.membership.findMany({
      where: { businessId: invoice.businessId, role: "owner", status: "active" },
      select: { user: { select: { email: true } } },
    });
    const record = this.record(invoice, new Date());
    for (const o of owners) {
      void this.email
        .send(invoiceEmail(o.user.email, record, `${this.config.frontendOrigin}/billing`))
        .catch(captureFailure);
    }
  }

  /** What a business still owes, oldest first. */
  private async owing(businessId: string, now: Date): Promise<InvoiceRecord[]> {
    const rows = await this.db.invoice.findMany({
      where: { businessId },
      include: INVOICE_INCLUDE,
      orderBy: [{ dueOn: "asc" }, { issuedAt: "asc" }],
    });
    return rows.map((row) => this.record(row, now)).filter((i) => i.dueTsh > 0);
  }

  /** Emails a business's owners what they owe, on request (ADR-0013, 6). */
  async remind(staff: Principal, businessId: string): Promise<void> {
    const now = new Date();
    const owed = await this.owing(businessId, now);
    if (owed.length === 0) {
      throw new ConflictException(apiError("CONFLICT", "Nothing is owed."));
    }
    await this.sendReminder(businessId, owed);
    await this.audit.record(staff, {
      action: "billing.remind",
      businessId,
      venueId: null,
      target: { type: "business", id: businessId },
      change: {
        before: {},
        after: { owedTsh: owed.reduce((sum, i) => sum + i.dueTsh, 0) },
      },
    });
  }

  /** On its due date, an invoice left unpaid reminds its owners, once. */
  async remindDue(now = new Date()): Promise<void> {
    const today = new Date(`${businessDayOf(now)}T00:00:00Z`);
    const rows = await this.db.invoice.findMany({
      where: { dueRemindedAt: null, dueOn: { lte: today } },
      include: INVOICE_INCLUDE,
    });
    for (const row of rows) {
      const claimed = await this.db.invoice.updateMany({
        where: { id: row.id, dueRemindedAt: null },
        data: { dueRemindedAt: now },
      });
      if (claimed.count === 0) continue;
      const invoice = this.record(row, now);
      if (invoice.dueTsh > 0) await this.sendReminder(row.businessId, [invoice]);
    }
  }

  private async sendReminder(businessId: string, owed: InvoiceRecord[]): Promise<void> {
    const owners = await this.db.membership.findMany({
      where: { businessId, role: "owner", status: "active" },
      select: { user: { select: { email: true } } },
    });
    for (const o of owners) {
      void this.email
        .send(reminderEmail(o.user.email, owed, `${this.config.frontendOrigin}/billing`))
        .catch(captureFailure);
    }
  }

  /** A business's invoices, newest first: the owner's own, or any business's for HashiNet's staff. */
  async list(staff: Principal, businessId: string | null): Promise<InvoiceRecord[]> {
    const id = this.businessOf(staff, businessId);
    const rows = await this.db.invoice.findMany({
      where: { businessId: id },
      include: INVOICE_INCLUDE,
      orderBy: { issuedAt: "desc" },
    });
    const now = new Date();
    return rows.map((row) => this.record(row, now));
  }

  async get(staff: Principal, id: string): Promise<InvoiceRecord> {
    const row = await this.db.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
    if (!row || (staff.scope === "business" && row.businessId !== staff.businessId)) {
      throw new NotFoundException(apiError("NOT_FOUND", "There is no such invoice."));
    }
    return this.record(row, new Date());
  }

  /** The business a reader asks about: an owner only ever their own. */
  private businessOf(staff: Principal, asked: string | null): string {
    if (staff.scope === "business") {
      if (staff.businessId === null)
        throw new NotFoundException(apiError("NOT_FOUND", "No business."));
      return staff.businessId;
    }
    if (asked === null) {
      throw new NotFoundException(apiError("NOT_FOUND", "Name the business: ?businessId=…"));
    }
    return asked;
  }

  private record(row: InvoiceRow, now: Date): InvoiceRecord {
    const dueOn = dayOf(row.dueOn);
    const paidTsh = row.allocations.reduce((sum, a) => sum + a.amountTsh, 0);
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
      period: row.period === null ? null : dayOf(row.period).slice(0, 7),
      venueName: row.kind === "onboarding" ? (row.venue?.name ?? null) : null,
      issuedAt: row.issuedAt.toISOString(),
      dueOn,
      totalTsh: row.totalTsh,
      paidTsh,
      dueTsh: row.totalTsh - paidTsh,
      state: invoiceState(row.totalTsh, paidTsh, dueOn, businessDayOf(now)),
      lines,
      payments: row.allocations.map((a) => ({
        receivedOn: dayOf(a.payment.receivedOn),
        method: a.payment.method,
        reference: a.payment.reference,
        amountTsh: a.amountTsh,
      })),
    };
  }
}
