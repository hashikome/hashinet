import type { OnboardingStage } from "@hashinet/types";
import type { Prisma } from "../generated/prisma/client.js";
import { JOURNEY_SELECT, routerCondition } from "../routers/router-journey.js";

export interface OnboardingFacts {
  preferredAt: Date | null;
  confirmedAt: Date | null;
  /** The agreed lines together; null until agreed. */
  totalTsh: number | null;
  /** Its invoice is paid in full. */
  paid: boolean;
  setupDate: Date | null;
  completedAt: Date | null;
  /** A router at the venue has reached HashiNet. */
  routerReached: boolean;
  /** A router at the venue serves. */
  serving: boolean;
}

/** Where a venue is on its way to serving guests (ADR-0013, 2). */
export function onboardingStage(f: OnboardingFacts): OnboardingStage {
  if (f.completedAt) return "done";
  if (!f.confirmedAt) return f.preferredAt ? "confirm" : "choose";
  if ((f.totalTsh ?? 0) > 0 && !f.paid) return "pay";
  if (!f.setupDate) return "schedule";
  if (!f.routerReached) return "add-router";
  if (!f.serving) return "set-up";
  return "first-guest";
}

/** What a venue's stage is read from: its onboarding and its routers. */
export const VENUE_FACTS = {
  onboarding: { include: { lines: { orderBy: { position: "asc" } } } },
  routers: { select: { ...JOURNEY_SELECT, lastSeenAt: true } },
  // The package's invoice and what has settled it (slice 4).
  invoices: {
    where: { kind: "onboarding" },
    select: {
      id: true,
      number: true,
      totalTsh: true,
      dueOn: true,
      allocations: { select: { amountTsh: true } },
    },
  },
} as const satisfies Prisma.VenueInclude;

export type VenueFacts = Prisma.VenueGetPayload<{ include: typeof VENUE_FACTS }>;

export const totalOf = (lines: { amountTsh: number }[]) =>
  lines.reduce((sum, l) => sum + l.amountTsh, 0);

/** The package's invoice, with what has been paid on it; null until it is issued. */
export function onboardingInvoice(venue: VenueFacts) {
  const invoice = venue.invoices[0];
  if (!invoice) return null;
  return { ...invoice, paidTsh: totalOf(invoice.allocations) };
}

/** A venue's stage, from its facts. Every venue has its onboarding from the moment it exists. */
export function venueStage(venue: VenueFacts): OnboardingStage {
  const o = venue.onboarding;
  if (!o) throw new Error(`Venue ${venue.id} has no onboarding.`);
  const invoice = onboardingInvoice(venue);
  return onboardingStage({
    ...o,
    totalTsh: o.confirmedAt ? totalOf(o.lines) : null,
    paid: invoice !== null && invoice.paidTsh >= invoice.totalTsh,
    routerReached: venue.routers.some((r) => r.lastSeenAt !== null || r.status === "online"),
    serving: venue.routers.some((r) => routerCondition(r) === "serving"),
  });
}
