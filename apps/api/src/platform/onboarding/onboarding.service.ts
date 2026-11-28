import {
  ONBOARDING_LINE_DESCRIBED,
  ONBOARDING_LINE_KINDS,
  ONBOARDING_PLANS,
  type OnboardingPlan,
  type VenueOnboarding,
} from "@hashinet/types";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { z } from "zod";
import { ownerProtected } from "../../core/access/owner-protected.js";
import { allows } from "../../core/access/policy.js";
import type { Principal } from "../../core/access/principal.js";
import { venueScope } from "../../core/access/venue-scope.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { oneLine, paragraph } from "../../core/http/validation.js";
import { businessDayOf } from "../../core/time/business-day.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { onSalePackages } from "../../packages/on-sale.js";
import { venueNotFound } from "../../venues/venue-errors.js";
import { lockBusiness } from "../billing/business-lock.js";
import { invoiceSummary } from "../billing/invoice-state.js";
import { Invoices } from "../billing/invoices.js";
import { IssuesService, PLATFORM_WORKSPACE } from "../issues/issues.service.js";
import { beginOnboarding, packageKey, setupKey } from "./begin.js";
import {
  onboardingInvoice,
  totalOf,
  VENUE_FACTS,
  type VenueFacts,
  venueStage,
} from "./onboarding-stage.js";

export const preferInput = z.object({ plan: z.enum(ONBOARDING_PLANS).nullable() });
const onboardingLine = z.object({
  kind: z.enum(ONBOARDING_LINE_KINDS),
  description: oneLine(160).nullable().default(null),
  amountTsh: z.number().int().min(0).max(100_000_000),
});

/**
 * What the team agreed on the call, line by line: one onboarding fee, agreed for the business, and
 * what the plan brings. Connect sets up the venue's own router, so it has no MikroTik router line;
 * Install and Launch bring one, named by its model.
 */
export const confirmInput = z
  .object({
    plan: z.enum(ONBOARDING_PLANS),
    lines: z.array(onboardingLine).min(1).max(12),
    note: paragraph(1000).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    const fees = v.lines.filter((l) => l.kind === "onboarding_fee").length;
    if (fees !== 1) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "needs one onboarding fee" });
    }
    const routers = v.lines.filter((l) => l.kind === "mikrotik_router");
    if (v.plan === "connect" && routers.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Connect uses the venue's own MikroTik router",
      });
    }
    if (v.plan !== "connect" && routers.length === 0) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "needs the MikroTik router" });
    }
    v.lines.forEach((l, n) => {
      if (ONBOARDING_LINE_DESCRIBED.includes(l.kind) && !l.description) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", n, "description"],
          message: l.kind === "other" ? "say what it is" : "name the model",
        });
      }
    });
  });

export const scheduleInput = z.object({
  date: z.iso.date(),
  goesId: z.uuid().nullable().default(null),
});

const invalid = (field: string, message: string) =>
  new BadRequestException(
    apiError("VALIDATION_FAILED", "Check the highlighted fields.", { [field]: message }),
  );
const notNow = (message: string) => new ConflictException(apiError("CONFLICT", message));

const withFacts = {
  ...VENUE_FACTS,
  business: { select: { id: true, name: true } },
} as const satisfies Prisma.VenueInclude;

type VenueRow = Prisma.VenueGetPayload<{ include: typeof withFacts }>;
type Onboarding = NonNullable<VenueFacts["onboarding"]>;

/**
 * A venue's way to serving guests (ADR-0013, 2), through two issues in turn: its package (the
 * owner's preference, the call, the payment, the setup date), for the platform's admin and
 * managers, then its setup, handed to whoever goes, which closes when the first guest is online.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly db: PrismaService,
    private readonly issues: IssuesService,
    private readonly audit: AuditLog,
    private readonly invoices: Invoices,
  ) {}

  /** A new venue starts at its package, in the transaction that creates it. */
  begin(venueId: string, db: Prisma.TransactionClient): Promise<void> {
    return beginOnboarding(db, venueId);
  }

  async get(staff: Principal, venueId: string): Promise<VenueOnboarding> {
    return this.record(staff, await this.venue(staff, venueId));
  }

  /** The owner says how they would like the router to come, or asks to talk first. */
  async prefer(staff: Principal, venueId: string, plan: OnboardingPlan | null) {
    const venue = await this.venue(staff, venueId);
    if (onboardingOf(venue).confirmedAt) {
      throw notNow("The package is agreed; talk to HashiNet's team to change it.");
    }
    await this.db.$transaction(async (tx) => {
      await tx.venueOnboarding.update({
        where: { venueId },
        data: { preference: plan, preferredAt: new Date() },
      });
      await this.issues.step(
        staff,
        packageKey(venueId),
        { step: "preferred", plan },
        { anyone: true },
        tx,
      );
      await this.audited(staff, "onboarding.prefer", venue, { preference: plan ?? "talk" }, tx);
    });
    return this.get(staff, venueId);
  }

  /** What the team agreed on the call; it may change until it is paid or its setup scheduled. */
  async confirm(staff: Principal, venueId: string, input: z.infer<typeof confirmInput>) {
    const venue = await this.venue(staff, venueId);
    const o = onboardingOf(venue);
    if (o.setupDate) throw notNow("The setup is scheduled; the package no longer changes.");
    const total = totalOf(input.lines);
    const invoice = await this.db.$transaction(async (tx) => {
      // Held as a payment holds it, so nothing is paid on the old charge while this changes it.
      await lockBusiness(tx, venue.businessId);
      const paid = await tx.billAllocation.count({
        where: { invoice: { kind: "onboarding", venueId, cancelledAt: null } },
      });
      if (paid > 0) throw notNow("Payment has come in; the package no longer changes.");
      // The fee first, then the rest as agreed.
      const lines = [...input.lines].sort(
        (a, b) => Number(b.kind === "onboarding_fee") - Number(a.kind === "onboarding_fee"),
      );
      await tx.venueOnboarding.update({
        where: { venueId },
        data: {
          plan: input.plan,
          note: input.note,
          confirmedAt: new Date(),
          lines: { deleteMany: {}, create: lines.map((l, position) => ({ ...l, position })) },
        },
      });
      await this.issues.step(
        staff,
        packageKey(venueId),
        { step: "confirmed", plan: input.plan, totalTsh: total },
        { anyone: false },
        tx,
      );
      await this.audited(
        staff,
        "onboarding.confirm",
        venue,
        { plan: input.plan, totalTsh: total },
        tx,
      );
      // Its charge, invoiced as agreed, due 7 days later (ADR-0013, 6).
      return this.invoices.syncOnboarding(venueId, tx);
    });
    await this.invoices.chargeChanged(venue.businessId, invoice);
    return this.get(staff, venueId);
  }

  /**
   * The setup day, agreed with the owner: the package is done and the setup goes to the team,
   * to whoever goes if someone was chosen. Moving the day again is a step on the setup.
   */
  async schedule(staff: Principal, venueId: string, input: z.infer<typeof scheduleInput>) {
    const venue = await this.venue(staff, venueId);
    const stage = venueStage(venue);
    if (stage !== "schedule" && stage !== "add-router") {
      throw notNow(
        stage === "choose" || stage === "confirm" || stage === "pay"
          ? "Confirm the package, and record its payment, first."
          : "The router is added; the setup day no longer changes.",
      );
    }
    if (input.date < businessDayOf(new Date())) throw invalid("date", "must be today or later");
    if (input.goesId) {
      const goes = await this.db.membership.findFirst({
        where: { id: input.goesId, scope: "platform", status: "active" },
      });
      if (!goes) throw invalid("goesId", "must be someone on HashiNet's team");
    }
    const date = new Date(`${input.date}T00:00:00Z`);
    await this.db.$transaction(async (tx) => {
      await tx.venueOnboarding.update({ where: { venueId }, data: { setupDate: date } });
      if (stage === "schedule") {
        await this.issues.step(
          staff,
          packageKey(venueId),
          { step: "scheduled", date: input.date },
          { anyone: false },
          tx,
        );
        await this.issues.resolve(
          PLATFORM_WORKSPACE,
          packageKey(venueId),
          { reason: "scheduled" },
          tx,
        );
        await this.issues.open(
          {
            ...PLATFORM_WORKSPACE,
            kind: "venue_setup",
            key: setupKey(venueId),
            venueId,
            routerId: null,
            holderId: input.goesId,
            cause: null,
          },
          tx,
        );
      } else {
        await this.issues.step(
          staff,
          setupKey(venueId),
          { step: "rescheduled", date: input.date },
          { anyone: false },
          tx,
        );
      }
      await this.audited(staff, "onboarding.schedule", venue, { setupDate: input.date }, tx);
    });
    return this.get(staff, venueId);
  }

  /** Closes a venue's setup once its first guest is online at a router that serves. */
  async syncSetups(): Promise<void> {
    const waiting = (
      await this.db.venue.findMany({
        where: { onboarding: { completedAt: null, setupDate: { not: null } } },
        include: VENUE_FACTS,
      })
    ).filter((v) => venueStage(v) === "first-guest");
    if (waiting.length === 0) return;
    const guests = await this.db.wifiSession.findMany({
      where: { venueId: { in: waiting.map((v) => v.id) } },
      distinct: ["venueId"],
      select: { venueId: true },
    });
    for (const { venueId } of guests) {
      if (!venueId) continue;
      await this.db.$transaction(async (tx) => {
        await tx.venueOnboarding.update({ where: { venueId }, data: { completedAt: new Date() } });
        await this.issues.resolve(
          PLATFORM_WORKSPACE,
          setupKey(venueId),
          { reason: "first_guest" },
          tx,
        );
      });
    }
  }

  /** The venue, within the reader's reach; an operator reaches only a venue handed to them. */
  private async venue(staff: Principal, venueId: string): Promise<VenueRow> {
    const venue = await this.db.venue.findFirst({
      where: { id: venueId, ...venueScope(staff) },
      include: withFacts,
    });
    if (!venue) throw venueNotFound();
    if (staff.scope === "platform" && !(await this.issues.handedAt(staff, venueId))) {
      throw venueNotFound();
    }
    return venue;
  }

  private async record(staff: Principal, venue: VenueRow): Promise<VenueOnboarding> {
    const o = onboardingOf(venue);
    const stage = venueStage(venue);
    const platform = staff.scope === "platform";
    const [isProtected, packagesOnSale, issues] = await Promise.all([
      ownerProtected(this.db, venue.businessId),
      onSalePackages(this.db, venue.id).then((sold) => sold?.length ?? 0),
      platform
        ? this.db.issue.findMany({
            where: {
              ...PLATFORM_WORKSPACE,
              status: "open",
              key: { in: [packageKey(venue.id), setupKey(venue.id)] },
            },
            select: { id: true, key: true, holderId: true },
          })
        : [],
    ]);
    const issue = (key: string) => issues.find((i) => i.key === key) ?? null;
    // Who may take a step: the holder, or anyone while nobody holds it.
    const free = (key: string) => {
      const i = issue(key);
      return i !== null && (i.holderId === null || i.holderId === staff.membershipId);
    };
    const manages = allows(staff.role, "onboarding.manage");
    // What it costs is for the admin and managers and the business itself; the technician who
    // goes sees what to bring.
    const priced = !platform || manages;
    const total = totalOf(o.lines);
    const invoice = onboardingInvoice(venue);
    const open = issue(packageKey(venue.id)) ?? issue(setupKey(venue.id));
    return {
      venue: { id: venue.id, name: venue.name },
      business: venue.business,
      stage,
      preference: o.preferredAt ? { plan: o.preference, at: o.preferredAt.toISOString() } : null,
      agreed:
        o.confirmedAt && o.plan
          ? {
              plan: o.plan,
              lines: o.lines.map((l) => ({
                kind: l.kind,
                description: l.description,
                amountTsh: priced ? l.amountTsh : null,
              })),
              totalTsh: priced ? total : null,
              note: o.note,
              confirmedAt: o.confirmedAt.toISOString(),
            }
          : null,
      invoice:
        priced && invoice
          ? {
              id: invoice.id,
              number: invoice.number,
              totalTsh: invoice.totalTsh,
              ...invoiceSummary(invoice, invoice.paidTsh, new Date()),
            }
          : null,
      setupDate: o.setupDate?.toISOString().slice(0, 10) ?? null,
      completedAt: o.completedAt?.toISOString() ?? null,
      ownerProtected: isProtected,
      ready: { packagesOnSale },
      may: {
        prefer: allows(staff.role, "onboarding.prefer") && !o.confirmedAt,
        confirm:
          manages && !o.setupDate && (invoice?.paidTsh ?? 0) === 0 && free(packageKey(venue.id)),
        // Recorded on its invoice; whoever records payments may.
        pay: allows(staff.role, "billing.record") && stage === "pay" && invoice !== null,
        schedule:
          manages &&
          ((stage === "schedule" && free(packageKey(venue.id))) ||
            (stage === "add-router" && free(setupKey(venue.id)))),
      },
      issueId: open?.id ?? null,
    };
  }

  private async audited(
    staff: Principal,
    action: "onboarding.prefer" | "onboarding.confirm" | "onboarding.schedule",
    venue: VenueRow,
    after: Record<string, string | number | null>,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await this.audit.record(
      staff,
      {
        action,
        target: { type: "venue", id: venue.id },
        businessId: venue.businessId,
        venueId: venue.id,
        change: { before: {}, after },
      },
      tx,
    );
  }
}

function onboardingOf(venue: VenueFacts): Onboarding {
  if (!venue.onboarding) throw new Error(`Venue ${venue.id} has no onboarding.`);
  return venue.onboarding;
}
