import type {
  RouterCondition,
  RouterJourney,
  RouterSetupPhase,
  RouterStage,
} from "@hashinet/types";
import { PHASE_TITLES, type SetupPhaseId } from "../services/router-provision/setup.js";

/** A run this old with no finish was ended by a restart; setup itself takes minutes. */
export const SETUP_STALE_MS = 10 * 60 * 1000;

/** What a finished setup leaves on the router. */
export interface StoredSetup {
  ok: boolean;
  phases: { id: string; title: string; status: RouterSetupPhase["status"]; detail: string }[];
  blockers: { reason: string; fix: string | null }[];
}

interface JourneyRow {
  status: string;
  setupStartedAt: Date | null;
  setupPhase: string | null;
  lastSetupAt: Date | null;
}

const PHASES = Object.entries(PHASE_TITLES) as [SetupPhaseId, string][];

function runningPhases(current: string | null): RouterSetupPhase[] {
  const at = PHASES.findIndex(([id]) => id === current);
  return PHASES.map(([id, title], index) => ({
    id,
    title,
    status: index < at ? "pass" : index === at ? "running" : "pending",
    detail: null,
  }));
}

/** A router's condition, from its stage and what it last reported. */
export function conditionOf(stage: RouterStage, status: string): RouterCondition {
  if (stage !== "serving") return "setting-up";
  return status === "online" ? "serving" : status === "error" ? "needs-attention" : "offline";
}

const WORST: RouterCondition[] = ["needs-attention", "offline", "setting-up", "serving"];

/** A business's condition across its routers: the worst one; setting up while it has none. */
export function worstCondition(conditions: RouterCondition[]): RouterCondition {
  return WORST.find((c) => conditions.includes(c)) ?? "setting-up";
}

function stageOf(row: JourneyRow, ok: boolean | null): RouterStage {
  if (ok === true) return "serving";
  return row.status === "online" ? "set-up" : "connect";
}

/** Decides what an owner sees: the web renders this and decides nothing (ADR-0003). */
export function routerJourney(
  row: JourneyRow,
  last: StoredSetup | null,
  now: Date = new Date(),
): RouterJourney {
  const startedAt = row.setupStartedAt?.getTime() ?? null;
  const interrupted = startedAt !== null && now.getTime() - startedAt > SETUP_STALE_MS;
  const running = startedAt !== null && !interrupted;
  const ok = last?.ok ?? null;
  return {
    stage: stageOf(row, ok),
    connected: row.status === "online",
    running,
    interrupted,
    ok,
    finishedAt: row.lastSetupAt?.toISOString() ?? null,
    phases: running
      ? runningPhases(row.setupPhase)
      : last
        ? last.phases
        : PHASES.map(([id, title]) => ({ id, title, status: "pending", detail: null })),
    blockers: running ? [] : (last?.blockers ?? []),
  };
}

/** The router fields a journey and a condition are read from. */
export const JOURNEY_SELECT = {
  status: true,
  setupStartedAt: true,
  setupPhase: true,
  lastSetupAt: true,
  lastSetup: true,
} as const;

/** A router's condition, from the fields `JOURNEY_SELECT` reads. */
export function routerCondition(row: JourneyRow & { lastSetup: unknown }): RouterCondition {
  return conditionOf(routerJourney(row, row.lastSetup as StoredSetup | null).stage, row.status);
}
