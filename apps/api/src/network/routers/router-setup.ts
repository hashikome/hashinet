import type { RouterJourney } from "@hashinet/types";
import { ConflictException, Injectable } from "@nestjs/common";
import type { Principal } from "../../core/access/principal.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { IssuesService, PLATFORM_WORKSPACE } from "../../platform/issues/issues.service.js";
import { RouterError } from "../mikrotik/mikrotik-errors.js";
import { type ProvisionReport, provisionRouter } from "../provisioning/index.js";
import { PrismaRouterStore } from "../provisioning/prisma-store.js";
import { setupRouter } from "../provisioning/setup.js";
import {
  SETUP_STALE_MS,
  SETUP_VERSION,
  type StoredSetup,
  setupVersionOf,
  storedSetup,
} from "./router-journey.js";

import { RoutersService } from "./routers.service.js";

/** The platform's issue for a router whose setup stopped after a release. */
export const setupIssueKey = (routerId: string) => `router-setup:${routerId}`;

/** A run that threw before its phases could report. */
function stoppedSetup(err: unknown): StoredSetup {
  const reason = err instanceof RouterError ? err.message : "Setup stopped unexpectedly.";
  return { ok: false, version: null, phases: [], blockers: [{ reason, fix: null }] };
}

/**
 * Running a router's setup: from its page, again after a release for a setup an older one left,
 * and its provision runs.
 */
@Injectable()
export class RouterSetup {
  constructor(
    private readonly db: PrismaService,
    private readonly store: PrismaRouterStore,
    private readonly issues: IssuesService,
    private readonly routers: RoutersService,
  ) {}

  /** Starts a setup and answers at once: it outlasts a request, and its state is on the row. */
  async startSetup(staff: Principal, id: string, force: boolean): Promise<RouterJourney> {
    await this.routers.installRow(staff, id);
    if (!(await this.claimSetup(id))) {
      throw new ConflictException(apiError("ROUTER_SETUP_RUNNING", "Setup is already running."));
    }
    void this.runSetup(id, force);
    return this.routers.journey(staff, id);
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
    await this.routers.installRow(staff, id);
    return provisionRouter(id, this.store, { dryRun });
  }

  async latestProvision(staff: Principal, id: string) {
    const router = await this.routers.row(staff, id);
    return {
      report: router.lastProvisionReport,
      provisionedAt: router.provisionedAt?.toISOString() ?? null,
      capabilities: router.capabilities,
      rosVersion: router.rosVersion,
      architecture: router.architecture,
    };
  }
}
