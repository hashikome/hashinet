import type { OnboardingStage } from "@hashinet/types";

/** The facts a venue's stage follows from. */
export interface OnboardingFacts {
  preferredAt: Date | null;
  confirmedAt: Date | null;
  priceTsh: number | null;
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
  if ((f.priceTsh ?? 0) > 0 && !f.paidAt) return "pay";
  if (!f.setupDate) return "schedule";
  if (!f.routerReached) return "add-router";
  if (!f.serving) return "set-up";
  return "first-guest";
}
