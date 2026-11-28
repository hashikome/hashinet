import type {
  RouterCondition,
  RouterJourney,
  RouterSetupPhase,
  RouterStage,
  VenueSelling,
} from "@hashinet/types";
import {
  PHASE_TITLES,
  type SetupPhaseId,
  type SetupReport,
} from "../services/router-provision/setup.js";

/**
 * A router serving guests now: its last setup passed and it is online. A venue sells only while one
 * is, or a guest pays for a voucher nothing can take, and the refund follows.
 */
export const SERVING = {
  lastSetup: { path: ["ok"], equals: true },
  status: "online",
  internetOk: true,
} as const;

/** What a venue's record reads of each of its routers. */
export interface VenueRouter {
  status: string;
  internetOk: boolean;
  lastSetup: unknown;
  lastSeenAt: Date | null;
  internetSeenAt: Date | null;
  ssid: string | null;
}

/** Whether a venue sells now, from its routers: the API decides it, the web says it. */
export function sellingOf(routers: Omit<VenueRouter, "ssid">[]): VenueSelling {
  const setUp = routers.filter((r) => passedSetup(r.lastSetup));
  if (setUp.some((r) => r.status === "online" && r.internetOk)) return { state: "selling" };
  if (setUp.length === 0) return { state: "not-set-up" };
  // As the routers' condition says it (`conditionOf`), the one most to do about first.
  const conditions = setUp.map((r) => conditionOf("serving", r.status, r.internetOk));
  const state = conditions.includes("needs-attention")
    ? "needs-attention"
    : conditions.includes("no-internet")
      ? "no-internet"
      : "offline";
  // Since it last served: last heard from, or for no internet, last reaching the internet.
  const heard = setUp.flatMap((r) => {
    const at = state === "no-internet" ? r.internetSeenAt : r.lastSeenAt;
    return at === null ? [] : [at.getTime()];
  });
  return { state, since: heard.length ? new Date(Math.max(...heard)).toISOString() : null };
}

export const passedSetup = (last: unknown): last is { ok: true; version?: unknown } =>
  typeof last === "object" && last !== null && "ok" in last && last.ok === true;

/**
 * The WiFi guests join at a venue: the name its routers broadcast (set at setup), else the venue's
 * own name, which a router's WiFi takes by default.
 */
export function wifiNameOf(venueName: string, routers: Pick<VenueRouter, "ssid">[]): string {
  return routers.map((r) => r.ssid?.trim() ?? "").find((name) => name !== "") ?? venueName;
}

/**
 * What setup does, as a number: a router set up by an older one is set up again after a release
 * (2: hotspot logins through RADIUS, ADR-0015; 3: guests kept from the management address). Raise
 * it when a release changes what setup applies in a way routers already serving must have.
 */
export const SETUP_VERSION = 3;

/** The setup a router last passed, by version; 1 for one set up before versions were kept. */
export function setupVersionOf(last: unknown): number {
  if (!passedSetup(last)) return 0;
  return typeof last.version === "number" ? last.version : 1;
}

/** What a setup run leaves on the router, as the router's page and its condition read it. */
export function storedSetup(report: SetupReport): StoredSetup {
  return {
    ok: report.ok,
    version: report.ok ? SETUP_VERSION : null,
    phases: report.phases,
    blockers: report.blockers.map((b) => ({ reason: b.reason, fix: b.fix ?? null })),
  };
}

/** A run this old with no finish was ended by a restart; setup itself takes minutes. */
export const SETUP_STALE_MS = 10 * 60 * 1000;

/** What a finished setup leaves on the router. */
export interface StoredSetup {
  ok: boolean;
  /** The setup version it passed (`SETUP_VERSION`); null when it didn't pass. */
  version: number | null;
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

export function conditionOf(
  stage: RouterStage,
  status: string,
  internetOk: boolean,
): RouterCondition {
  if (stage !== "serving") return "setting-up";
  if (status === "online") return internetOk ? "serving" : "no-internet";
  return status === "error" ? "needs-attention" : "offline";
}

const WORST: RouterCondition[] = [
  "needs-attention",
  "offline",
  "no-internet",
  "setting-up",
  "serving",
];

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
  internetOk: true,
  setupStartedAt: true,
  setupPhase: true,
  lastSetupAt: true,
  lastSetup: true,
} as const;

/** A router's condition, from the fields `JOURNEY_SELECT` reads. */
export function routerCondition(
  row: JourneyRow & { lastSetup: unknown; internetOk: boolean },
): RouterCondition {
  return conditionOf(
    routerJourney(row, row.lastSetup as StoredSetup | null).stage,
    row.status,
    row.internetOk,
  );
}
