import type {
  ServiceAccess,
  ServiceAccessChangeRecord,
  ServiceAccessDetail,
  ServiceAccessState,
} from "@hashinet/types";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { allows } from "../../core/access/policy.js";
import type { Principal } from "../../core/access/principal.js";
import { sellingStopped } from "../../core/access/service-pause.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { oneLine } from "../../core/http/validation.js";
import { addDays, businessDayOf, dateOf } from "../../core/time/business-day.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { IssuesService } from "../issues/issues.service.js";
import { accessByBillsEmail, accessByHandEmail } from "./access-emails.js";
import { type AccessByBills, accessByBills, type FeesBill } from "./access-rule.js";
import { lockBusiness } from "./business-lock.js";
import { OwnerMail } from "./owner-mail.js";

const REASONS = [
  "payment_overdue",
  "payment_received",
  "payment_arranged",
  "policy_violation",
  "customer_request",
  "contract_ended",
  "issue_resolved",
  "other",
] as const;
const told = {
  reason: z.enum(REASONS),
  /** For HashiNet's team: kept in the history, never emailed. */
  note: oneLine(500).min(1, "is required"),
  /** To the owners, with the change. */
  message: oneLine(500)
    .default("")
    .transform((m) => m || null),
};

/** HashiNet's team sets a business's access by hand, or gives it back to its bills. */
export const accessChangeInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("bills"), ...told }),
  z.object({
    mode: z.literal("hold"),
    access: z.enum(["enabled", "grace_period", "read_only", "suspended"]),
    /** How many days it holds, today included; null until someone changes it. */
    days: z
      .union([z.literal(7), z.literal(14), z.literal(30)])
      .nullable()
      .default(null),
    ...told,
  }),
]);

/** Worse to better, so a change by its bills says whether a payment was missed or received. */
const RANK: Record<ServiceAccess, number> = {
  enabled: 0,
  grace_period: 1,
  read_only: 2,
  suspended: 3,
};

/** The changes ADR-0014, 2 allows by hand; any other is the admin's audited override. */
const ALLOWED: Record<ServiceAccess, ServiceAccess[]> = {
  enabled: ["grace_period", "read_only", "suspended"],
  grace_period: ["enabled", "read_only", "suspended"],
  read_only: ["enabled", "suspended"],
  suspended: ["enabled"],
};

const BILLS = {
  where: { kind: "monthly_fees" },
  select: {
    dueOn: true,
    totalTsh: true,
    allocations: { select: { amountTsh: true, payment: { select: { receivedOn: true } } } },
  },
} as const satisfies Prisma.Business$invoicesArgs;

type BillRows = Prisma.InvoiceGetPayload<{ select: (typeof BILLS)["select"] }>[];

function billsOf(rows: BillRows): FeesBill[] {
  return rows.map((i) => ({
    dueOn: dateOf(i.dueOn),
    totalTsh: i.totalTsh,
    payments: i.allocations.map((a) => ({
      amountTsh: a.amountTsh,
      receivedOn: dateOf(a.payment.receivedOn),
    })),
  }));
}

/** A business day as the date column stores it. */
const dayDate = (day: string | null) => (day ? new Date(`${day}T00:00:00Z`) : null);

/** When its bills pause selling: only while it follows them, in a grace period that ends so. */
const pausesOnOf = (held: boolean, byBills: AccessByBills) =>
  !held && byBills.access === "grace_period" ? byBills.pausesOn : null;

const notFound = () => new NotFoundException(apiError("NOT_FOUND", "There is no such business."));

/**
 * Service access (ADR-0014, 2): a business's access follows its bills by itself, from a grace period
 * to read-only and back, and never further; HashiNet's team holds it at a state by hand along the
 * allowed changes, any other being the admin's override and suspension the admin's alone. Each change
 * is recorded under a lock on the business, and its owners are emailed; its managers get an issue
 * while selling pauses or is about to.
 */
@Injectable()
export class ServiceAccessService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly issues: IssuesService,
    private readonly ownerMail: OwnerMail,
  ) {}

  /** Every business, or one, brought in step with its bills and holds. Hourly, and after a payment. */
  async sync(businessId: string | null = null, now = new Date()): Promise<void> {
    const today = businessDayOf(now);
    const rows = await this.db.business.findMany({
      where: { status: "active", ...(businessId ? { id: businessId } : {}) },
      select: { id: true, name: true, invoices: BILLS },
    });
    // Its managers' open issues, read once for the run rather than once a business.
    const open = new Map(
      (
        await this.db.issue.findMany({
          where: { kind: "selling_paused", status: "open", ...(businessId ? { businessId } : {}) },
          select: { id: true, businessId: true, cause: true },
        })
      ).map((i) => [i.businessId, i]),
    );
    for (const b of rows) {
      const byBills = accessByBills(billsOf(b.invoices), today);
      // Under the business's lock, read fresh: a hold set meanwhile, or another run, wins.
      const step = await this.db.$transaction(async (tx) => {
        await lockBusiness(tx, b.id);
        const cur = await tx.business.findUniqueOrThrow({
          where: { id: b.id },
          select: { access: true, accessHeld: true, accessHeldUntil: true, accessPausesOn: true },
        });
        // A hold runs to the end of its last day, then the business follows its bills again.
        const held =
          cur.accessHeld && (cur.accessHeldUntil === null || dateOf(cur.accessHeldUntil) >= today);
        const holdEnded = cur.accessHeld && !held;
        const access = held ? cur.access : byBills.access;
        const pausesOn = pausesOnOf(held, byBills);
        const changed = access !== cur.access;
        const pausesWas = cur.accessPausesOn ? dateOf(cur.accessPausesOn) : null;
        if (changed || holdEnded || pausesWas !== pausesOn) {
          await tx.business.update({
            where: { id: b.id },
            data: {
              access,
              ...(changed ? { accessSince: now } : {}),
              accessHeld: held,
              ...(held ? {} : { accessHeldUntil: null }),
              accessPausesOn: dayDate(pausesOn),
            },
          });
        }
        if (changed || holdEnded) {
          await tx.serviceAccessChange.create({
            data: {
              businessId: b.id,
              access,
              held: false,
              // A hold ending back to normal resolved what it was for; otherwise the bills moved it.
              reason:
                holdEnded && access === "enabled"
                  ? "issue_resolved"
                  : RANK[access] > RANK[cur.access]
                    ? "payment_overdue"
                    : "payment_received",
              at: now,
            },
          });
        }
        return { from: cur.access, access, pausesOn, tell: changed || holdEnded, holdEnded };
      });
      if (step.tell) {
        await this.ownerMail.send(b.id, (to, billing) =>
          accessByBillsEmail(
            to,
            b.name,
            { from: step.from, holdEnded: step.holdEnded, byBills },
            billing,
          ),
        );
      }
      await this.syncIssue(b.id, step.access, step.pausesOn, open.get(b.id) ?? null);
    }
  }

  /** HashiNet's team sets it by hand, or gives it back to its bills. */
  async change(
    staff: Principal,
    businessId: string,
    input: z.infer<typeof accessChangeInput>,
    now = new Date(),
  ): Promise<ServiceAccessDetail> {
    const today = businessDayOf(now);
    const result = await this.db.$transaction(async (tx) => {
      const locked = await lockBusiness(tx, businessId);
      if (!locked) throw notFound();
      const b = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { name: true, access: true, invoices: BILLS },
      });
      const byBills = accessByBills(billsOf(b.invoices), today);
      const hold = input.mode === "hold";
      const access = hold ? input.access : byBills.access;
      // Only the platform admin suspends; nothing suspends a business by itself (ADR-0014, 4).
      if (access === "suspended" && !allows(staff.role, "business.suspend")) {
        throw new ForbiddenException(
          apiError("FORBIDDEN", "Only the platform admin suspends a business."),
        );
      }
      if (
        access !== b.access &&
        !ALLOWED[b.access].includes(access) &&
        !allows(staff.role, "business.access.override")
      ) {
        throw new ForbiddenException(
          apiError("FORBIDDEN", "Only the platform admin makes this change, as an override."),
        );
      }
      const heldUntil = hold && input.days !== null ? addDays(today, input.days - 1) : null;
      const pausesOn = pausesOnOf(hold, byBills);
      await tx.business.update({
        where: { id: businessId },
        data: {
          access,
          ...(access !== b.access ? { accessSince: now } : {}),
          accessHeld: hold,
          accessHeldUntil: dayDate(heldUntil),
          accessPausesOn: dayDate(pausesOn),
        },
      });
      await tx.serviceAccessChange.create({
        data: {
          businessId,
          access,
          held: hold,
          heldUntil: dayDate(heldUntil),
          reason: input.reason,
          note: input.note,
          message: input.message,
          byId: staff.membershipId,
          at: now,
        },
      });
      await this.audit.record(
        staff,
        {
          action: "business.access",
          businessId,
          venueId: null,
          target: { type: "business", id: businessId },
          change: {
            before: { access: b.access },
            after: { access, held: hold, until: heldUntil, reason: input.reason },
          },
        },
        tx,
      );
      return { name: b.name, access, heldUntil, pausesOn };
    });
    const open = await this.db.issue.findFirst({
      where: { businessId, kind: "selling_paused", status: "open" },
      select: { id: true, cause: true },
    });
    await Promise.all([
      this.ownerMail.send(businessId, (to) =>
        accessByHandEmail(to, result.name, {
          access: result.access,
          heldUntil: result.heldUntil,
          reason: input.reason,
          message: input.message,
        }),
      ),
      this.syncIssue(businessId, result.access, result.pausesOn, open),
    ]);
    return this.detail(businessId, true, now);
  }

  /**
   * Its access now, with its bills' facts: what its owner's Billing says. `money` false leaves out
   * the amount, for a reader who doesn't see money.
   */
  async state(businessId: string, money: boolean, now = new Date()): Promise<ServiceAccessState> {
    const b = await this.db.business.findUnique({
      where: { id: businessId },
      select: {
        access: true,
        accessSince: true,
        accessHeld: true,
        accessHeldUntil: true,
        accessPausesOn: true,
        invoices: BILLS,
      },
    });
    if (!b) throw notFound();
    const byBills = accessByBills(billsOf(b.invoices), businessDayOf(now));
    const overdue = byBills.access !== "enabled";
    return {
      access: b.access,
      selling: !sellingStopped(b.access),
      since: b.accessSince?.toISOString() ?? null,
      held: b.accessHeld,
      heldUntil: b.accessHeldUntil ? dateOf(b.accessHeldUntil) : null,
      overdueSince: overdue ? byBills.overdueSince : null,
      overdueTsh: !money ? null : overdue ? byBills.overdueTsh : 0,
      lateBefore: overdue && byBills.lateBefore,
      pausesOn: b.accessPausesOn ? dateOf(b.accessPausesOn) : null,
    };
  }

  /** Its access now, and every change, newest first: HashiNet's team's view. */
  async detail(businessId: string, money: boolean, now = new Date()): Promise<ServiceAccessDetail> {
    const [state, rows] = await Promise.all([
      this.state(businessId, money, now),
      this.db.serviceAccessChange.findMany({
        where: { businessId },
        orderBy: { at: "desc" },
        include: { by: { select: { user: { select: { name: true } } } } },
      }),
    ]);
    const changes: ServiceAccessChangeRecord[] = rows.map((c) => ({
      id: c.id,
      access: c.access,
      held: c.held,
      heldUntil: c.heldUntil ? dateOf(c.heldUntil) : null,
      reason: c.reason,
      note: c.note,
      message: c.message,
      by: c.by?.user.name ?? null,
      at: c.at.toISOString(),
    }));
    return { ...state, changes };
  }

  /**
   * Its managers' issue: open while selling is paused, or about to pause on a set day, and resolved
   * once the business sells with nothing pending. The owner's is the bill issue.
   */
  private syncIssue(
    businessId: string,
    access: ServiceAccess,
    pausesOn: string | null,
    open: { id: string; cause: string | null } | null,
  ): Promise<void> {
    const wanted = sellingStopped(access) || pausesOn !== null;
    return this.issues.keep(
      { scope: "business", businessId },
      `selling:${businessId}`,
      open,
      wanted
        ? { kind: "selling_paused", venueId: null, routerId: null, holderId: null, cause: null }
        : null,
      { reason: "selling" },
    );
  }
}
