import type { OnboardingStage } from "@hashinet/types";
import type { Prisma } from "../generated/prisma/client.js";
import { JOURNEY_SELECT, routerCondition } from "../routers/router-journey.js";

/** The facts a venue's stage follows from. */
export interface OnboardingFacts {
  preferredAt: Date | null;
  confirmedAt: Date | null;
  /** The agreed lines together; null until agreed. */
  totalTsh: number | null;
  paidAt: Date | null;
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
  if ((f.totalTsh ?? 0) > 0 && !f.paidAt) return "pay";
  if (!f.setupDate) return "schedule";
  if (!f.routerReached) return "add-router";
  if (!f.serving) return "set-up";
  return "first-guest";
}

/** What a venue's stage is read from: its onboarding and its routers. */
export const VENUE_FACTS = {
  onboarding: { include: { lines: { orderBy: { position: "asc" } } } },
  routers: { select: { ...JOURNEY_SELECT, lastSeenAt: true } },
} as const satisfies Prisma.VenueInclude;

export type VenueFacts = Prisma.VenueGetPayload<{ include: typeof VENUE_FACTS }>;

/** The agreed lines together. */
export const totalOf = (lines: { amountTsh: number }[]) =>
  lines.reduce((sum, l) => sum + l.amountTsh, 0);

/** A venue's stage, from its facts. Every venue has its onboarding from the moment it exists. */
export function venueStage(venue: VenueFacts): OnboardingStage {
  const o = venue.onboarding;
  if (!o) throw new Error(`Venue ${venue.id} has no onboarding.`);
  return onboardingStage({
    ...o,
    totalTsh: o.confirmedAt ? totalOf(o.lines) : null,
    routerReached: venue.routers.some((r) => r.lastSeenAt !== null || r.status === "online"),
    serving: venue.routers.some((r) => routerCondition(r) === "serving"),
  });
}
