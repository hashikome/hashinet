import {
  ONBOARDING_DUE_DAYS,
  ONBOARDING_LINE_KINDS,
  ONBOARDING_PAID_BY,
  ONBOARDING_PLANS,
  type OnboardingPlan,
  type VenueOnboarding,
} from "@hashinet/types";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { z } from "zod";
import { ownerProtected } from "../access/owner-protected.js";
import { allows } from "../access/policy.js";
import type { Principal } from "../access/principal.js";
import { venueScope } from "../access/venue-scope.js";
import { businessDayOf } from "../analytics/business-day.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { apiError } from "../http/error-envelope.js";
import { oneLine, paragraph } from "../http/validation.js";
import { IssuesService, PLATFORM_WORKSPACE } from "../issues/issues.service.js";
import { venueNotFound } from "../venues/venue-errors.js";
import { beginOnboarding, packageKey, setupKey } from "./begin.js";
import { totalOf, VENUE_FACTS, type VenueFacts, venueStage } from "./onboarding-stage.js";

const DAY_MS = 86_400_000;

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
      if ((l.kind === "mikrotik_router" || l.kind === "other") && !l.description) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", n, "description"],
          message: l.kind === "other" ? "say what it is" : "name the model",
        });
      }
    });
  });

export const paymentInput = z.object({
  amountTsh: z.number().int().positive(),
  by: z.enum(ONBOARDING_PAID_BY),
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
    if (o.paidAt) throw notNow("It is paid; the package no longer changes.");
    const total = totalOf(input.lines);
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
    });
    return this.get(staff, venueId);
  }

  /** Recorded by the admin or a manager, whoever holds the issue; paid in full (ADR-0013, 6). */
  async recordPayment(staff: Principal, venueId: string, input: z.infer<typeof paymentInput>) {
    const venue = await this.venue(staff, venueId);
    if (venueStage(venue) !== "pay") throw notNow("There is no payment to record.");
    const total = totalOf(onboardingOf(venue).lines);
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
    const [isProtected, issues] = await Promise.all([
      ownerProtected(this.db, venue.businessId),
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
              dueOn:
                priced && total > 0
                  ? businessDayOf(new Date(o.confirmedAt.getTime() + ONBOARDING_DUE_DAYS * DAY_MS))
                  : null,
            }
          : null,
      paid:
        priced && o.paidAt && o.paidAmountTsh !== null && o.paidBy
          ? { amountTsh: o.paidAmountTsh, by: o.paidBy, at: o.paidAt.toISOString() }
          : null,
      setupDate: o.setupDate?.toISOString().slice(0, 10) ?? null,
      completedAt: o.completedAt?.toISOString() ?? null,
      ownerProtected: isProtected,
      may: {
        prefer: allows(staff.role, "onboarding.prefer") && !o.confirmedAt,
        confirm: manages && !o.setupDate && !o.paidAt && free(packageKey(venue.id)),
        pay: manages && stage === "pay",
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

function onboardingOf(venue: VenueFacts): Onboarding {
  if (!venue.onboarding) throw new Error(`Venue ${venue.id} has no onboarding.`);
  return venue.onboarding;
}
