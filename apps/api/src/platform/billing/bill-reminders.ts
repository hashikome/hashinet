import type { InvoiceRecord } from "@hashinet/types";
import { ConflictException, Injectable } from "@nestjs/common";
import type { Principal } from "../../core/access/principal.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { businessDayOf } from "../../core/time/business-day.js";
import { Prisma } from "../../generated/prisma/client.js";
import { IssuesService } from "../issues/issues.service.js";
import { paidOf } from "./business-lock.js";
import { reminderEmail } from "./invoice-emails.js";
import { INVOICE_INCLUDE, invoiceRecord } from "./invoice-record.js";
import { invoiceSummary } from "./invoice-state.js";
import { OwnerMail } from "./owner-mail.js";

/** The order a payment on a business settles its invoices in: the oldest due first. */
const OLDEST_FIRST = [
  { dueOn: "asc" },
  { issuedAt: "asc" },
] as const satisfies Prisma.InvoiceOrderByWithRelationInput[];

/** Each owner's bill issue and the reminders for invoices due (ADR-0013, 6). */
@Injectable()
export class BillReminders {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly issues: IssuesService,
    private readonly ownerMail: OwnerMail,
  ) {}

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
  async owing(businessId: string, now: Date): Promise<InvoiceRecord[]> {
    const rows = await this.db.invoice.findMany({
      where: { businessId, cancelledAt: null },
      include: INVOICE_INCLUDE,
      orderBy: OLDEST_FIRST,
    });
    return rows.map((row) => invoiceRecord(row, now)).filter((i) => i.dueTsh > 0);
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
      const invoice = invoiceRecord(row, now);
      if (invoice.dueTsh > 0) await this.sendReminder(row.businessId, [invoice]);
    }
  }

  private sendReminder(businessId: string, owed: InvoiceRecord[]): Promise<void> {
    return this.ownerMail.send(businessId, (to, billing) => reminderEmail(to, owed, billing));
  }
}
