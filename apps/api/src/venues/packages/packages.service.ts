import {
  type AuditAction,
  MINIMUM_PRICE_TSH,
  type PackageList,
  type PackageRecord,
  type VenuePackages,
} from "@hashinet/types";
import { Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../../core/access/principal.js";
import { businessScope, venueScope } from "../../core/access/venue-scope.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { packageRecord } from "../../core/records/records.js";
import { VenuesService } from "../venues/venues.service.js";
import { onSalePackages, venueCatalogue } from "./on-sale.js";
import type { PackageInput } from "./package-input.js";

const packageNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That package does not exist."));

/** A venue's own price for one of its business's packages, or not selling it there. */
export const venuePackageInput = z.object({
  /** Null follows the business's price. */
  priceTsh: z
    .number({ error: (issue) => (issue.code === "invalid_type" ? "must be a number" : null) })
    .int("must be a whole number")
    .min(MINIMUM_PRICE_TSH)
    .max(10_000_000)
    .nullable(),
  onSale: z.boolean(),
});

/**
 * Packages (ADR-0011, 4): the business's, sold at every venue unless a venue stopped selling one,
 * at the package's price unless the venue set its own; and a venue's own, sold only there. The
 * owner keeps the business's; the owner and business managers set a venue's prices; a venue's
 * managers add its own.
 */
@Injectable()
export class PackagesService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly venues: VenuesService,
  ) {}

  /** The business's packages and its venues' own, as the reader's venues sell them. */
  async list(staff: Principal): Promise<PackageList> {
    const venues = await this.db.venue.findMany({
      where: venueScope(staff),
      select: { id: true, businessId: true },
    });
    const ids = venues.map((v) => v.id);
    const rows = await this.db.package.findMany({
      where: {
        ...businessScope(staff),
        isActive: true,
        OR: [{ venueId: null }, { venueId: { in: ids } }],
      },
      include: {
        venues: { where: { venueId: { in: ids } } },
        ownVenue: { select: { id: true, name: true } },
      },
      // The business's first; each venue's own after them, under it.
      orderBy: [
        { venueId: { sort: "asc", nulls: "first" } },
        { priceTsh: "asc" },
        { createdAt: "asc" },
      ],
    });
    return {
      venues: ids.length,
      packages: rows.map((row) => {
        if (row.ownVenue) {
          return { ...packageRecord(row), venue: row.ownVenue, soldAt: 1, ownPrices: 0 };
        }
        const at = venues.filter((v) => v.businessId === row.businessId).length;
        const off = row.venues.filter((v) => !v.onSale).length;
        const own = row.venues.filter((v) => v.onSale && v.priceTsh !== null).length;
        return { ...packageRecord(row), venue: null, soldAt: at - off, ownPrices: own };
      }),
    };
  }

  /**
   * Every package the reader's business has, its price and where it is sold, as a CSV file
   * (ADR-0011, 10): a venue's own price on its own line. Platform staff reach every business, so
   * their file names each package's business.
   */
  async exportCsv(staff: Principal): Promise<string> {
    const venues = await this.db.venue.findMany({
      where: venueScope(staff),
      select: { id: true, name: true, businessId: true },
      orderBy: { name: "asc" },
    });
    const ids = venues.map((v) => v.id);
    const rows = await this.db.package.findMany({
      where: { ...businessScope(staff), OR: [{ venueId: null }, { venueId: { in: ids } }] },
      include: { business: { select: { name: true } }, venues: true },
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
    const lines = rows.flatMap((row) => {
      const at = venues.filter((v) =>
        row.venueId ? v.id === row.venueId : v.businessId === row.businessId,
      );
      // One line per price: the business's at the venues that follow it, then each venue's own.
      const settings = new Map(row.venues.map((x) => [x.venueId, x]));
      const sold = at
        .map((v) => ({ v, own: settings.get(v.id) ?? null }))
        .filter(({ own }) => own?.onSale !== false);
      const follow = sold.filter(({ own }) => !own?.priceTsh).map(({ v }) => v.name);
      const priced = sold.flatMap(({ v, own }) =>
        own?.priceTsh ? [{ v, price: own.priceTsh }] : [],
      );
      const line = (price: number, names: string[]) => [
        ...(platform ? [row.business.name] : []),
        row.name,
        String(row.durationMinutes),
        String(row.deviceLimit),
        String(Math.round(price)),
        row.isActive ? "Yes" : "No",
        names.join("; "),
      ];
      // A venue manager's file holds only what their venues sell.
      if (staff.venueIds !== null && sold.length === 0) return [];
      return [
        ...(follow.length || priced.length === 0 ? [line(Number(row.priceTsh), follow)] : []),
        ...priced.map(({ v, price }) => line(Number(price), [v.name])),
      ];
    });
    return `${[header, ...lines].map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
  }

  async get(staff: Principal, id: string): Promise<PackageRecord> {
    const row = await this.db.package.findFirst({
      where: { id, ...businessScope(staff), isActive: true },
    });
    if (!row) throw packageNotFound();
    return packageRecord(row);
  }

  async create(staff: Principal, input: PackageInput) {
    // `package.manage` is the owner's alone, so the principal is in a business.
    const row = await this.db.package.create({
      data: { ...input, businessId: staff.businessId ?? "" },
    });
    await this.record(staff, "package.create", row, null);
    return packageRecord(row);
  }

  /**
   * Issued vouchers keep the duration and price they were sold with; a speed change reaches
   * the routers at their next sync. A business package only: a venue's own changes from its venue.
   */
  async update(staff: Principal, id: string, input: PackageInput) {
    await this.business(staff, id);
    const row = await this.db.package.update({ where: { id }, data: input });
    await this.record(staff, "package.update", row, null);
    return packageRecord(row);
  }

  /**
   * Takes a package off sale for good: guests can no longer buy it, while vouchers already sold
   * keep working until their time ends and its sales stay in the figures. It is kept, so those
   * vouchers and figures still name it.
   */
  async remove(staff: Principal, id: string): Promise<void> {
    const pkg = await this.business(staff, id);
    await this.db.package.update({ where: { id }, data: { isActive: false } });
    await this.record(staff, "package.delete", pkg, null);
  }

  /** What a venue sells, and how it has each of its business's packages and its own. */
  async soldAt(staff: Principal, venueId: string): Promise<VenuePackages> {
    await this.venues.get(staff, venueId);
    return this.catalogueOf(venueId);
  }

  /** A venue the caller has already found in scope: what it sells, and how it has each. */
  private async catalogueOf(venueId: string): Promise<VenuePackages> {
    const all = (await venueCatalogue(this.db, venueId)) ?? [];
    return {
      packages: all
        .filter((p) => p.onSale)
        .map((p) => packageRecord({ ...p.package, priceTsh: p.priceTsh })),
      // The business's at their business price, then the venue's own.
      catalogue: all
        .map((p) => ({
          package: packageRecord(p.package),
          ownPriceTsh: p.ownPriceTsh === null ? null : p.ownPriceTsh.toFixed(2),
          onSale: p.onSale,
          own: p.own,
        }))
        .sort((a, b) => Number(a.own) - Number(b.own)),
    };
  }

  /** What a venue in the caller's scope sells, at its prices: the counter's packages. */
  async onSaleIn(staff: Principal, venueId: string): Promise<PackageRecord[]> {
    await this.venues.get(staff, venueId);
    return this.onSaleAt(venueId);
  }

  /** What a venue sells, at its prices (`onSalePackages`), for the portal, which has no principal. */
  async onSaleAt(venueId: string): Promise<PackageRecord[]> {
    return ((await onSalePackages(this.db, venueId)) ?? []).map(packageRecord);
  }

  /** A venue's own price for a business package, or not selling it there; back to the business's. */
  async setAtVenue(
    staff: Principal,
    venueId: string,
    packageId: string,
    input: z.infer<typeof venuePackageInput>,
  ): Promise<VenuePackages> {
    const venue = await this.venues.get(staff, venueId);
    const pkg = await this.business(staff, packageId);
    if (pkg.businessId !== venue.businessId) throw packageNotFound();
    if (input.onSale && input.priceTsh === null) {
      // Following the business again: nothing of the venue's own is left.
      await this.db.venuePackage.deleteMany({ where: { venueId, packageId } });
    } else {
      const data = { priceTsh: input.onSale ? input.priceTsh : null, onSale: input.onSale };
      await this.db.venuePackage.upsert({
        where: { venueId_packageId: { venueId, packageId } },
        create: { venueId, packageId, ...data },
        update: data,
      });
    }
    await this.record(staff, "package.venue.set", pkg, venueId, {
      onSale: String(input.onSale),
      priceTsh: input.priceTsh === null ? "default" : String(input.priceTsh),
    });
    return this.catalogueOf(venueId);
  }

  /** A package a venue's managers add, sold only at that venue (ADR-0011, 4). */
  async createOwn(staff: Principal, venueId: string, input: PackageInput): Promise<VenuePackages> {
    const venue = await this.venues.get(staff, venueId);
    const row = await this.db.package.create({
      data: { ...input, businessId: venue.businessId, venueId },
    });
    await this.record(staff, "package.create", row, venueId);
    return this.catalogueOf(venueId);
  }

  async updateOwn(
    staff: Principal,
    venueId: string,
    id: string,
    input: PackageInput,
  ): Promise<VenuePackages> {
    await this.own(staff, venueId, id);
    const row = await this.db.package.update({ where: { id }, data: input });
    await this.record(staff, "package.update", row, venueId);
    return this.catalogueOf(venueId);
  }

  async removeOwn(staff: Principal, venueId: string, id: string): Promise<VenuePackages> {
    const pkg = await this.own(staff, venueId, id);
    await this.db.package.update({ where: { id }, data: { isActive: false } });
    await this.record(staff, "package.delete", pkg, venueId);
    return this.catalogueOf(venueId);
  }

  /** A business package, as the owner keeps them; a venue's own is not found here. */
  private async business(staff: Principal, id: string) {
    const row = await this.db.package.findFirst({
      where: { id, ...businessScope(staff), isActive: true, venueId: null },
    });
    if (!row) throw packageNotFound();
    return row;
  }

  /** A venue's own package, within the reader's venues. */
  private async own(staff: Principal, venueId: string, id: string) {
    await this.venues.get(staff, venueId);
    const row = await this.db.package.findFirst({ where: { id, venueId, isActive: true } });
    if (!row) throw packageNotFound();
    return row;
  }

  /** A package is its business's; a change at a venue also names the venue. */
  private async record(
    staff: Principal,
    action: AuditAction,
    pkg: { id: string; businessId: string },
    venueId: string | null,
    details: Record<string, string> = {},
  ): Promise<void> {
    await this.audit.record(staff, {
      action,
      businessId: pkg.businessId,
      venueId,
      target: { type: "package", id: pkg.id },
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
