import type { AuditAction, VenueRecord } from "@hashinet/types";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Principal } from "../access/principal.js";
import { venueScope } from "../access/venue-scope.js";
import { AuditLog } from "../audit/audit-log.js";
import { BrandService } from "../brand/brand.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";
import { OnboardingService } from "../onboarding/onboarding.service.js";
import { venueRecord } from "../serializers/records.js";
import type { VenueInput } from "./venue-input.js";

export const venueNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That venue does not exist."));

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
      include: { _count: { select: { routers: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => venueRecord(row, row._count.routers));
  }

  async get(staff: Principal, id: string): Promise<VenueRecord> {
    const row = await this.db.venue.findFirst({
      where: { id, ...venueScope(staff) },
      include: { _count: { select: { routers: true } } },
    });
    if (!row) throw venueNotFound();
    return venueRecord(row, row._count.routers);
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
      await this.onboarding.begin(created.id, tx);
      await this.audit.record(
        staff,
        { action: "venue.create", target: { type: "venue", id: created.id } },
        tx,
      );
      return created;
    });
    return venueRecord(row, 0);
  }

  async update(staff: Principal, id: string, input: VenueInput): Promise<VenueRecord> {
    await this.get(staff, id);
    // A venue never moves to another business.
    const { businessId: _ignored, ...fields } = input;
    const row = await this.db.venue.update({
      where: { id },
      data: fields,
      include: { _count: { select: { routers: true } } },
    });
    await this.record(staff, "venue.update", row.id);
    return venueRecord(row, row._count.routers);
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
    await this.record(staff, "venue.delete", id);
  }

  private async record(staff: Principal, action: AuditAction, entityId: string): Promise<void> {
    await this.audit.record(staff, { action, target: { type: "venue", id: entityId } });
  }
}
