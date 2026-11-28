import type { Timestamp } from "./core.ts";

export type RouterStatus = "online" | "offline" | "provisioning" | "error";

/** A router as the API shows it. Credentials and tunnel keys never leave the API. */
export interface RouterRecord {
  id: string;
  venueId: string;
  venueName: string;
  name: string;
  model: string | null;
  identity: string | null;
  /** The router's address on its venue LAN. */
  ipAddress: string;
  hotspotGatewayIp: string | null;
  macAddress: string | null;
  apiUsername: string | null;
  /** Whether an API password is stored; the password itself is never returned. */
  hasApiPassword: boolean;
  enableHotspot: boolean;
  hotspotName: string | null;
  hotspotInterface: string | null;
  ssid: string | null;
  networkRange: string | null;
  /**
   * Extra RouterOS commands run at provisioning. Admins only: null for managers, since it may
   * hold credentials.
   */
  provisioningCommand: string | null;
  /** The router's address in the management tunnel, once allocated. */
  tunnelAddress: string | null;
  rosVersion: string | null;
  architecture: string | null;
  provisionedAt: Timestamp | null;
  lastSeenAt: Timestamp | null;
  /** Syncs and pushes that failed in a row; 0 once one works. */
  failedSyncs: number;
  uptimeSeconds: number;
  connectedDevices: number;
  status: RouterStatus;
  /** What the owner does next with this router. */
  stage: RouterStage;
  condition: RouterCondition;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Where a router stands in the owner's journey: what to do next. */
export type RouterStage = "connect" | "set-up" | "serving";

/**
 * How a router, or a business across its routers, is doing, as every page says it: being set up
 * until it first serves; then serving, offline, or needing attention (an error).
 */
/** "no-internet": it answers, but can't reach the internet itself, so guests get nothing. */
export const ROUTER_CONDITIONS = [
  "setting-up",
  "serving",
  "offline",
  "no-internet",
  "needs-attention",
] as const;
export type RouterCondition = (typeof ROUTER_CONDITIONS)[number];

export type RouterSetupPhaseStatus = "pending" | "running" | "pass" | "warn" | "fail" | "skipped";

export interface RouterSetupPhase {
  id: string;
  title: string;
  status: RouterSetupPhaseStatus;
  detail: string | null;
}

/** `POST /api/routers/:id/verify`: the router's health, check by check. */
export interface RouterChecks {
  /** False when something proves the hotspot is not serving. */
  ok: boolean;
  checks: {
    id: string;
    title: string;
    status: "pass" | "warn" | "fail" | "skipped";
    detail: string;
    /** What to do about it, when there is something to do. */
    fix?: string;
  }[];
  /** What a machine cannot prove: it still needs a phone. */
  manual: string[];
  summary: { pass: number; warn: number; fail: number; skipped: number };
}

/** `GET /api/routers/:id/journey`, and the answer to starting a setup. */
export interface RouterJourney {
  stage: RouterStage;
  /** Whether the API has reached the router recently. */
  connected: boolean;
  running: boolean;
  /** A run stopped by a restart, not by the router. */
  interrupted: boolean;
  /** The last finished run's outcome, or null before the first. */
  ok: boolean | null;
  finishedAt: Timestamp | null;
  phases: RouterSetupPhase[];
  /** What stopped the last run, and how to fix it. */
  blockers: { reason: string; fix: string | null }[];
}

/** `GET /api/routers`. */
export interface RouterList {
  routers: RouterRecord[];
}

/** `GET` and `PUT /api/routers/:id`, `POST /api/routers`, and `POST /api/routers/:id/sync`. */
export interface RouterResponse {
  router: RouterRecord;
}

/**
 * `POST /api/routers/:id/bootstrap-script`. Carries the router's API password, the one response
 * that does: it has to be typed into the router.
 */
export interface BootstrapScriptResponse {
  script: string;
  warnings: string[];
  resolved: {
    routerName: string;
    ipAddress: string;
    lanCidr: string;
    gatewayIp: string;
    apiUsername: string;
    apiPassword: string;
    apiPort: number;
    ssid: string;
    apiPasswordGenerated: boolean;
  };
  /** Whether the script opens the management tunnel. */
  tunnel: boolean;
}
