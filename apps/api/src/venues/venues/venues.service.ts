import type { AuditAction, VenueRecord } from "@hashinet/types";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import type { Principal } from "../../core/access/principal.js";
import { venueScope } from "../../core/access/venue-scope.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { venueRecord } from "../../core/records/records.js";
import { BrandService } from "../../guest/brand/brand.service.js";
import { copyToVenue } from "../../guest/portal/copy-down.js";
import { OnboardingService } from "../../platform/onboarding/onboarding.service.js";
import { venueNotFound } from "./venue-errors.js";
import type { VenueInput } from "./venue-input.js";

/** What its routers say about it: how many, whether it sells, and the WiFi it broadcasts. */
const VENUE_COUNTS = {
  // Whether its business may sell at all (ADR-0014, 2).
  business: { select: { access: true } },
  routers: {
    select: {
      status: true,
      internetOk: true,
      lastSetup: true,
      lastSeenAt: true,
      internetSeenAt: true,
      ssid: true,
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

@Injectable()
export class VenuesService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly brand: BrandService,
    private readonly onboarding: OnboardingService,
  ) {}

  /** Newest first, each with its number of routers. */
  async list(staff: Principal): Promise<VenueRecord[]> {
    const rows = await this.db.venue.findMany({
      where: venueScope(staff),
      include: VENUE_COUNTS,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => venueRecord(row, row.routers, row.business.access));
  }

  async get(staff: Principal, id: string): Promise<VenueRecord> {
    const row = await this.db.venue.findFirst({
      where: { id, ...venueScope(staff) },
      include: VENUE_COUNTS,
    });
    if (!row) throw venueNotFound();
    return venueRecord(row, row.routers, row.business.access);
  }

  /** Who runs a venue day to day: its venue managers, by name. */
  async managers(venueId: string): Promise<{ name: string; email: string }[]> {
    const rows = await this.db.membership.findMany({
      where: { role: "venue_manager", status: "active", venues: { some: { venueId } } },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { name: true, email: true } } },
    });
    return rows.map((m) => m.user);
  }

  async create(staff: Principal, input: VenueInput): Promise<VenueRecord> {
    const { businessId: named, ...fields } = input;
    const businessId = staff.scope === "platform" ? named : staff.businessId;
    if (!businessId) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Choose the business the venue belongs to.", {
          businessId: "is required",
        }),
      );
    }
    const business = await this.db.business.findUnique({ where: { id: businessId } });
    if (!business) throw venueNotFound();
    // Every venue starts at its package: no router comes without an issue behind it (ADR-0013, 1).
    const row = await this.db.$transaction(async (tx) => {
      const created = await tx.venue.create({ data: { ...fields, businessId } });
      // Its portal starts as the business's new venues do (ADR-0009).
      await copyToVenue(tx, created.id, businessId);
      await this.onboarding.begin(created.id, tx);
      await this.audit.record(
        staff,
        {
          action: "venue.create",
          businessId: created.businessId,
          venueId: created.id,
          target: { type: "venue", id: created.id },
        },
        tx,
      );
      return created;
    });
    return venueRecord(row, [], business.access);
  }

  async update(staff: Principal, id: string, input: VenueInput): Promise<VenueRecord> {
    await this.get(staff, id);
    // A venue never moves to another business.
    const { businessId: _ignored, ...fields } = input;
    const row = await this.db.venue.update({
      where: { id },
      data: fields,
      include: VENUE_COUNTS,
    });
    await this.record(staff, "venue.update", row);
    return venueRecord(row, row.routers, row.business.access);
  }

  /**
   * Refused while the venue has routers: deleting it would delete their records and tunnel
   * keys while the routers kept running, unmanaged.
   */
  async remove(staff: Principal, id: string): Promise<void> {
    const venue = await this.get(staff, id);
    if (venue.routerCount > 0) {
      throw new ConflictException(
        apiError("VENUE_HAS_ROUTERS", "Remove this venue's routers before deleting it."),
      );
    }
    await this.brand.forget(id);
    await this.db.venue.delete({ where: { id } });
    await this.record(staff, "venue.delete", venue);
  }

  private async record(
    staff: Principal,
    action: AuditAction,
    venue: { id: string; businessId: string },
  ): Promise<void> {
    await this.audit.record(staff, {
      action,
      businessId: venue.businessId,
      venueId: venue.id,
      target: { type: "venue", id: venue.id },
    });
  }
}
