import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditChange,
  type AuditEntry,
  type AuditList,
} from "@hashinet/types";
import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { PrismaService } from "../database/prisma.service.js";
import type { AuditLogWhereInput } from "../generated/prisma/models.js";
import { parseInput } from "../http/validation.js";

const auditQuery = z.object({
  action: z.enum(AUDIT_ACTIONS).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.uuid().nullable().default(null),
  include: z.enum(["reads"]).nullable().default(null),
});

/**
 * The audit log, scoped like everything else (ADR-0012): platform roles see every row; a
 * business's owner and business managers their business; a venue manager their venues. Reads
 * are left out unless asked for.
 */
@Controller("api/audit")
export class AuditController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  @Can("audit.read")
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: unknown,
  ): Promise<AuditList> {
    const q = parseInput(auditQuery, query);
    const where: AuditLogWhereInput = {
      ...scopeOf(principal),
      ...(q.action === null ? {} : { action: q.action }),
      ...(q.include === "reads" ? {} : { category: { not: "read" } }),
      ...(q.before === null ? {} : { id: { lt: q.before } }),
    };
    const rows = await this.db.auditLog.findMany({
      where,
      include: { actorMembership: { include: { user: { select: { name: true } } } } },
      orderBy: { id: "desc" },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    return {
      entries: page.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        actor: row.actorMembership
          ? { name: row.actorMembership.user.name, role: row.actorMembership.role }
          : null,
        action: row.action as AuditAction,
        category: row.category,
        target: { type: row.targetType, id: row.targetId, label: null },
        outcome: row.outcome,
        change: changeOf(row.change),
      })),
      nextBefore: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}

function scopeOf(principal: Principal): AuditLogWhereInput {
  if (principal.scope === "platform") return {};
  if (principal.venueIds === null) return { businessId: principal.businessId };
  return { businessId: principal.businessId, venueId: { in: principal.venueIds } };
}

function changeOf(value: unknown): AuditEntry["change"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { before, after } = value as { before?: unknown; after?: unknown };
  return { before: valuesOf(before), after: valuesOf(after) };
}

function valuesOf(value: unknown): AuditChange {
  const out: AuditChange = {};
  if (typeof value !== "object" || value === null) return out;
  for (const [key, v] of Object.entries(value)) {
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
      out[key] = v as string | number | boolean | null;
    }
  }
  return out;
}
