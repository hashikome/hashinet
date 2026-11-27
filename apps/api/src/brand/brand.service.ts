import type { AuditAction, GuestContext, PortalEditor, PortalLook } from "@hashinet/types";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Principal } from "../access/principal.js";
import { venueScope } from "../access/venue-scope.js";
import { AuditLog } from "../audit/audit-log.js";
import { sellingStopped } from "../billing/access-rule.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Package, ServiceAccess, Venue } from "../generated/prisma/client.js";
import { guestContext } from "../guest/guest-context.js";
import { apiError } from "../http/error-envelope.js";
import { onSalePackages } from "../packages/on-sale.js";
import { platformLook } from "../portal/copy-down.js";
import { PortalService } from "../portal/portal.service.js";
import { lookOf } from "../portal/portal-input.js";
import { packageRecord } from "../serializers/records.js";
import { venueNotFound } from "../venues/venue-errors.js";
import { Logos, logoUrl } from "./logos.js";

const noTemplate = () =>
  new NotFoundException(apiError("NOT_FOUND", "This business has no portal to change."));

/**
 * Each business's and venue's captive portal (ADR-0009). A venue's portal is its own copy, made
 * from its business's template when the venue is created; a venue's owner and managers change it.
 * The template is what new venues start with, changed by whoever reaches the whole business; while a
 * business has one venue, the two are kept the same. The logo is the venue's own, else the
 * business's.
 */
@Injectable()
export class BrandService {
  constructor(
    private readonly db: PrismaService,
    private readonly portal: PortalService,
    private readonly audit: AuditLog,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logos: Logos,
  ) {}

  /** What a guest at a venue sees: its portal and the logo to show. */
  async resolve(venueId: string): Promise<{ look: PortalLook; logoUrl: string | null }> {
    const venue = await this.db.venue.findUniqueOrThrow({
      where: { id: venueId },
      include: { portal: true, business: { include: { portal: true } } },
    });
    // A venue made outside the services (a fixture) shows its business's, as a new one would.
    const look = venue.portal
      ? lookOf(venue.portal)
      : venue.business.portal
        ? lookOf(venue.business.portal)
        : await platformLook(this.db);
    return { look, logoUrl: logoUrl(venue.portal?.logoKey ?? venue.business.logoKey) };
  }

  // ── A venue's own ──────────────────────────────────────────────────

  async ofVenue(staff: Principal, id: string): Promise<PortalEditor> {
    const venue = await this.venueOf(staff, id);
    return this.venueEditor(venue);
  }

  async saveVenue(staff: Principal, id: string, look: PortalLook): Promise<PortalEditor> {
    const venue = await this.venueOf(staff, id);
    await this.db.$transaction(async (tx) => {
      await tx.venuePortal.upsert({
        where: { venueId: id },
        create: { venueId: id, ...look },
        update: look,
      });
      // With one venue, the business is that venue: its next venue starts the same.
      if ((await tx.venue.count({ where: { businessId: venue.businessId } })) === 1) {
        await tx.businessPortal.upsert({
          where: { businessId: venue.businessId },
          create: { businessId: venue.businessId, ...look },
          update: look,
        });
      }
    });
    await this.recordVenue(staff, "brand.update", venue);
    return this.venueEditor(venue);
  }

  /** Back to what the business's new venues start with; the venue's logo stays. */
  async restoreVenue(staff: Principal, id: string): Promise<PortalEditor> {
    const venue = await this.venueOf(staff, id);
    const template = await this.db.businessPortal.findUnique({
      where: { businessId: venue.businessId },
    });
    const look = template ? lookOf(template) : await platformLook(this.db);
    await this.db.venuePortal.upsert({
      where: { venueId: id },
      create: { venueId: id, ...look },
      update: look,
    });
    await this.recordVenue(staff, "brand.reset", venue);
    return this.venueEditor(venue);
  }

  async putLogo(staff: Principal, id: string, upload: Uint8Array): Promise<PortalEditor> {
    const venue = await this.venueOf(staff, id);
    const key = await this.logos.save(id, upload);
    const before = await this.db.venuePortal.findUnique({ where: { venueId: id } });
    if (before === null) {
      const { look } = await this.resolve(id);
      await this.db.venuePortal.create({ data: { venueId: id, ...look, logoKey: key } });
    } else {
      await this.db.venuePortal.update({ where: { venueId: id }, data: { logoKey: key } });
      if (before.logoKey !== key) this.logos.discard(before.logoKey);
    }
    await this.recordVenue(staff, "brand.image.upload", venue);
    return this.venueEditor(venue);
  }

  async removeLogo(staff: Principal, id: string): Promise<PortalEditor> {
    const venue = await this.venueOf(staff, id);
    const row = await this.db.venuePortal.findUnique({ where: { venueId: id } });
    if (row?.logoKey) {
      await this.db.venuePortal.update({ where: { venueId: id }, data: { logoKey: null } });
      this.logos.discard(row.logoKey);
      await this.recordVenue(staff, "brand.image.remove", venue);
    }
    return this.venueEditor(venue);
  }

  /** A deleted venue's logo goes too; its portal row goes with the venue. */
  async forget(venueId: string): Promise<void> {
    const row = await this.db.venuePortal.findUnique({ where: { venueId } });
    this.logos.discard(row?.logoKey ?? null);
  }

  // ── The business's template ────────────────────────────────────────

  async ofBusiness(staff: Principal): Promise<PortalEditor> {
    return this.businessEditor(this.businessOf(staff));
  }

  async saveBusiness(staff: Principal, look: PortalLook): Promise<PortalEditor> {
    const businessId = this.businessOf(staff);
    await this.db.businessPortal.upsert({
      where: { businessId },
      create: { businessId, ...look },
      update: look,
    });
    await this.recordBusiness(staff, "portal.business.update", businessId);
    return this.businessEditor(businessId);
  }

  /** Back to what the platform's new businesses start with. */
  async restoreBusiness(staff: Principal): Promise<PortalEditor> {
    const businessId = this.businessOf(staff);
    const look = await platformLook(this.db);
    await this.db.businessPortal.upsert({
      where: { businessId },
      create: { businessId, ...look },
      update: look,
    });
    await this.recordBusiness(staff, "portal.business.reset", businessId);
    return this.businessEditor(businessId);
  }

  // ── Editors ────────────────────────────────────────────────────────

  private async venueEditor(venue: Venue): Promise<PortalEditor> {
    const [{ look, logoUrl: logo }, row, packages, business, themes] = await Promise.all([
      this.resolve(venue.id),
      this.db.venuePortal.findUnique({ where: { venueId: venue.id } }),
      onSalePackages(this.db, venue.id),
      this.db.business.findUniqueOrThrow({ where: { id: venue.businessId } }),
      this.portal.themes(),
    ]);
    return {
      look,
      themes,
      logo: { url: logo, own: row?.logoKey != null },
      preview: this.preview(venue.name, business.access, look, logo, packages ?? []),
      updatedAt: (row?.updatedAt ?? venue.updatedAt).toISOString(),
    };
  }

  private async businessEditor(businessId: string): Promise<PortalEditor> {
    const [row, business, packages, themes] = await Promise.all([
      this.db.businessPortal.findUnique({ where: { businessId } }),
      this.db.business.findUniqueOrThrow({ where: { id: businessId } }),
      this.db.package.findMany({
        where: { businessId, venueId: null, isActive: true },
        orderBy: [{ priceTsh: "asc" }, { createdAt: "asc" }],
      }),
      this.portal.themes(),
    ]);
    // A business made outside the services (a fixture) starts as a new one would.
    const look = row ? lookOf(row) : await platformLook(this.db);
    return {
      look,
      themes,
      logo: { url: logoUrl(business.logoKey), own: false },
      // A new venue of the business: its name until the venue has its own.
      preview: this.preview(
        business.name,
        business.access,
        look,
        logoUrl(business.logoKey),
        packages,
      ),
      updatedAt: (row?.updatedAt ?? business.updatedAt).toISOString(),
    };
  }

  private preview(
    venueName: string,
    access: ServiceAccess,
    look: PortalLook,
    logoUrl: string | null,
    packages: Package[],
  ): GuestContext {
    return guestContext({
      venueName,
      internet: true,
      mobileMoney: this.config.features.mobileMoney,
      selling: !sellingStopped(access),
      look,
      logoUrl,
      packages: packages.map(packageRecord),
    });
  }

  private async venueOf(staff: Principal, id: string): Promise<Venue> {
    const venue = await this.db.venue.findFirst({ where: { id, ...venueScope(staff) } });
    if (venue === null) throw venueNotFound();
    return venue;
  }

  /** `portal.business.update` is a business's own, so the principal is in one. */
  private businessOf(staff: Principal): string {
    if (staff.businessId === null) throw noTemplate();
    return staff.businessId;
  }

  private async recordVenue(staff: Principal, action: AuditAction, venue: Venue): Promise<void> {
    await this.audit.record(staff, {
      action,
      businessId: venue.businessId,
      venueId: venue.id,
      target: { type: "venue", id: venue.id },
    });
  }

  private async recordBusiness(
    staff: Principal,
    action: AuditAction,
    businessId: string,
  ): Promise<void> {
    await this.audit.record(staff, {
      action,
      businessId,
      venueId: null,
      target: { type: "business", id: businessId },
    });
  }
}
