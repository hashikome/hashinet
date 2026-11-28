import { type IssueEventData } from "@hashinet/types";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../core/database/prisma.service.js";
import { captureFailure } from "../../core/observability/telemetry.js";
import { JOURNEY_SELECT, routerCondition } from "../../network/routers/router-journey.js";

import { IssuesService, PLATFORM_WORKSPACE } from "./issues.service.js";

/** Router issues kept in step with the routers: opened as one stops answering, logged, closed. */
@Injectable()
export class RouterIssues {
  constructor(
    private readonly db: PrismaService,
    private readonly issues: IssuesService,
  ) {}

  /**
   * Keeps router issues in step with the routers: a router that has served and stopped answering
   * opens one in the platform's workspace and in its business's; serving again, or the router
   * being removed, resolves both. A router still being set up raises none.
   */
  async syncRouterIssues(): Promise<void> {
    const [routers, open] = await Promise.all([
      this.db.router.findMany({
        select: {
          id: true,
          venueId: true,
          venue: { select: { businessId: true } },
          ...JOURNEY_SELECT,
        },
      }),
      this.db.issue.findMany({
        where: { kind: "router_offline", status: "open" },
        select: { scope: true, businessId: true, key: true },
      }),
    ]);
    const openKeys = new Set(open.map((i) => `${i.scope}|${i.businessId}|${i.key}`));
    const down = new Map<string, (typeof routers)[number]>();
    for (const r of routers) {
      const condition = routerCondition(r);
      if (condition === "offline" || condition === "no-internet" || condition === "needs-attention")
        down.set(`router:${r.id}`, r);
    }
    for (const [key, r] of down) {
      for (const workspace of [
        PLATFORM_WORKSPACE,
        { scope: "business" as const, businessId: r.venue.businessId },
      ]) {
        if (openKeys.has(`${workspace.scope}|${workspace.businessId}|${key}`)) continue;
        await this.issues
          .open({
            ...workspace,
            kind: "router_offline",
            key,
            venueId: r.venueId,
            routerId: r.id,
            holderId: null,
            cause: routerCondition(r),
          })
          .catch(captureFailure);
      }
    }
    const present = new Set(routers.map((r) => `router:${r.id}`));
    for (const i of open) {
      if (down.has(i.key)) continue;
      const reason = present.has(i.key) ? "serving" : "router_removed";
      await this.issues.resolve(i, i.key, { reason }).catch(captureFailure);
    }
  }

  /**
   * A step HashiNet took about a router, such as giving guests back the time an outage took, on
   * the router's latest issue in each workspace that has one.
   */
  async logRouterStep(routerId: string, data: IssueEventData): Promise<void> {
    const issues = await this.db.issue.findMany({
      where: { kind: "router_offline", key: `router:${routerId}` },
      orderBy: { openedAt: "desc" },
      distinct: ["scope", "businessId"],
      select: { id: true },
    });
    if (issues.length === 0) return;
    await this.db.issueEvent.createMany({
      data: issues.map((i) => ({ issueId: i.id, action: "step" as const, data })),
    });
  }
}
