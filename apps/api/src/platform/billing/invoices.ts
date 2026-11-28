import type {
  BillingAccount,
  BillingOverview,
  BillingProfile,
  BillingRow,
  BillState,
  FeeTerms,
  InvoiceLineRecord,
  InvoiceRecord,
  InvoiceResponse,
  OnboardingLineKind,
} from "@hashinet/types";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { REVENUE_EVENTS } from "../../analytics/revenue-events.js";
import type { Principal } from "../../core/access/principal.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
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
import { IssuesService } from "../issues/issues.service.js";
import { BillingSettings, businessFeeTerms } from "./billing-settings.js";
import { lockBusiness, paidOf } from "./business-lock.js";
import { type Span, servedShare, venueFee } from "./fee.js";
import { cancelledEmail, invoiceEmail, reminderEmail } from "./invoice-emails.js";
import { invoiceSummary } from "./invoice-state.js";
import { OWNERS, OwnerMail } from "./owner-mail.js";
import { ServiceAccessService } from "./service-access.js";

/** HashiNet bills from November 2026, the first month its fees ran; no earlier month is invoiced. */
export const BILLING_STARTS = "2026-11-01";
/** A month's invoice is due on this day of the next month; a one-off charge 7 days after it. */
const MONTH_DUE_DAY = 7;
const CHARGE_DUE_DAYS = 7;

/** The order a payment on a business settles its invoices in: the oldest due first. */
const OLDEST_FIRST = [
  { dueOn: "asc" },
  { issuedAt: "asc" },
] as const satisfies Prisma.InvoiceOrderByWithRelationInput[];

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
    private readonly audit: AuditLog,
    private readonly settings: BillingSettings,
    private readonly issues: IssuesService,
    private readonly access: ServiceAccessService,
    private readonly ownerMail: OwnerMail,
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
    if (issued > 0) await this.syncBillIssues(null, now);
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
    await this.syncBillIssues(businessId);
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
    const record = this.record(invoice, new Date());
    const reason = invoice.cancelReason;
    return this.ownerMail.send(invoice.businessId, (to, billing) =>
      reason === null
        ? invoiceEmail(to, record, billing)
        : cancelledEmail(to, record, reason, billing),
    );
  }

  /**
   * Each business's bill issue, for its owner: open while anything is owed, saying whether any of
   * it is overdue, and resolved once it is paid. `businessId` keeps one business in step at once.
   */
  async syncBillIssues(businessId: string | null = null, now = new Date()): Promise<void> {
    const rows = await this.db.invoice.findMany({
      where: { cancelledAt: null, ...(businessId ? { businessId } : {}) },
      select: {
        businessId: true,
        totalTsh: true,
        dueOn: true,
        cancelledAt: true,
        allocations: { select: { amountTsh: true } },
      },
    });
    const owing = new Map<string, "due" | "overdue">();
    for (const row of rows) {
      const paid = paidOf(row);
      const invoice = {
        businessId: row.businessId,
        ...invoiceSummary(row, paid, now),
      };
      if (invoice.dueTsh <= 0) continue;
      const was = owing.get(invoice.businessId);
      owing.set(
        invoice.businessId,
        was === "overdue" || invoice.state === "overdue" ? "overdue" : "due",
      );
    }
    const open = await this.db.issue.findMany({
      where: { kind: "bill_due", status: "open", ...(businessId ? { businessId } : {}) },
      select: { id: true, businessId: true, cause: true },
    });
    const businesses = new Set([...owing.keys(), ...open.flatMap((i) => i.businessId ?? [])]);
    for (const id of businesses) {
      const state = owing.get(id);
      await this.issues.keep(
        { scope: "business", businessId: id },
        `bill:${id}`,
        open.find((i) => i.businessId === id) ?? null,
        state
          ? { kind: "bill_due", venueId: null, routerId: null, holderId: null, cause: state }
          : null,
        { reason: "paid" },
      );
    }
  }

  /** What a business still owes, oldest first. */
  private async owing(businessId: string, now: Date): Promise<InvoiceRecord[]> {
    const rows = await this.db.invoice.findMany({
      where: { businessId, cancelledAt: null },
      include: INVOICE_INCLUDE,
      orderBy: OLDEST_FIRST,
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
      where: { dueRemindedAt: null, cancelledAt: null, dueOn: { lte: today } },
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

  private sendReminder(businessId: string, owed: InvoiceRecord[]): Promise<void> {
    return this.ownerMail.send(businessId, (to, billing) => reminderEmail(to, owed, billing));
  }

  /** Who a business is, who is billed, its terms, and where it pays: a bill's and an invoice's header. */
  private async profile(id: string): Promise<BillingProfile> {
    const [business, settings] = await Promise.all([
      this.db.business.findUnique({
        where: { id },
        include: {
          memberships: {
            where: OWNERS,
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { user: { select: { name: true, email: true } } },
          },
        },
      }),
      this.settings.get(),
    ]);
    if (!business) throw new NotFoundException(apiError("NOT_FOUND", "There is no such business."));
    return {
      business: { id, name: business.name, region: business.region, area: business.area },
      owner: business.memberships[0]?.user ?? null,
      terms: businessFeeTerms(business),
      payTo: settings.payTo,
    };
  }

  /** A business's account: a bill for HashiNet's staff, or the owner's own Billing. */
  async account(staff: Principal, businessId: string | null): Promise<BillingAccount> {
    const id = this.businessOf(staff, businessId);
    const now = new Date();
    const [profile, rows, owed, access] = await Promise.all([
      this.profile(id),
      this.db.invoice.findMany({
        where: { businessId: id },
        include: INVOICE_INCLUDE,
        orderBy: { issuedAt: "desc" },
      }),
      this.owing(id, now),
      this.access.state(id, true, now),
    ]);
    const invoices = rows.map((row) => this.record(row, now));
    const sum = (list: InvoiceRecord[], f: (i: InvoiceRecord) => number) =>
      list.reduce((total, i) => total + f(i), 0);
    return {
      ...profile,
      paidTsh: sum(invoices, (i) => i.paidTsh),
      dueTsh: sum(owed, (i) => i.dueTsh),
      overdueTsh: sum(
        owed.filter((i) => i.state === "overdue"),
        (i) => i.dueTsh,
      ),
      owed,
      invoices,
      access,
    };
  }

  /**
   * Every business's bill for the months `from` to `to` (YYYY-MM): its net sales, the months'
   * fees invoiced, one-off charges issued then or still unpaid, what was paid on them and what is
   * due (the platform's Payments).
   */
  async overview(asked: { from: string; to: string } | null): Promise<BillingOverview> {
    const now = new Date();
    // Unasked, the month in progress.
    const { from, to } = asked ?? {
      from: businessDayOf(now).slice(0, 7),
      to: businessDayOf(now).slice(0, 7),
    };
    const first = `${from}-01`;
    const after = nextMonth(`${to}-01`);
    const thisMonth = monthOf(businessDayOf(now));
    const [sales, businesses, rows] = await Promise.all([
      this.db.$queryRaw<{ business_id: string; net: string }[]>`
        WITH ${REVENUE_EVENTS}
        SELECT v.business_id, COALESCE(SUM(e.amount), 0)::numeric(14,2)::text AS net
        FROM revenue_events e JOIN venues v ON v.id = e.venue_id
        WHERE e.occurred_at >= ${businessDayStart(first)} AND e.occurred_at < ${businessDayStart(after)}
        GROUP BY v.business_id`,
      this.db.business.findMany({
        orderBy: { name: "asc" },
        include: {
          memberships: {
            where: { role: "owner", status: "active" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { user: { select: { name: true } } },
          },
          venues: { select: { routers: { select: { lastSetup: true } } } },
        },
      }),
      // The months' fees in the period, and every one-off charge: those issued in it, or unpaid.
      this.db.invoice.findMany({
        where: {
          OR: [
            {
              kind: "monthly_fees",
              period: { gte: new Date(`${first}T00:00:00Z`), lt: new Date(`${after}T00:00:00Z`) },
            },
            // One-off charges: a venue's package, an extra site.
            { kind: { not: "monthly_fees" } },
          ],
        },
        include: INVOICE_INCLUDE,
      }),
    ]);
    const salesOf = new Map(sales.map((s) => [s.business_id, Math.round(Number(s.net))]));
    // What each business owes in all, whatever the period: a payment on it settles that.
    const owedOf = new Map(
      (
        await this.db.$queryRaw<{ business_id: string; owed: number }[]>`
          SELECT i.business_id, SUM(i.total_tsh - COALESCE(a.paid, 0))::int AS owed
          FROM invoices i
          LEFT JOIN (SELECT invoice_id, SUM(amount_tsh) AS paid FROM bill_allocations GROUP BY invoice_id) a
            ON a.invoice_id = i.id
          WHERE i.cancelled_at IS NULL AND i.total_tsh > COALESCE(a.paid, 0)
          GROUP BY i.business_id`
      ).map((r) => [r.business_id, r.owed]),
    );
    const byBusiness = new Map<string, InvoiceRecord[]>();
    for (const record of rows.map((row) => this.record(row, now))) {
      byBusiness.set(record.businessId, [...(byBusiness.get(record.businessId) ?? []), record]);
    }
    // A month's fees in their month; a one-off charge from the month it was issued, and in every
    // later one while it is unpaid, never in one before it.
    const inPeriod = (i: InvoiceRecord) => {
      if (i.kind === "monthly_fees") return i.period !== null && i.period >= from && i.period <= to;
      const issued = businessDayOf(new Date(i.issuedAt)).slice(0, 7);
      return issued <= to && (issued >= from || i.dueTsh > 0);
    };
    const openInPeriod = thisMonth >= first && thisMonth < after;

    const result: BillingRow[] = businesses.map((b) => {
      const terms = businessFeeTerms(b);
      const own = (byBusiness.get(b.id) ?? []).filter(inPeriod);
      const months = own.filter((i) => i.kind === "monthly_fees");
      const oneOff = own.filter((i) => i.kind !== "monthly_fees");
      const sum = (list: InvoiceRecord[], f: (i: InvoiceRecord) => number) =>
        list.reduce((total, i) => total + f(i), 0);
      // A cancelled invoice is listed, never billed.
      const live = own.filter((i) => i.state !== "cancelled");
      const billed = sum(live, (i) => i.totalTsh);
      const paid = sum(own, (i) => i.paidTsh);
      const due = sum(own, (i) => i.dueTsh);
      const overdue = sum(
        own.filter((i) => i.state === "overdue"),
        (i) => i.dueTsh,
      );
      const salesTsh = salesOf.get(b.id) ?? 0;
      const state: BillState =
        billed === 0
          ? openInPeriod && salesTsh > 0
            ? "open"
            : "no_fee"
          : overdue > 0
            ? "overdue"
            : due > 0
              ? paid > 0
                ? "part_paid"
                : "due"
              : "paid";
      const lines = months.flatMap((i) => i.lines);
      const feesTsh = sum(months, (i) => i.totalTsh);
      const lowerRate = lines.some((l) => (l.netSalesTsh ?? 0) > terms.lowerRateAboveTsh);
      return {
        businessId: b.id,
        name: b.name,
        ownerName: b.memberships[0]?.user.name ?? null,
        venues: b.venues.filter((v) => v.routers.some((r) => passedSetup(r.lastSetup))).length,
        salesTsh,
        feesTsh,
        oneOffTsh: sum(
          oneOff.filter((i) => i.state !== "cancelled"),
          (i) => i.totalTsh,
        ),
        billedTsh: billed,
        paidTsh: paid,
        dueTsh: due,
        overdueTsh: overdue,
        owedTsh: owedOf.get(b.id) ?? 0,
        state,
        monthsBilled: months.length,
        monthsPaid: months.filter((i) => i.state === "paid").length,
        // What its fees came to as a share of its sales, where the lower band brought it down.
        rateBp:
          lowerRate && salesTsh > 0 ? Math.round((feesTsh / salesTsh) * 10_000) : terms.rateBp,
        lowerRate,
        minimum: lines.some((l) => l.minimumTsh !== null),
      };
    });
    const total = (f: (r: BillingRow) => number) => result.reduce((sum, r) => sum + f(r), 0);
    const months: string[] = [];
    for (let m = BILLING_STARTS; m <= thisMonth; m = nextMonth(m)) months.push(m.slice(0, 7));
    return {
      from,
      to,
      months,
      invoicedOn: openInPeriod ? nextMonth(thisMonth) : null,
      rows: result,
      totals: {
        billedTsh: total((r) => r.billedTsh),
        paidTsh: total((r) => r.paidTsh),
        collectedBp:
          total((r) => r.billedTsh) > 0
            ? Math.round((total((r) => r.paidTsh) / total((r) => r.billedTsh)) * 10_000)
            : null,
        dueTsh: total((r) => r.dueTsh),
        overdueTsh: total((r) => r.overdueTsh),
        salesTsh: total((r) => r.salesTsh),
        venues: total((r) => r.venues),
        owing: result.filter((r) => r.dueTsh > 0).length,
        overdue: result.filter((r) => r.overdueTsh > 0).map((r) => r.name),
      },
    };
  }

  /** One invoice, with its business's header, for the invoice page in one request. */
  async get(staff: Principal, id: string): Promise<InvoiceResponse> {
    const row = await this.db.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
    if (!row || (staff.scope === "business" && row.businessId !== staff.businessId)) {
      throw new NotFoundException(apiError("NOT_FOUND", "There is no such invoice."));
    }
    return { invoice: this.record(row, new Date()), ...(await this.profile(row.businessId)) };
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
}
