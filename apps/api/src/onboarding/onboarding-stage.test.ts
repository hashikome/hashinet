import { describe, expect, test } from "bun:test";
import { type OnboardingFacts, onboardingStage } from "./onboarding-stage.js";

const at = new Date("2026-11-13T09:00:00Z");
const none: OnboardingFacts = {
  preferredAt: null,
  confirmedAt: null,
  totalTsh: null,
  paidAt: null,
  setupDate: null,
  completedAt: null,
  routerReached: false,
  serving: false,
};

describe("onboardingStage", () => {
  test("walks from the owner's choice to the first guest", () => {
    expect(onboardingStage(none)).toBe("choose");
    const chosen = { ...none, preferredAt: at };
    expect(onboardingStage(chosen)).toBe("confirm");
    const agreed = { ...chosen, confirmedAt: at, totalTsh: 270_000 };
    expect(onboardingStage(agreed)).toBe("pay");
    const paid = { ...agreed, paidAt: at };
    expect(onboardingStage(paid)).toBe("schedule");
    const scheduled = { ...paid, setupDate: at };
    expect(onboardingStage(scheduled)).toBe("add-router");
    expect(onboardingStage({ ...scheduled, routerReached: true })).toBe("set-up");
    expect(onboardingStage({ ...scheduled, routerReached: true, serving: true })).toBe(
      "first-guest",
    );
    expect(onboardingStage({ ...scheduled, completedAt: at })).toBe("done");
  });

  test("a package with nothing to charge skips payment; the team may confirm before the owner chooses", () => {
    expect(onboardingStage({ ...none, confirmedAt: at, totalTsh: 0 })).toBe("schedule");
  });
});
