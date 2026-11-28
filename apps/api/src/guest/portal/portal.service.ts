import type { AuditAction, PlatformPortal, PortalContent, PortalTheme } from "@hashinet/types";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { z } from "zod";
import type { Principal } from "../../core/access/principal.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { Prisma, type PortalTheme as ThemeRow } from "../../generated/prisma/client.js";
import { contentOf, HASHINET_PORTAL, type themeInput } from "./portal-input.js";

const themeNotFound = () => new NotFoundException(apiError("NOT_FOUND", "There is no such theme."));

const themeRecord = (row: ThemeRow): PortalTheme => ({
  id: row.id,
  name: row.name,
  pageColor: row.pageColor,
  buttonColor: row.buttonColor,
  isDefault: row.isDefault,
});

/**
 * What a new business's portal starts with (ADR-0009): the platform's content and its themes, one
 * of them the default. Platform staff change them; a change reaches only businesses created after.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  async get(): Promise<PlatformPortal> {
    // Not findUnique: Prisma batches concurrent ones into an `in`, which a boolean cannot take.
    const [row, themes] = await Promise.all([this.db.portalSetting.findFirst(), this.themes()]);
    return {
      content: row ? contentOf(row) : HASHINET_PORTAL,
      themes,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  }

  /** Every theme, the default first. */
  async themes(): Promise<PortalTheme[]> {
    const rows = await this.db.portalTheme.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return rows.map(themeRecord);
  }

  async save(staff: Principal, input: PortalContent): Promise<PlatformPortal> {
    await this.db.portalSetting.upsert({
      where: { singleton: true },
      create: input,
      update: input,
    });
    await this.record(staff, "portal.defaults.update", "portal", null);
    return this.get();
  }

  /** Back to HashiNet's own content; the themes stay. */
  async restore(staff: Principal): Promise<PlatformPortal> {
    await this.db.portalSetting.deleteMany();
    await this.record(staff, "portal.defaults.reset", "portal", null);
    return this.get();
  }

  async addTheme(staff: Principal, input: z.infer<typeof themeInput>): Promise<PlatformPortal> {
    try {
      const row = await this.db.portalTheme.create({ data: input });
      await this.record(staff, "portal.theme.add", "portal_theme", row.id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(
          apiError("CONFLICT", `There is a theme called ${input.name} already.`, {
            name: "is taken",
          }),
        );
      }
      throw err;
    }
    return this.get();
  }

  /** The one new businesses start with. */
  async makeDefault(staff: Principal, id: string): Promise<PlatformPortal> {
    await this.db.$transaction(async (tx) => {
      const theme = await tx.portalTheme.findUnique({ where: { id } });
      if (!theme) throw themeNotFound();
      await tx.portalTheme.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      await tx.portalTheme.update({ where: { id }, data: { isDefault: true } });
    });
    await this.record(staff, "portal.theme.default", "portal_theme", id);
    return this.get();
  }

  /** A portal keeps its colours, so removing a theme changes nobody's; the default stays. */
  async removeTheme(staff: Principal, id: string): Promise<PlatformPortal> {
    const theme = await this.db.portalTheme.findUnique({ where: { id } });
    if (!theme) throw themeNotFound();
    if (theme.isDefault) {
      throw new ConflictException(
        apiError("CONFLICT", "Make another theme the default before removing this one."),
      );
    }
    await this.db.portalTheme.delete({ where: { id } });
    await this.record(staff, "portal.theme.remove", "portal_theme", id);
    return this.get();
  }

  private async record(
    staff: Principal,
    action: AuditAction,
    type: string,
    id: string | null,
  ): Promise<void> {
    await this.audit.record(staff, {
      action,
      // The platform's: no business or venue's own.
      businessId: null,
      venueId: null,
      target: { type, id },
    });
  }
}
