import type {
  ServiceAccess,
  ServiceAccessChangeRecord,
  ServiceAccessDetail,
  ServiceAccessState,
} from "@hashinet/types";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../access/principal.js";
import { businessDayOf, dateOf } from "../analytics/business-day.js";
import { AuditLog } from "../audit/audit-log.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { EMAIL_SENDER, type EmailMessage, type EmailSender } from "../email/email-sender.js";
import type { Prisma } from "../generated/prisma/client.js";
import { apiError } from "../http/error-envelope.js";
import { oneLine } from "../http/validation.js";
import { IssuesService } from "../issues/issues.service.js";
import { captureFailure } from "../observability/telemetry.js";
import { accessByBillsEmail, accessByHandEmail } from "./access-emails.js";
import { type AccessByBills, accessByBills, type FeesBill, sellingStopped } from "./access-rule.js";

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
    /** The last business day it holds; null until someone changes it. */
    until: z.iso.date().nullable().default(null),
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

const notFound = () => new NotFoundException(apiError("NOT_FOUND", "There is no such business."));

/**
 * Service access (ADR-0014, 2): a business's access follows its bills by itself, from a grace period
 * to read-only and back, and never further; HashiNet's team holds it at a state by hand, suspension
 * only by the platform admin. Each change is recorded and its owners are emailed; its managers get
 * an issue while selling pauses or is about to.
 */
@Injectable()
export class ServiceAccessService {
  constructor(
    private readonly db: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly audit: AuditLog,
    private readonly issues: IssuesService,
  ) {}

  /** Every business, or one, brought in step with its bills and holds. Hourly, and after a payment. */
  async sync(businessId: string | null = null, now = new Date()): Promise<void> {
    const today = businessDayOf(now);
    const rows = await this.db.business.findMany({
      where: { status: "active", ...(businessId ? { id: businessId } : {}) },
      select: {
        id: true,
        name: true,
        access: true,
        accessHeld: true,
        accessHeldUntil: true,
        accessPausesOn: true,
        invoices: BILLS,
      },
    });
    for (const b of rows) {
      const byBills = accessByBills(billsOf(b.invoices), today);
      // A hold runs to the end of its last day, then the business follows its bills again.
      const held =
        b.accessHeld && (b.accessHeldUntil === null || dateOf(b.accessHeldUntil) >= today);
      const access = held ? b.access : byBills.access;
      const pausesOn = held || byBills.access !== "grace_period" ? null : byBills.pausesOn;
      const changed = access !== b.access;
      const pausesChanged = (b.accessPausesOn ? dateOf(b.accessPausesOn) : null) !== pausesOn;
      if (changed || pausesChanged || held !== b.accessHeld) {
        await this.db.$transaction(async (tx) => {
          await tx.business.update({
            where: { id: b.id },
            data: {
              access,
              ...(changed ? { accessSince: now } : {}),
              accessHeld: held,
              ...(held ? {} : { accessHeldUntil: null }),
              accessPausesOn: pausesOn ? new Date(`${pausesOn}T00:00:00Z`) : null,
            },
          });
          if (changed) {
            await tx.serviceAccessChange.create({
              data: {
                businessId: b.id,
                access,
                held: false,
                reason: RANK[access] > RANK[b.access] ? "payment_overdue" : "payment_received",
                at: now,
              },
            });
          }
        });
      }
      if (changed) {
        await this.mailOwners(b.id, (to, billing) =>
          accessByBillsEmail(to, b.name, stepOf(access, byBills), billing),
        );
      }
      await this.syncIssue(b.id, access, pausesOn);
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
    // Only the platform admin suspends (ADR-0014, 4); nothing suspends a business by itself.
    if (input.mode === "hold" && input.access === "suspended" && staff.role !== "admin") {
      throw new ForbiddenException(
        apiError("FORBIDDEN", "Only the platform admin suspends a business."),
      );
    }
    if (input.mode === "hold" && input.until !== null && input.until < today) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          until: "can't be in the past",
        }),
      );
    }
    const result = await this.db.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
      if (!locked) throw notFound();
      const b = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { name: true, access: true, invoices: BILLS },
      });
      const byBills = accessByBills(billsOf(b.invoices), today);
      const hold = input.mode === "hold";
      const access = hold ? input.access : byBills.access;
      const heldUntil = hold ? input.until : null;
      await tx.business.update({
        where: { id: businessId },
        data: {
          access,
          ...(access !== b.access ? { accessSince: now } : {}),
          accessHeld: hold,
          accessHeldUntil: heldUntil ? new Date(`${heldUntil}T00:00:00Z`) : null,
          accessPausesOn:
            !hold && byBills.access === "grace_period" && byBills.pausesOn
              ? new Date(`${byBills.pausesOn}T00:00:00Z`)
              : null,
        },
      });
      await tx.serviceAccessChange.create({
        data: {
          businessId,
          access,
          held: hold,
          heldUntil: heldUntil ? new Date(`${heldUntil}T00:00:00Z`) : null,
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
      return {
        name: b.name,
        access,
        heldUntil,
        pausesOn: !hold && byBills.access === "grace_period" ? byBills.pausesOn : null,
      };
    });
    await this.mailOwners(businessId, (to) =>
      accessByHandEmail(to, result.name, {
        access: result.access,
        heldUntil: result.heldUntil,
        reason: input.reason,
        message: input.message,
      }),
    );
    await this.syncIssue(businessId, result.access, result.pausesOn);
    return this.detail(businessId, now);
  }

  /** Its access now, with its bills' facts: what its owner's Billing says. */
  async state(businessId: string, now = new Date()): Promise<ServiceAccessState> {
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
    return {
      access: b.access,
      since: b.accessSince?.toISOString() ?? null,
      held: b.accessHeld,
      heldUntil: b.accessHeldUntil ? dateOf(b.accessHeldUntil) : null,
      overdueSince: byBills.access === "enabled" ? null : byBills.overdueSince,
      overdueTsh: byBills.access === "enabled" ? 0 : byBills.overdueTsh,
      pausesOn: b.accessPausesOn ? dateOf(b.accessPausesOn) : null,
    };
  }

  /** Its access now, and every change, newest first: HashiNet's team's view. */
  async detail(businessId: string, now = new Date()): Promise<ServiceAccessDetail> {
    const [state, rows] = await Promise.all([
      this.state(businessId, now),
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
  private async syncIssue(
    businessId: string,
    access: ServiceAccess,
    pausesOn: string | null,
  ): Promise<void> {
    const workspace = { scope: "business", businessId } as const;
    const key = `selling:${businessId}`;
    const cause = sellingStopped(access) ? "paused" : pausesOn ? "pauses" : null;
    if (cause === null) {
      await this.issues.resolve(workspace, key, { reason: "selling" });
      return;
    }
    const open = await this.db.issue.findFirst({
      where: { ...workspace, key, status: "open" },
      select: { id: true, cause: true },
    });
    if (!open) {
      await this.issues.open({
        ...workspace,
        kind: "selling_paused",
        key,
        venueId: null,
        routerId: null,
        holderId: null,
        cause,
      });
    } else if (open.cause !== cause) {
      await this.db.issue.update({ where: { id: open.id }, data: { cause } });
    }
  }

  /** A business's owners hear by email; a failure to send is reported, not fatal. */
  private async mailOwners(
    businessId: string,
    build: (to: string, billing: string) => EmailMessage,
  ): Promise<void> {
    const owners = await this.db.membership.findMany({
      where: { businessId, role: "owner", status: "active" },
      select: { user: { select: { email: true } } },
    });
    const billing = `${this.config.frontendOrigin}/billing`;
    for (const o of owners) {
      void this.email.send(build(o.user.email, billing)).catch(captureFailure);
    }
  }
}

/** What its owners are told when its bills change its access. */
function stepOf(access: ServiceAccess, byBills: AccessByBills) {
  if (byBills.access === "enabled" || access === "enabled") return { access: "enabled" } as const;
  if (access === "read_only") return { ...byBills, access: "read_only" } as const;
  return { ...byBills, access: "grace_period" } as const;
}
