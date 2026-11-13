import type { GuestCounts } from "@hashinet/types";
import { Controller, Get, Injectable, Module } from "@nestjs/common";
import { Can } from "../access/access.guard.js";
import { PrismaService } from "../database/prisma.service.js";

/**
 * A business's guests as HashiNet's team sees them: counts per venue, never a device, MAC
 * address, code or session, and nothing to end or block (ADR-0014, 1). The lists are the
 * business's own.
 */
@Injectable()
export class GuestCountsService {
  constructor(private readonly db: PrismaService) {}

  async counts(): Promise<GuestCounts> {
    const [venues, online, mid] = await Promise.all([
      this.db.venue.findMany({
        select: { id: true, name: true, business: { select: { id: true, name: true } } },
        orderBy: [{ business: { name: "asc" } }, { name: "asc" }],
      }),
      this.byVenue(true),
      this.byVenue(false),
    ]);
    return {
      venues: venues.map((v) => ({
        venue: { id: v.id, name: v.name },
        business: v.business,
        onlineNow: online.get(v.id) ?? 0,
        midSession: mid.get(v.id) ?? 0,
      })),
    };
  }

  /** Devices on a session at each venue, at a router that answers (online now) or not
   * (mid-session: their time runs while the router is down). */
  private async byVenue(routerOnline: boolean): Promise<Map<string, number>> {
    const rows = await this.db.wifiSession.groupBy({
      by: ["venueId"],
      where: {
        status: "connected",
        venueId: { not: null },
        router: routerOnline ? { status: "online" } : { status: { not: "online" } },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.venueId ?? "", r._count._all]));
  }
}

@Controller("api/guest-counts")
export class GuestCountsController {
  constructor(private readonly guests: GuestCountsService) {}

  @Get()
  @Can("guest.count")
  counts(): Promise<GuestCounts> {
    return this.guests.counts();
  }
}

@Module({ controllers: [GuestCountsController], providers: [GuestCountsService] })
export class GuestCountsModule {}
