import {
  ONBOARDING_DUE_DAYS,
  ONBOARDING_LINE_KINDS,
  ONBOARDING_PAID_BY,
  ONBOARDING_PLANS,
  type OnboardingPlan,
  type OnboardingStage,
  type VenueOnboarding,
} from "@hashinet/types";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { ownerProtected } from "../access/owner-protected.js";
import type { Principal } from "../access/principal.js";
import { venueScope } from "../access/venue-scope.js";
import { businessDayOf } from "../analytics/business-day.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { apiError } from "../http/error-envelope.js";
import { IssuesService } from "../issues/issues.service.js";
import { conditionOf, routerJourney, type StoredSetup } from "../routers/router-journey.js";
import { onboardingStage } from "./onboarding-stage.js";

const DAY_MS = 86_400_000;
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, "must be one line of text");

export const preferInput = z.object({ plan: z.enum(ONBOARDING_PLANS).nullable() });
const onboardingLine = z.object({
  kind: z.enum(ONBOARDING_LINE_KINDS),
  description: line(160).nullable().default(null),
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
    note: z.string().trim().max(1000).nullable().default(null),
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
      if ((l.kind === "mikrotik_router" || l.kind === "other") && !l.description) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", n, "description"],
          message: l.kind === "other" ? "say what it is" : "name the model",
        });
      }
    });
  });

const totalOf = (lines: { amountTsh: number }[]) => lines.reduce((sum, l) => sum + l.amountTsh, 0);

export const paymentInput = z.object({
  amountTsh: z.number().int().positive(),
  by: z.enum(ONBOARDING_PAID_BY),
});
export const scheduleInput = z.object({
  date: z.iso.date(),
  goesId: z.uuid().nullable().default(null),
});

const packageKey = (venueId: string) => `venue-package:${venueId}`;
const setupKey = (venueId: string) => `venue-setup:${venueId}`;

const invalid = (field: string, message: string) =>
  new BadRequestException(
    apiError("VALIDATION_FAILED", "Check the highlighted fields.", { [field]: message }),
  );
const venueNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That venue does not exist."));
const notNow = (message: string) => new ConflictException(apiError("CONFLICT", message));

const withFacts = {
  onboarding: { include: { lines: { orderBy: { position: "asc" } } } },
  business: { select: { id: true, name: true } },
  routers: {
    select: {
      status: true,
      lastSeenAt: true,
      setupStartedAt: true,
      setupPhase: true,
      lastSetupAt: true,
      lastSetup: true,
    },
  },
} as const satisfies Prisma.VenueInclude;

type VenueRow = Prisma.VenueGetPayload<{ include: typeof withFacts }>;

/**
 * A venue's way to serving guests (ADR-0013, 2), through two issues in turn: its package (the
 * owner's preference, the call, the payment, the setup date), for the platform's admin and
 * managers, then its setup, for the whole team, which closes when the first guest is online.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly db: PrismaService,
    private readonly issues: IssuesService,
    private readonly audit: AuditLog,
  ) {}

  /** A new venue starts at its package, in the transaction that creates it. */
  async begin(venueId: string, db: Prisma.TransactionClient): Promise<void> {
    await db.venueOnboarding.create({ data: { venueId } });
    await this.issues.open(
      {
        scope: "platform",
        businessId: null,
        kind: "venue_package",
        key: packageKey(venueId),
        venueId,
      },
      db,
    );
  }

  async get(staff: Principal, venueId: string): Promise<VenueOnboarding> {
    const venue = await this.venue(staff, venueId);
    return this.record(staff, venue);
  }

  /** The owner says how they would like the router to come, or asks to talk first. */
  async prefer(staff: Principal, venueId: string, plan: OnboardingPlan | null) {
    const venue = await this.venue(staff, venueId);
    const o = this.onboarding(venue);
    if (o.confirmedAt) throw notNow("The package is agreed; talk to HashiNet's team to change it.");
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

  /** What the team agreed on the call; it may change until the package is paid. */
  async confirm(staff: Principal, venueId: string, input: z.infer<typeof confirmInput>) {
    const venue = await this.venue(staff, venueId);
    const o = this.onboarding(venue);
    if (o.setupDate) throw notNow("The setup is scheduled; the package no longer changes.");
    if (o.paidAt) throw notNow("It is paid; the package no longer changes.");
    await this.db.$transaction(async (tx) => {
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
          lines: {
            deleteMany: {},
            create: lines.map((l, position) => ({ ...l, position })),
          },
        },
      });
      await this.issues.step(
        staff,
        packageKey(venueId),
        { step: "confirmed", plan: input.plan, totalTsh: totalOf(input.lines) },
        { anyone: false },
        tx,
      );
      await this.audited(
        staff,
        "onboarding.confirm",
        venue,
        { plan: input.plan, totalTsh: totalOf(input.lines) },
        tx,
      );
    });
    return this.get(staff, venueId);
  }

  /** Recorded by the admin or a manager, whoever holds the issue; paid in full (ADR-0013, 6). */
  async recordPayment(staff: Principal, venueId: string, input: z.infer<typeof paymentInput>) {
    const venue = await this.venue(staff, venueId);
    const o = this.onboarding(venue);
    if (this.stage(venue) !== "pay") throw notNow("There is no payment to record.");
    const total = totalOf(o.lines);
    if (input.amountTsh < total) {
      throw invalid("amountTsh", `must be the agreed total, TSh ${total}, paid in full`);
    }
    await this.db.$transaction(async (tx) => {
      await tx.venueOnboarding.update({
        where: { venueId },
        data: { paidAt: new Date(), paidAmountTsh: input.amountTsh, paidBy: input.by },
      });
      await this.issues.step(
        staff,
        packageKey(venueId),
        { step: "paid", amountTsh: input.amountTsh, by: input.by },
        { anyone: true },
        tx,
      );
      await this.audited(
        staff,
        "onboarding.pay",
        venue,
        { amountTsh: input.amountTsh, by: input.by },
        tx,
      );
    });
    return this.get(staff, venueId);
  }

  /**
   * The setup day, agreed with the owner: the package is done and the setup goes to the team,
   * to whoever goes if someone was chosen. Moving the day again is a step on the setup.
   */
  async schedule(staff: Principal, venueId: string, input: z.infer<typeof scheduleInput>) {
    const venue = await this.venue(staff, venueId);
    const stage = this.stage(venue);
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
          { scope: "platform", businessId: null },
          packageKey(venueId),
          { reason: "scheduled" },
          tx,
        );
        await this.issues.open(
          {
            scope: "platform",
            businessId: null,
            kind: "venue_setup",
            key: setupKey(venueId),
            venueId,
            holderId: input.goesId,
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
    const venues = await this.db.venue.findMany({
      where: { onboarding: { completedAt: null, setupDate: { not: null } } },
      include: withFacts,
    });
    for (const venue of venues) {
      if (this.stage(venue) !== "first-guest") continue;
      const guest = await this.db.wifiSession.findFirst({
        where: { venueId: venue.id },
        select: { id: true },
      });
      if (!guest) continue;
      await this.db.$transaction(async (tx) => {
        await tx.venueOnboarding.update({
          where: { venueId: venue.id },
          data: { completedAt: new Date() },
        });
        await this.issues.resolve(
          { scope: "platform", businessId: null },
          setupKey(venue.id),
          { reason: "first_guest" },
          tx,
        );
      });
    }
  }

  /** Where each venue is on its way to serving guests: a business's, or every one. */
  async stages(businessId?: string): Promise<Map<string, OnboardingStage>> {
    const venues = await this.db.venue.findMany({
      where: businessId ? { businessId } : {},
      include: withFacts,
    });
    return new Map(venues.filter((v) => v.onboarding).map((v) => [v.id, this.stage(v)] as const));
  }

  private async venue(staff: Principal, venueId: string): Promise<VenueRow> {
    const venue = await this.db.venue.findFirst({
      where: { id: venueId, ...venueScope(staff) },
      include: withFacts,
    });
    if (!venue) throw venueNotFound();
    return venue;
  }

  private onboarding(venue: VenueRow) {
    if (!venue.onboarding) throw venueNotFound();
    return venue.onboarding;
  }

  private stage(venue: VenueRow) {
    const o = this.onboarding(venue);
    const conditions = venue.routers.map((r) =>
      conditionOf(routerJourney(r, r.lastSetup as StoredSetup | null).stage, r.status),
    );
    return onboardingStage({
      ...o,
      totalTsh: o.confirmedAt ? totalOf(o.lines) : null,
      routerReached: venue.routers.some((r) => r.lastSeenAt !== null || r.status === "online"),
      serving: conditions.includes("serving"),
    });
  }

  private async record(staff: Principal, venue: VenueRow): Promise<VenueOnboarding> {
    const o = this.onboarding(venue);
    const [isProtected, issue] = await Promise.all([
      ownerProtected(this.db, venue.businessId),
      staff.scope === "platform"
        ? this.db.issue.findFirst({
            where: {
              scope: "platform",
              status: "open",
              key: { in: [packageKey(venue.id), setupKey(venue.id)] },
              ...(staff.role === "operator" ? { holderId: staff.membershipId } : {}),
            },
            select: { id: true },
          })
        : null,
    ]);
    return {
      venue: { id: venue.id, name: venue.name },
      business: venue.business,
      stage: this.stage(venue),
      preference: o.preferredAt ? { plan: o.preference, at: o.preferredAt.toISOString() } : null,
      agreed:
        o.confirmedAt && o.plan
          ? {
              plan: o.plan,
              lines: o.lines.map((l) => ({
                kind: l.kind,
                description: l.description,
                amountTsh: l.amountTsh,
              })),
              totalTsh: totalOf(o.lines),
              note: o.note,
              confirmedAt: o.confirmedAt.toISOString(),
              dueOn:
                totalOf(o.lines) > 0
                  ? businessDayOf(new Date(o.confirmedAt.getTime() + ONBOARDING_DUE_DAYS * DAY_MS))
                  : null,
            }
          : null,
      paid:
        o.paidAt && o.paidAmountTsh !== null && o.paidBy
          ? { amountTsh: o.paidAmountTsh, by: o.paidBy, at: o.paidAt.toISOString() }
          : null,
      setupDate: o.setupDate?.toISOString().slice(0, 10) ?? null,
      completedAt: o.completedAt?.toISOString() ?? null,
      ownerProtected: isProtected,
      changeable: !o.setupDate && !o.paidAt,
      issueId: issue?.id ?? null,
    };
  }

  private async audited(
    staff: Principal,
    action: "onboarding.prefer" | "onboarding.confirm" | "onboarding.pay" | "onboarding.schedule",
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
