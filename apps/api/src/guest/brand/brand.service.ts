import type { AuditAction, GuestContext, PortalEditor, PortalLook } from "@hashinet/types";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Principal } from "../../core/access/principal.js";
import { venueScope } from "../../core/access/venue-scope.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import type { AppConfig } from "../../core/config/config.js";
import { APP_CONFIG } from "../../core/config/config.module.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { packageRecord } from "../../core/records/records.js";
import type { Package, ServiceAccess, Venue } from "../../generated/prisma/client.js";
import { sellingStopped } from "../../platform/billing/access-rule.js";
import { onSalePackages } from "../../venues/packages/on-sale.js";
import { venueNotFound } from "../../venues/venues/venue-errors.js";
import { platformLook, portalOf, templateOf } from "../portal/copy-down.js";
import { PortalService } from "../portal/portal.service.js";
import { lookOf } from "../portal/portal-input.js";
import { guestContext } from "../sign-in/guest-context.js";
import { Logos, logoUrl } from "./logos.js";

const noTemplate = () =>
  new NotFoundException(apiError("NOT_FOUND", "This business has no portal to change."));

/**
 * Each business's and venue's captive portal (ADR-0009). A venue's portal is its own copy, made
 * from its business's template when the venue is created; a venue's owner and managers change it.
 * The template is what new venues start with, changed by whoever reaches the whole business. The
 * logo is the venue's own, else the business's.
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
      select: { businessId: true, business: { select: { logoKey: true } } },
    });
    const portal = await portalOf(this.db, venueId, venue.businessId);
    return { look: lookOf(portal), logoUrl: logoUrl(portal.logoKey ?? venue.business.logoKey) };
  }

  // ── A venue's own ──────────────────────────────────────────────────

  async ofVenue(staff: Principal, id: string): Promise<PortalEditor> {
    const venue = await this.venueOf(staff, id);
    return this.venueEditor(venue);
  }

  async saveVenue(staff: Principal, id: string, look: PortalLook): Promise<PortalEditor> {
    const venue = await this.venueOf(staff, id);
    await portalOf(this.db, id, venue.businessId);
    await this.db.venuePortal.update({ where: { venueId: id }, data: look });
    await this.recordVenue(staff, "brand.update", venue);
    return this.venueEditor(venue);
  }

  /** Back to what the business's new venues start with; the venue's logo stays. */
  async restoreVenue(staff: Principal, id: string): Promise<PortalEditor> {
    const venue = await this.venueOf(staff, id);
    const look = lookOf(await templateOf(this.db, venue.businessId));
    await portalOf(this.db, id, venue.businessId);
    await this.db.venuePortal.update({ where: { venueId: id }, data: look });
    await this.recordVenue(staff, "brand.reset", venue);
    return this.venueEditor(venue);
  }

  async putLogo(staff: Principal, id: string, upload: Uint8Array): Promise<PortalEditor> {
    const venue = await this.venueOf(staff, id);
    const key = await this.logos.save(id, upload);
    const before = await portalOf(this.db, id, venue.businessId);
    await this.db.venuePortal.update({ where: { venueId: id }, data: { logoKey: key } });
    if (before.logoKey !== key) this.logos.discard(before.logoKey);
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
    await templateOf(this.db, businessId);
    await this.db.businessPortal.update({ where: { businessId }, data: look });
    await this.recordBusiness(staff, "portal.business.update", businessId);
    return this.businessEditor(businessId);
  }

  /** Back to what the platform's new businesses start with. */
  async restoreBusiness(staff: Principal): Promise<PortalEditor> {
    const businessId = this.businessOf(staff);
    await templateOf(this.db, businessId);
    await this.db.businessPortal.update({
      where: { businessId },
      data: await platformLook(this.db),
    });
    await this.recordBusiness(staff, "portal.business.reset", businessId);
    return this.businessEditor(businessId);
  }

  // ── Editors ────────────────────────────────────────────────────────

  private async venueEditor(venue: Venue): Promise<PortalEditor> {
    const [portal, business, packages, themes] = await Promise.all([
      portalOf(this.db, venue.id, venue.businessId),
      this.db.business.findUniqueOrThrow({
        where: { id: venue.businessId },
        select: { access: true, logoKey: true },
      }),
      onSalePackages(this.db, venue.id),
      this.portal.themes(),
    ]);
    const look = lookOf(portal);
    const logo = logoUrl(portal.logoKey ?? business.logoKey);
    return {
      look,
      themes,
      logo: { url: logo, own: portal.logoKey !== null },
      preview: this.preview(venue.name, business.access, look, logo, packages ?? []),
      updatedAt: portal.updatedAt.toISOString(),
    };
  }

  private async businessEditor(businessId: string): Promise<PortalEditor> {
    const [template, business, packages, themes] = await Promise.all([
      templateOf(this.db, businessId),
      this.db.business.findUniqueOrThrow({ where: { id: businessId } }),
      this.db.package.findMany({
        where: { businessId, venueId: null, isActive: true },
        orderBy: [{ priceTsh: "asc" }, { createdAt: "asc" }],
      }),
      this.portal.themes(),
    ]);
    const look = lookOf(template);
    const logo = logoUrl(business.logoKey);
    return {
      look,
      themes,
      logo: { url: logo, own: false },
      // A new venue of the business: its name until the venue has its own.
      preview: this.preview(business.name, business.access, look, logo, packages),
      updatedAt: template.updatedAt.toISOString(),
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
