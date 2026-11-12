import type { PortalSettingsRecord } from "@hashinet/types";
import { Injectable } from "@nestjs/common";
import type { Principal } from "../access/principal.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import { portalSettingsRecord } from "../serializers/records.js";
import { DEFAULT_PORTAL_SETTINGS, type PortalInput } from "./portal-input.js";

/**
 * The HashiNet default: what a guest sees at a venue with no branding of its own (`BrandService`).
 * Its logo is HashiNet's, and ships with the web.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  async get(): Promise<PortalSettingsRecord> {
    // Not findUnique: Prisma batches concurrent ones into an `in`, which a boolean cannot take.
    const row = await this.db.portalSetting.findFirst();
    return row === null ? DEFAULT_PORTAL_SETTINGS : portalSettingsRecord(row);
  }

  async save(staff: Principal, input: PortalInput): Promise<PortalSettingsRecord> {
    const row = await this.db.portalSetting.upsert({
      where: { singleton: true },
      create: input,
      update: input,
    });
    await this.audit.record(staff, {
      action: "portal.defaults.update",
      target: { type: "portal", id: row.id },
      change: { before: {}, after: {} },
    });
    return portalSettingsRecord(row);
  }
}
