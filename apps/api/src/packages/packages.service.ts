import type { AuditAction, PackageRecord, VenuePackages } from "@hashinet/types";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { Principal } from "../access/principal.js";
import { businessScope } from "../access/venue-scope.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";
import { packageRecord } from "../serializers/records.js";
import { VenuesService } from "../venues/venues.service.js";
import type { PackageInput } from "./package-input.js";

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
      where: { ...businessScope(staff), isActive: true },
      orderBy: [{ priceTsh: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(packageRecord);
  }

  /**
   * Every package the reader's business has, its price and where it is sold, as a CSV file
   * (ADR-0011, 10; business-scopes M4). A package assigned to no venue is sold at every venue.
   * Platform staff reach every business, so their file names each package's business.
   */
  async exportCsv(staff: Principal): Promise<string> {
    const rows = await this.db.package.findMany({
      where: businessScope(staff),
      include: {
        business: { select: { name: true } },
        venues: { include: { venue: { select: { id: true, name: true } } } },
      },
      orderBy: [{ businessId: "asc" }, { priceTsh: "asc" }, { createdAt: "asc" }],
    });
    const platform = staff.scope === "platform";
    const header = [
      ...(platform ? ["Business"] : []),
      "Package",
      "Minutes",
      "Devices",
      "Price (TSh)",
      "On sale",
      "Sold at",
    ];
    // A reader limited to some venues sees the packages sold there, and those venues' names.
    const mine = (venueId: string) => staff.venueIds === null || staff.venueIds.includes(venueId);
    const visible = rows.filter(
      (row) => row.venues.length === 0 || row.venues.some((v) => mine(v.venueId)),
    );
    const lines = visible.map((row) => [
      ...(platform ? [row.business.name] : []),
      row.name,
      String(row.durationMinutes),
      String(row.deviceLimit),
      String(Math.round(Number(row.priceTsh))),
      row.isActive ? "Yes" : "No",
      row.venues.length === 0
        ? "Every venue"
        : row.venues
            .filter((v) => mine(v.venueId))
            .map((v) => v.venue.name)
            .sort()
            .join("; "),
    ]);
    return [header, ...lines].map((cells) => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  async get(staff: Principal, id: string): Promise<PackageRecord> {
    const row = await this.db.package.findFirst({
      where: {
        id,
        ...businessScope(staff),
        isActive: true,
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

  /**
   * Takes a package off sale for good: guests can no longer buy it, while vouchers already printed
   * or sold keep working until their time ends and its sales stay in the figures. It is kept, so
   * those vouchers and figures still name it.
   */
  async remove(staff: Principal, id: string): Promise<void> {
    await this.get(staff, id);
    await this.db.package.update({ where: { id }, data: { isActive: false } });
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

/**
 * One CSV cell: quoted when it holds a comma, quote or line break, and kept from running as a
 * spreadsheet formula when it starts with one of `= + - @` (a package name is anyone's text).
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
