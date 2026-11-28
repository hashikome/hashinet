import type {
  AuditAction,
  BootstrapScriptResponse,
  RouterJourney,
  RouterRecord,
} from "@hashinet/types";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { z } from "zod";
import { allows } from "../../core/access/policy.js";
import type { Principal } from "../../core/access/principal.js";
import { venueScope } from "../../core/access/venue-scope.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import type { AppConfig } from "../../core/config/config.js";
import { APP_CONFIG } from "../../core/config/config.module.js";
import { toJsonValue } from "../../core/database/json.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { captureFailure } from "../../core/observability/telemetry.js";
import { routerRecord } from "../../core/records/records.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { IssuesService, PLATFORM_WORKSPACE } from "../../platform/issues/issues.service.js";
import { RouterError } from "../mikrotik/mikrotik-errors.js";
import { RouterAccess } from "../mikrotik/router-credentials.js";
import { RouterLogger } from "../mikrotik/router-log.js";
import { RouterSync } from "../monitor/router-sync.js";
import { buildBootstrapScript } from "../provisioning/bootstrap.js";
import {
  buildHotspotPlan,
  type HotspotPlan,
  isRadioInterfaceType,
  resolveBackendEndpoints,
} from "../provisioning/context.js";
import { dialectFor } from "../provisioning/dialect.js";
import { type ProvisionReport, provisionRouter } from "../provisioning/index.js";
import { PrismaRouterStore } from "../provisioning/prisma-store.js";
import { probeRouter, type RouterProfile } from "../provisioning/probe.js";
import { probeReadiness, type ReadinessReport } from "../provisioning/readiness.js";
import { setupRouter } from "../provisioning/setup.js";
import { probeVerify, type VerifyReport } from "../provisioning/verify.js";
import { TUNNEL_ALLOCATOR, type TunnelAllocator } from "../tunnel/tunnel-allocator.js";
import { backendSettings } from "./backend-settings.js";
import type {
  bootstrapInput,
  hotspotPortInput,
  RouterInput,
  testConnectionInput,
} from "./router-input.js";
import {
  routerJourney,
  SETUP_STALE_MS,
  SETUP_VERSION,
  type StoredSetup,
  setupVersionOf,
  storedSetup,
} from "./router-journey.js";

const withVenue = { venue: { select: { name: true } } } as const;

/** The platform's issue for a router whose setup stopped after a release. */
export const setupIssueKey = (routerId: string) => `router-setup:${routerId}`;

const routerNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That router does not exist."));

/** A probe of a saved router: what it is, and whether the site is ready for setup. */
export interface ProbeResult {
  runId: string;
  profile: RouterProfile;
  interfaces: ReturnType<typeof interfacesOf>;
  plan: HotspotPlan | null;
  planError: string | null;
  readiness: ReadinessReport | null;
  log: readonly unknown[];
}

/** A run that threw before its phases could report. */
function stoppedSetup(err: unknown): StoredSetup {
  const reason = err instanceof RouterError ? err.message : "Setup stopped unexpectedly.";
  return { ok: false, version: null, phases: [], blockers: [{ reason, fix: null }] };
}

@Injectable()
export class RoutersService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly access: RouterAccess,
    private readonly sync: RouterSync,
    private readonly store: PrismaRouterStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TUNNEL_ALLOCATOR) private readonly tunnels: TunnelAllocator | null,
    private readonly issues: IssuesService,
  ) {}

  async list(staff: Principal, venueId: string | null): Promise<RouterRecord[]> {
    const rows = await this.db.router.findMany({
      where: { venue: venueScope(staff), ...(venueId === null ? {} : { venueId }) },
      include: withVenue,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => routerRecord(row, allows(staff.role, "router.manage")));
  }

  async get(staff: Principal, id: string): Promise<RouterRecord> {
    return routerRecord(await this.row(staff, id), allows(staff.role, "router.manage"));
  }

  async create(staff: Principal, input: RouterInput): Promise<RouterRecord> {
    await this.checkVenue(staff, input.venueId);
    await this.checkInstall(staff, input.venueId);
    // A router comes only from a venue's scheduled setup, never without an issue behind it
    // (ADR-0013, 1).
    const onboarding = await this.db.venueOnboarding.findUnique({
      where: { venueId: input.venueId },
      select: { setupDate: true, completedAt: true },
    });
    if (!onboarding?.setupDate && !onboarding?.completedAt) {
      throw new ConflictException(
        apiError("CONFLICT", "Agree the venue's package and schedule its setup first."),
      );
    }
    const { apiPassword, ...fields } = input;
    const row = await this.db.router.create({
      data: {
        ...fields,
        apiPasswordEncrypted: apiPassword === null ? null : this.access.sealPassword(apiPassword),
      },
      include: withVenue,
    });
    await this.record(staff, "router.create", row);
    // Nobody waits on this: a router that is not reachable yet is the normal case before its
    // bootstrap script is pasted. `syncBlocks` records its own failures.
    void this.sync.syncBlocks(row.id).catch(captureFailure);
    return routerRecord(row, allows(staff.role, "router.manage"));
  }

  /**
   * Replaces the router's settings, keeping the stored API password when none is given. The
   * venue cannot change: the router holds that venue's vouchers as hotspot users.
   */
  async update(staff: Principal, id: string, input: RouterInput): Promise<RouterRecord> {
    const existing = await this.row(staff, id);
    if (input.venueId !== existing.venueId) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          venueId: "cannot change; remove the router and add it to the other venue",
        }),
      );
    }
    const { apiPassword, ...fields } = input;
    const row = await this.db.router.update({
      where: { id },
      data: {
        ...fields,
        ...(apiPassword === null
          ? {}
          : { apiPasswordEncrypted: this.access.sealPassword(apiPassword) }),
      },
      include: withVenue,
    });
    await this.record(staff, "router.update", row, {
      passwordChanged: apiPassword !== null,
    });
    return routerRecord(row, allows(staff.role, "router.manage"));
  }

  /**
   * Deletes the router and frees its tunnel address. Safe because the platform admits a
   * tunnel peer by its public key, and the deleted router's peer is removed with it
   * (ADR-0006), so the physical router cannot use the address once it is reassigned.
   */
  async remove(staff: Principal, id: string): Promise<void> {
    const row = await this.row(staff, id);
    await this.db.router.delete({ where: { id } });
    await this.record(staff, "router.delete", row, {
      tunnelAddress: row.tunnelAddress,
    });
  }

  /** Sets the port the hotspot runs on; it takes effect at the next Set up. */
  async setHotspotPort(
    staff: Principal,
    id: string,
    input: z.infer<typeof hotspotPortInput>,
  ): Promise<RouterRecord> {
    const before = await this.installRow(staff, id);
    await this.db.router.update({
      where: { id },
      data: { hotspotInterface: input.hotspotInterface },
    });
    await this.record(staff, "router.update", before, {
      hotspotInterface: input.hotspotInterface,
      before: before.hotspotInterface,
    });
    return this.get(staff, id);
  }

  /** Puts its business's device blocks on the router now. */
  async syncNow(staff: Principal, id: string): Promise<RouterRecord> {
    await this.installRow(staff, id);
    await this.sync.syncBlocks(id);
    return this.get(staff, id);
  }

  /**
   * The script an admin pastes into a fresh router. Safe to generate again: the API password
   * and the tunnel are created once and stored (sealed), so a second script configures the
   * same credentials and key as the first. A password given here replaces the stored one.
   */
  async bootstrapScript(
    staff: Principal,
    id: string,
    input: z.infer<typeof bootstrapInput>,
  ): Promise<BootstrapScriptResponse> {
    const router = await this.installRow(staff, id);
    if (router.apiUsername === null) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          apiUsername: "set an API username on the router first",
        }),
      );
    }
    const stored = this.access.credentials(router)?.password ?? null;
    const apiPassword = input.apiPassword || stored;
    const tunnel = await this.tunnelFor(router.id);
    const built = buildBootstrapScript({
      routerName: router.name,
      ipAddress: router.ipAddress,
      ...(input.lanPrefix === undefined ? {} : { lanPrefix: input.lanPrefix }),
      ...(input.gatewayIp ? { gatewayIp: input.gatewayIp } : {}),
      apiUsername: router.apiUsername,
      ...(apiPassword ? { apiPassword } : {}),
      ...(input.adminPassword ? { adminPassword: input.adminPassword } : {}),
      ...(input.ssid || router.ssid ? { ssid: input.ssid || router.ssid || "" } : {}),
      apiPort: this.config.mikrotik.apiPort,
      tunnel,
    });
    // What went into the script goes on the router's record, so setup asserts the same SSID
    // and reaches the router with the same password.
    await this.db.router.update({
      where: { id },
      data: {
        ssid: built.resolved.ssid,
        ...(built.resolved.apiPassword === stored
          ? {}
          : { apiPasswordEncrypted: this.access.sealPassword(built.resolved.apiPassword) }),
      },
    });
    await this.record(staff, "router.bootstrap", router, {
      tunnel: tunnel !== null,
      passwordChanged: built.resolved.apiPassword !== stored,
    });
    return { ...built, tunnel: tunnel !== null };
  }

  /** Tests credentials for a router not saved yet, and previews what setup would decide. */
  async testConnection(input: z.infer<typeof testConnectionInput>) {
    const creds = {
      host: input.ipAddress,
      port: this.config.mikrotik.apiPort,
      username: input.apiUsername,
      password: input.apiPassword,
      timeoutSeconds: this.config.mikrotik.connectTimeoutSeconds,
    };
    const logger = new RouterLogger("probe");
    let profile: RouterProfile;
    try {
      profile = await probeRouter(creds, logger);
    } catch (err) {
      if (err instanceof RouterError) {
        // A failed test is a result the form shows, not an error.
        return { ok: false as const, kind: err.kind, error: err.message, hint: hintFor(err.kind) };
      }
      throw err;
    }
    const planInput = {
      ipAddress: input.ipAddress,
      hotspotInterface: input.hotspotInterface,
      networkRange: input.networkRange,
      hotspotGatewayIp: input.hotspotGatewayIp,
      hotspotName: input.hotspotName,
      ssid: input.ssid,
    };
    const { plan, planError } = planFor(planInput, profile);
    const { managementIp, managementError } = this.managementFor(input.ipAddress);
    const readiness = await probeReadiness(creds, logger, {
      profile,
      plan,
      planError,
      managementIp,
      managementError,
    }).catch(() => null);
    return {
      ok: true as const,
      board: {
        name: profile.boardName,
        identity: profile.identity,
        rosVersion: profile.rosVersion.raw,
        architecture: profile.architecture,
        uptime: profile.uptime,
      },
      readiness,
      wirelessStack: profile.wirelessStack,
      capabilities: profile.capabilities,
      compatibility: profile.compatibility,
      interfaces: interfacesOf(profile),
      plan,
      planError,
      management: managementIp,
      managementError,
    };
  }

  /** Reads the router (never writes to it), caches what it learned, and checks readiness. */
  async probe(staff: Principal, id: string): Promise<ProbeResult> {
    const router = await this.row(staff, id);
    const creds = this.credentialsOf(router);
    const logger = new RouterLogger("probe");
    const profile = await this.reach(() => probeRouter(creds, logger));
    await this.db.router.update({
      where: { id },
      data: {
        rosVersion: profile.rosVersion.raw,
        architecture: profile.architecture,
        capabilities: toJsonValue(profile.capabilities),
        model: profile.boardName ?? router.model,
        identity: profile.identity ?? router.identity,
      },
    });
    const { plan, planError } = planFor(router, profile);
    const { managementIp, managementError } = this.managementFor(router.ipAddress);
    const readiness = await probeReadiness(creds, logger, {
      profile,
      plan,
      planError,
      managementIp,
      managementError,
    }).catch(() => null);
    return {
      runId: logger.runId,
      profile,
      interfaces: interfacesOf(profile),
      plan,
      planError,
      readiness,
      log: logger.events(),
    };
  }

  /** Proves the router is serving. Reads only: it changes nothing on the router. */
  async verify(staff: Principal, id: string): Promise<VerifyReport> {
    const router = await this.row(staff, id);
    const creds = this.credentialsOf(router);
    const logger = new RouterLogger("probe");
    const profile = await this.reach(() => probeRouter(creds, logger));
    const { plan, planError } = planFor(router, profile);
    if (plan === null) {
      throw new BadRequestException(apiError("ROUTER_PLAN_INVALID", planError ?? "No plan."));
    }
    const report = await this.reach(() =>
      probeVerify(creds, logger, {
        routerId: id,
        dialect: dialectFor(profile),
        plan,
        endpoints: resolveBackendEndpoints(router.ipAddress, backendSettings(this.config)),
      }),
    );
    return report;
  }

  /** Probe, readiness, dry run, provision, re-check and self-test, in one run. */
  async journey(staff: Principal, id: string): Promise<RouterJourney> {
    const row = await this.row(staff, id);
    return routerJourney(row, row.lastSetup as StoredSetup | null);
  }

  /** Starts a setup and answers at once: it outlasts a request, and its state is on the row. */
  async startSetup(staff: Principal, id: string, force: boolean): Promise<RouterJourney> {
    await this.installRow(staff, id);
    if (!(await this.claimSetup(id))) {
      throw new ConflictException(apiError("ROUTER_SETUP_RUNNING", "Setup is already running."));
    }
    void this.runSetup(id, force);
    return this.journey(staff, id);
  }

  /**
   * After a release whose setup routers must have (`SETUP_VERSION`), every router set up before
   * (provisioned) whose last passed setup is older is set up again, one at a time (owner's decision,
   * slice 7), and so is one whose last run stopped, each hour until one passes. One that stops raises
   * an issue for HashiNet's team; a later setup that passes, this or by hand, resolves it. A router
   * never provisioned is its onboarding's to set up.
   */
  async setUpAgainAfterRelease(): Promise<void> {
    const routers = await this.db.router.findMany({
      where: { provisionedAt: { not: null } },
      select: { id: true, lastSetup: true },
      orderBy: { createdAt: "asc" },
    });
    for (const router of routers) {
      // A run that stopped passed no version (0), so it is tried again.
      if (setupVersionOf(router.lastSetup) >= SETUP_VERSION) continue;
      if (await this.claimSetup(router.id)) await this.runSetup(router.id, false);
    }
  }

  /** Marks a setup started, unless one is running; a run older than `SETUP_STALE_MS` has died. */
  private async claimSetup(id: string): Promise<boolean> {
    const stale = new Date(Date.now() - SETUP_STALE_MS);
    const { count } = await this.db.router.updateMany({
      where: { id, OR: [{ setupStartedAt: null }, { setupStartedAt: { lt: stale } }] },
      data: { setupStartedAt: new Date(), setupPhase: null },
    });
    return count === 1;
  }

  private async runSetup(id: string, force: boolean): Promise<void> {
    const outcome = await setupRouter(id, this.store, {
      force,
      onPhase: async (setupPhase) => {
        await this.db.router.update({ where: { id }, data: { setupPhase } });
      },
    }).then(storedSetup, stoppedSetup);
    await this.db.router.update({
      where: { id },
      data: {
        lastSetup: outcome as unknown as Prisma.InputJsonValue,
        lastSetupAt: new Date(),
        setupStartedAt: null,
        setupPhase: null,
      },
    });
    await this.keepSetupIssue(id, outcome.ok);
  }

  /**
   * A router whose setup stopped after it had served signs no one in: an issue for HashiNet's team
   * until a setup passes. A router never set up yet has its venue's setup issue instead.
   */
  private async keepSetupIssue(id: string, ok: boolean): Promise<void> {
    const router = await this.db.router.findUniqueOrThrow({
      where: { id },
      select: { venueId: true, provisionedAt: true },
    });
    const key = setupIssueKey(id);
    const open = await this.db.issue.findFirst({
      where: { scope: "platform", key, status: "open" },
      select: { id: true, cause: true },
    });
    const wanted =
      !ok && router.provisionedAt !== null
        ? {
            kind: "router_setup" as const,
            venueId: router.venueId,
            routerId: id,
            holderId: null,
            cause: null,
          }
        : null;
    await this.issues.keep(PLATFORM_WORKSPACE, key, open, wanted, { reason: "set_up" });
  }

  async provision(staff: Principal, id: string, dryRun: boolean): Promise<ProvisionReport> {
    await this.installRow(staff, id);
    return provisionRouter(id, this.store, { dryRun });
  }

  async latestProvision(staff: Principal, id: string) {
    const router = await this.row(staff, id);
    return {
      report: router.lastProvisionReport,
      provisionedAt: router.provisionedAt?.toISOString() ?? null,
      capabilities: router.capabilities,
      rosVersion: router.rosVersion,
      architecture: router.architecture,
    };
  }

  /** The router, if the staff member's venues include it; otherwise not found. */
  private async row(staff: Principal, id: string) {
    const row = await this.db.router.findFirst({
      where: { id, venue: venueScope(staff) },
      include: withVenue,
    });
    if (!row) throw routerNotFound();
    return row;
  }

  private credentialsOf(router: Parameters<RouterAccess["credentials"]>[0]) {
    const creds = this.access.credentials(router);
    if (!creds) {
      throw new BadRequestException(
        apiError("ROUTER_NO_CREDENTIALS", "Set the router's API username and password first."),
      );
    }
    return creds;
  }

  /** Runs work against the router; a router that cannot be reached or refuses us is a 502. */
  private async reach<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof RouterError) {
        throw new BadGatewayException(
          apiError(`ROUTER_${err.kind.toUpperCase()}`, err.message, null),
        );
      }
      throw err;
    }
  }

  private managementFor(routerHost: string) {
    try {
      const { ip } = resolveBackendEndpoints(routerHost, backendSettings(this.config)).management;
      return { managementIp: ip, managementError: null };
    } catch (err) {
      return {
        managementIp: null,
        managementError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async tunnelFor(routerId: string) {
    const settings = this.config.tunnel;
    if (settings === null || this.tunnels === null) return null;
    const tunnel = await this.tunnels.allocate(routerId);
    return {
      routerPrivateKey: tunnel.routerPrivateKey,
      routerAddress: `${tunnel.routerAddress}/${tunnel.prefix}`,
      serverPublicKey: settings.platformPublicKey,
      serverAddress: this.tunnels.platformAddress,
      endpointHost: settings.endpointHost,
      endpointPort: settings.endpointPort,
    };
  }

  /** An operator installs only at a venue whose issue is handed to them (ADR-0013, 2). */
  private async checkInstall(staff: Principal, venueId: string): Promise<void> {
    if (!(await this.issues.handedAt(staff, venueId))) {
      throw new ForbiddenException(
        apiError("FORBIDDEN", "Install a router only when its venue's setup is handed to you."),
      );
    }
  }

  /** A router to install on: within reach, and at a venue handed to an operator who asks. */
  private async installRow(staff: Principal, id: string) {
    const router = await this.row(staff, id);
    await this.checkInstall(staff, router.venueId);
    return router;
  }

  /** The venue a router is added to must be within the reader's reach. */
  private async checkVenue(staff: Principal, venueId: string): Promise<void> {
    const venue = await this.db.venue.findFirst({ where: { id: venueId, ...venueScope(staff) } });
    if (!venue) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          venueId: "no such venue",
        }),
      );
    }
  }

  /** A router's events belong to its venue and that venue's business, whoever acts. */
  private async record(
    staff: Principal,
    action: AuditAction,
    router: { id: string; venueId: string },
    details: Record<string, string | number | boolean | null> = {},
  ): Promise<void> {
    await this.audit.record(staff, {
      ...(await this.audit.atVenue(router.venueId)),
      action,
      target: { type: "router", id: router.id },
      change: { before: {}, after: details },
    });
  }
}

/** The router's interfaces, as the forms offer them for the hotspot. */
function interfacesOf(profile: RouterProfile) {
  return profile.interfaces.map((i) => ({
    name: i.name,
    type: i.type,
    running: i.running,
    disabled: i.disabled,
    isRadio: isRadioInterfaceType(i.type),
    addresses: profile.addresses
      .filter((a) => a.interface === i.name && !a.disabled)
      .map((a) => a.address),
  }));
}

function planFor(router: Parameters<typeof buildHotspotPlan>[0], profile: RouterProfile) {
  try {
    return { plan: buildHotspotPlan(router, profile), planError: null };
  } catch (err) {
    return { plan: null, planError: err instanceof Error ? err.message : String(err) };
  }
}

function hintFor(kind: RouterError["kind"]): string {
  switch (kind) {
    case "unreachable":
      return "Nothing answered the RouterOS API. Check the address, that this server can reach it, and that the API service is enabled: /ip service set api disabled=no";
    case "auth":
      return "The router refused these credentials. Confirm the user exists in a group with API access: /user add name=hashinet password=… group=full";
    default:
      return "The router answered, but the probe could not complete.";
  }
}
