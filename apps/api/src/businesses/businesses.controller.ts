import type { BusinessDetail, BusinessList, BusinessSummary, Region } from "@hashinet/types";
import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { Can } from "../access/access.guard.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { apiError } from "../http/error-envelope.js";
import { idParam } from "../http/id-param.js";
import { VENUE_FACTS, type VenueFacts, venueStage } from "../onboarding/onboarding-stage.js";
import { routerCondition, worstCondition } from "../routers/router-journey.js";

const venueSelect = {
  orderBy: { createdAt: "asc" },
  include: VENUE_FACTS,
} as const satisfies Prisma.Business$venuesArgs;

type Counts = Map<string, { onlineNow: number; midSession: number }>;

/**
 * The businesses on HashiNet, as its team sees them: who owns and manages each, and each venue's
 * way to serving with its guests as counts only (ADR-0014, 1).
 */
@Controller("api/businesses")
export class BusinessesController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  @Can("business.read")
  async list(): Promise<BusinessList> {
    const [rows, counts] = await Promise.all([
      this.db.business.findMany({
        orderBy: { name: "asc" },
        include: {
          memberships: {
            where: { role: "owner", status: "active" },
            orderBy: { createdAt: "asc" },
            take: 1,
            include: { user: { select: { name: true, email: true } } },
          },
          venues: venueSelect,
        },
      }),
      this.guestCounts({}),
    ]);
    return {
      businesses: rows.map((b) => {
        const venues = b.venues.map((v) => venueOf(v, counts));
        return {
          id: b.id,
          name: b.name,
          region: b.region as Region,
          area: b.area,
          owner: b.memberships[0]?.user ?? null,
          venues,
          // The worst of its routers: a venue with none adds nothing.
          condition: worstCondition(venues.filter((v) => v.routers > 0).map((v) => v.condition)),
          createdAt: b.createdAt.toISOString(),
        };
      }),
    };
  }

  @Get(":id")
  @Can("business.read")
  async get(@Param("id", idParam()) id: string): Promise<BusinessDetail> {
    const [b, counts] = await Promise.all([
      this.db.business.findUnique({
        where: { id },
        include: {
          memberships: {
            // Its owners and managers; its operators are the business's own (ADR-0014, 1).
            where: {
              status: "active",
              role: { in: ["owner", "business_manager", "venue_manager"] },
            },
            orderBy: { createdAt: "asc" },
            include: {
              user: { select: { name: true, email: true, phone: true } },
              venues: { select: { venue: { select: { name: true } } } },
            },
          },
          venues: venueSelect,
        },
      }),
      this.guestCounts({ venue: { businessId: id } }),
    ]);
    if (!b) throw new NotFoundException(apiError("NOT_FOUND", "That business does not exist."));
    const owner = b.memberships.find((m) => m.role === "owner");
    return {
      id: b.id,
      name: b.name,
      region: b.region as Region,
      area: b.area,
      createdAt: b.createdAt.toISOString(),
      owner: owner ? owner.user : null,
      people: b.memberships.map((m) => ({
        membershipId: m.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        venues: m.venues.map((v) => v.venue.name),
      })),
      venues: b.venues.map((v) => venueOf(v, counts)),
    };
  }

  /**
   * Devices on a session at each venue: at a router that answers (online now), or not
   * (mid-session: their time runs while the router is down). Counts, never who.
   */
  private async guestCounts(where: Prisma.WifiSessionWhereInput): Promise<Counts> {
    const rows = await this.db.wifiSession.groupBy({
      by: ["venueId", "routerId"],
      where: { ...where, status: "connected", venueId: { not: null } },
      _count: { _all: true },
    });
    const routerIds = rows.flatMap((r) => (r.routerId ? [r.routerId] : []));
    const online = new Set(
      (
        await this.db.router.findMany({
          where: { status: "online", id: { in: routerIds } },
          select: { id: true },
        })
      ).map((r) => r.id),
    );
    const counts: Counts = new Map();
    for (const r of rows) {
      if (!r.venueId) continue;
      const c = counts.get(r.venueId) ?? { onlineNow: 0, midSession: 0 };
      if (r.routerId && online.has(r.routerId)) c.onlineNow += r._count._all;
      else c.midSession += r._count._all;
      counts.set(r.venueId, c);
    }
    return counts;
  }
}

/** A venue as the platform lists it: where it is, its condition and stage, its guests as counts. */
function venueOf(
  v: VenueFacts & { id: string; name: string; region: string; area: string },
  counts: Counts,
): BusinessSummary["venues"][number] {
  const c = counts.get(v.id);
  return {
    id: v.id,
    name: v.name,
    region: v.region as Region,
    area: v.area,
    routers: v.routers.length,
    condition: worstCondition(v.routers.map(routerCondition)),
    stage: venueStage(v),
    onlineNow: c?.onlineNow ?? 0,
    midSession: c?.midSession ?? 0,
  };
}
