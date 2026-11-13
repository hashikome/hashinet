import type { BusinessDetail, BusinessList, Region } from "@hashinet/types";
import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { Can } from "../access/access.guard.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";
import { idParam } from "../http/id-param.js";
import { OnboardingService } from "../onboarding/onboarding.service.js";
import {
  conditionOf,
  routerJourney,
  type StoredSetup,
  worstCondition,
} from "../routers/router-journey.js";

/** The businesses on HashiNet, as its team sees them: counts and configuration, never guests. */
@Controller("api/businesses")
export class BusinessesController {
  constructor(
    private readonly db: PrismaService,
    private readonly onboarding: OnboardingService,
  ) {}

  @Get()
  @Can("business.read")
  async list(): Promise<BusinessList> {
    const rows = await this.db.business.findMany({
      orderBy: { name: "asc" },
      include: {
        memberships: {
          where: { role: "owner", status: "active" },
          orderBy: { createdAt: "asc" },
          take: 1,
          include: { user: { select: { name: true, email: true } } },
        },
        venues: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            routers: {
              select: {
                status: true,
                setupStartedAt: true,
                setupPhase: true,
                lastSetupAt: true,
                lastSetup: true,
              },
            },
          },
        },
      },
    });
    return {
      businesses: rows.map((b) => ({
        id: b.id,
        name: b.name,
        region: b.region as Region,
        area: b.area,
        owner: b.memberships[0]?.user ?? null,
        venues: b.venues.map((v) => ({ id: v.id, name: v.name, routers: v.routers.length })),
        condition: worstCondition(
          b.venues.flatMap((v) =>
            v.routers.map((r) =>
              conditionOf(routerJourney(r, r.lastSetup as StoredSetup | null).stage, r.status),
            ),
          ),
        ),
        createdAt: b.createdAt.toISOString(),
      })),
    };
  }

  @Get(":id")
  @Can("business.read")
  async get(@Param("id", idParam()) id: string): Promise<BusinessDetail> {
    const b = await this.db.business.findUnique({
      where: { id },
      include: {
        memberships: {
          // Its owners and managers; its operators are the business's own (ADR-0014, 1).
          where: { status: "active", role: { in: ["owner", "business_manager", "venue_manager"] } },
          orderBy: { createdAt: "asc" },
          include: {
            user: { select: { name: true, email: true, phone: true } },
            venues: { select: { venue: { select: { name: true } } } },
          },
        },
        venues: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            region: true,
            area: true,
            routers: {
              select: {
                status: true,
                setupStartedAt: true,
                setupPhase: true,
                lastSetupAt: true,
                lastSetup: true,
              },
            },
          },
        },
      },
    });
    if (!b) throw new NotFoundException(apiError("NOT_FOUND", "That business does not exist."));
    const stages = await this.onboarding.stages(b.id);
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
      venues: b.venues.map((v) => ({
        id: v.id,
        name: v.name,
        region: v.region as Region,
        area: v.area,
        routers: v.routers.length,
        condition: worstCondition(
          v.routers.map((r) =>
            conditionOf(routerJourney(r, r.lastSetup as StoredSetup | null).stage, r.status),
          ),
        ),
        stage: stages.get(v.id) ?? "done",
      })),
    };
  }
}
