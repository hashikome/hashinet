import { type BusinessProfile, REGIONS } from "@hashinet/types";
import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Put,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Business } from "../generated/prisma/client.js";
import { apiError } from "../http/error-envelope.js";
import { readUpload } from "../http/upload.js";
import { oneLine, parseInput } from "../http/validation.js";
import { Logos, logoUrl } from "./logos.js";

export const profileInput = z.object({
  name: oneLine(160).min(1, "is required"),
  region: z.enum(REGIONS),
  area: oneLine(160).min(1, "is required"),
});

const profileOf = (b: Business): BusinessProfile => ({
  name: b.name,
  region: b.region as BusinessProfile["region"],
  area: b.area,
  logoUrl: logoUrl(b.logoKey),
});

/**
 * A business's profile (ADR-0009, 1): its name and logo head the admin for its people and its
 * logo shows on the portal of any venue without its own; its address goes on its invoices.
 */
@Injectable()
export class BusinessProfiles {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly logos: Logos,
  ) {}

  async get(staff: Principal): Promise<BusinessProfile> {
    return profileOf(await this.business(staff));
  }

  async save(staff: Principal, input: z.infer<typeof profileInput>): Promise<BusinessProfile> {
    const before = await this.business(staff);
    const after = await this.db.business.update({ where: { id: before.id }, data: input });
    await this.audit.record(staff, {
      action: "business.profile.update",
      businessId: before.id,
      venueId: null,
      target: { type: "business", id: before.id },
      change: {
        before: { name: before.name, region: before.region, area: before.area },
        after: input,
      },
    });
    return profileOf(after);
  }

  async putLogo(staff: Principal, upload: Uint8Array): Promise<BusinessProfile> {
    const before = await this.business(staff);
    const key = await this.logos.save(before.id, upload);
    const after = await this.db.business.update({
      where: { id: before.id },
      data: { logoKey: key },
    });
    if (before.logoKey !== key) this.logos.discard(before.logoKey);
    await this.record(staff, "business.logo.upload", before.id);
    return profileOf(after);
  }

  async removeLogo(staff: Principal): Promise<BusinessProfile> {
    const before = await this.business(staff);
    if (before.logoKey === null) return profileOf(before);
    const after = await this.db.business.update({
      where: { id: before.id },
      data: { logoKey: null },
    });
    this.logos.discard(before.logoKey);
    await this.record(staff, "business.logo.remove", before.id);
    return profileOf(after);
  }

  /** The profile actions are a business's own, so the principal is in one. */
  private async business(staff: Principal): Promise<Business> {
    const row =
      staff.businessId === null
        ? null
        : await this.db.business.findUnique({ where: { id: staff.businessId } });
    if (row === null)
      throw new NotFoundException(apiError("NOT_FOUND", "There is no business here."));
    return row;
  }

  private async record(
    staff: Principal,
    action: "business.logo.upload" | "business.logo.remove",
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

@Controller("api/business")
export class BusinessProfileController {
  constructor(private readonly profiles: BusinessProfiles) {}

  @Get()
  @Can("business.profile.read")
  get(@CurrentPrincipal() staff: Principal): Promise<BusinessProfile> {
    return this.profiles.get(staff);
  }

  @Put()
  @Can("business.profile.update")
  save(@CurrentPrincipal() staff: Principal, @Body() body: unknown): Promise<BusinessProfile> {
    return this.profiles.save(staff, parseInput(profileInput, body));
  }

  @Put("logo")
  @Can("business.profile.update")
  async putLogo(
    @CurrentPrincipal() staff: Principal,
    @Req() request: Request,
  ): Promise<BusinessProfile> {
    return this.profiles.putLogo(staff, await readUpload(request));
  }

  @Delete("logo")
  @Can("business.profile.update")
  removeLogo(@CurrentPrincipal() staff: Principal): Promise<BusinessProfile> {
    return this.profiles.removeLogo(staff);
  }
}
