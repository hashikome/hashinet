import type { AuditAction, PackageRecord, VenuePackages } from "@hashinet/types";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Principal } from "../access/principal.js";
import { businessScope } from "../access/venue-scope.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";
import { packageRecord } from "../serializers/records.js";
import { VenuesService } from "../venues/venues.service.js";
import type { PackageInput } from "./package-input.js";

/** Vouchers a package is still behind: deleting it would leave them without speed or time. */
const LIVE_VOUCHERS = ["unused", "pending_activation", "active"] as const;

export const packageNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That package does not exist."));

/**
 * Packages are one catalogue shared by every venue; a venue sells the ones assigned to it, or
 * every active one when none are assigned.
 */
@Injectable()
export class PackagesService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly venues: VenuesService,
  ) {}

  /** Admins see the whole catalogue; managers only what can be sold. */
  async list(staff: Principal): Promise<PackageRecord[]> {
    const rows = await this.db.package.findMany({
      where: { ...businessScope(staff), ...(seesInactive(staff) ? {} : { isActive: true }) },
      orderBy: [{ priceTsh: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(packageRecord);
  }

  async get(staff: Principal, id: string): Promise<PackageRecord> {
    const row = await this.db.package.findFirst({
      where: {
        id,
        ...businessScope(staff),
        ...(seesInactive(staff) ? {} : { isActive: true }),
      },
    });
    if (!row) throw packageNotFound();
    return packageRecord(row);
  }

  async create(staff: Principal, input: PackageInput) {
    // `package.manage` is the owner's alone, so the principal is in a business.
    const row = await this.db.package.create({
      data: { ...input, businessId: staff.businessId ?? "" },
    });
    await this.record(staff, "package.create", row.id);
    return packageRecord(row);
  }

  /**
   * Issued vouchers keep the duration and price they were sold with; a speed change reaches
   * the routers at their next sync.
   */
  async update(staff: Principal, id: string, input: PackageInput) {
    await this.get(staff, id);
    const row = await this.db.package.update({ where: { id }, data: input });
    await this.record(staff, "package.update", row.id);
    return packageRecord(row);
  }

  /** Refused while vouchers depend on it; deactivating takes it off sale instead. */
  async remove(staff: Principal, id: string): Promise<void> {
    await this.get(staff, id);
    const live = await this.db.voucher.count({
      where: { packageId: id, status: { in: [...LIVE_VOUCHERS] } },
    });
    if (live > 0) {
      throw new ConflictException(
        apiError(
          "PACKAGE_IN_USE",
          `${live} voucher${live === 1 ? " uses" : "s use"} this package. Deactivate it to stop selling it.`,
        ),
      );
    }
    await this.db.package.delete({ where: { id } });
    await this.record(staff, "package.delete", id);
  }

  /** What a venue sells: its assigned packages that are active, or every active package. */
  async soldAt(staff: Principal, venueId: string): Promise<VenuePackages> {
    await this.venues.get(staff, venueId);
    const assigned = await this.db.venuePackage.findMany({
      where: { venueId },
      select: { packageId: true },
    });
    const assignedPackageIds = assigned.map((a) => a.packageId);
    const packages = await this.onSaleAt(venueId);
    return { packages, assignedPackageIds, sellsAll: assignedPackageIds.length === 0 };
  }

  /**
   * The rule for what a venue sells, for the guest portal, which has no principal: its business's
   * active packages, narrowed to the ones assigned to it when there are any. Never another
   * business's.
   */
  async onSaleAt(venueId: string): Promise<PackageRecord[]> {
    const venue = await this.db.venue.findUnique({ where: { id: venueId } });
    if (!venue) return [];
    const assigned = await this.db.venuePackage.findMany({
      where: { venueId },
      select: { packageId: true },
    });
    const ids = assigned.map((a) => a.packageId);
    const rows = await this.db.package.findMany({
      where: {
        businessId: venue.businessId,
        isActive: true,
        ...(ids.length === 0 ? {} : { id: { in: ids } }),
      },
      orderBy: [{ priceTsh: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(packageRecord);
  }

  /** Puts a package on sale at a venue. Idempotent. */
  async assign(staff: Principal, venueId: string, packageId: string) {
    const venue = await this.venues.get(staff, venueId);
    const pkg = await this.get(staff, packageId);
    // A venue sells only its own business's packages; anything else is not found.
    if (pkg.businessId !== venue.businessId) throw packageNotFound();
    await this.db.venuePackage.upsert({
      where: { venueId_packageId: { venueId, packageId } },
      create: { venueId, packageId },
      update: {},
    });
    await this.record(staff, "package.venue.assign", packageId, { venueId });
    return this.soldAt(staff, venueId);
  }

  /** Takes a package off sale at a venue. Idempotent. */
  async unassign(staff: Principal, venueId: string, packageId: string) {
    await this.venues.get(staff, venueId);
    const removed = await this.db.venuePackage.deleteMany({ where: { venueId, packageId } });
    if (removed.count > 0) {
      await this.record(staff, "package.venue.unassign", packageId, { venueId });
    }
    return this.soldAt(staff, venueId);
  }

  private async record(
    staff: Principal,
    action: AuditAction,
    entityId: string,
    details: Record<string, string> = {},
  ): Promise<void> {
    await this.audit.record(staff, {
      action,
      target: { type: "package", id: entityId },
      change: { before: {}, after: details },
    });
  }
}

/** The owner and platform staff see packages taken off sale; everyone else only what is on sale. */
function seesInactive(staff: Principal): boolean {
  return staff.scope === "platform" || staff.role === "owner";
}
