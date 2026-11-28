import type {
  BillingAccount,
  BillingOverview,
  BillingProfile,
  BillingRow,
  BillState,
  InvoiceRecord,
  InvoiceResponse,
} from "@hashinet/types";
import { Injectable, NotFoundException } from "@nestjs/common";
import { REVENUE_EVENTS } from "../../analytics/revenue-events.js";
import type { Principal } from "../../core/access/principal.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import {
  businessDayOf,
  businessDayStart,
  monthOf,
  nextMonth,
} from "../../core/time/business-day.js";
import { passedSetup } from "../../network/routers/router-journey.js";
import { BillReminders } from "./bill-reminders.js";
import { BillingSettings, businessFeeTerms } from "./billing-settings.js";
import { INVOICE_INCLUDE, invoiceRecord } from "./invoice-record.js";
import { BILLING_STARTS } from "./invoices.js";
import { OWNERS } from "./owner-mail.js";
import { ServiceAccessService } from "./service-access.js";

/** What Billing shows: a business's account, HashiNet's overview, and one invoice. */
@Injectable()
export class BillingAccounts {
  constructor(
    private readonly db: PrismaService,
    private readonly settings: BillingSettings,
    private readonly access: ServiceAccessService,
    private readonly reminders: BillReminders,
  ) {}

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
      this.reminders.owing(id, now),
      this.access.state(id, true, now),
    ]);
    const invoices = rows.map((row) => invoiceRecord(row, now));
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
    for (const record of rows.map((row) => invoiceRecord(row, now))) {
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
    return { invoice: invoiceRecord(row, new Date()), ...(await this.profile(row.businessId)) };
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
}
