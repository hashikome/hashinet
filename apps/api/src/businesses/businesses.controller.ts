import type { BusinessList, Region, RouterStatus } from "@hashinet/types";
import { Controller, Get } from "@nestjs/common";
import { Can } from "../access/access.guard.js";
import { PrismaService } from "../database/prisma.service.js";

/** The businesses on HashiNet, as its team sees them. Each business's own page comes in slice 3. */
@Controller("api/businesses")
export class BusinessesController {
  constructor(private readonly db: PrismaService) {}

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
          select: { id: true, name: true, routers: { select: { status: true } } },
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
        venues: b.venues.map((v) => ({
          id: v.id,
          name: v.name,
          routers: v.routers.map((r) => r.status as RouterStatus),
        })),
        createdAt: b.createdAt.toISOString(),
      })),
    };
  }
}
