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
import { businessDayStart } from "../analytics/business-day.js";
import { PrismaService } from "../database/prisma.service.js";
import type { AuditLogWhereInput } from "../generated/prisma/models.js";
import { parseInput } from "../http/validation.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const auditQuery = z.object({
  action: z.enum(AUDIT_ACTIONS).nullable().default(null),
  venueId: z.uuid().nullable().default(null),
  /** Business days, both included. */
  from: z.iso.date().nullable().default(null),
  to: z.iso.date().nullable().default(null),
  /** Who acted, by name. */
  search: z.string().trim().max(80).nullable().default(null),
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
    // The calendar day after `day`, worked on the date alone.
    const next = (day: string) =>
      new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const where: AuditLogWhereInput = {
      AND: [
        scopeOf(principal),
        q.venueId === null ? {} : { venueId: q.venueId },
        q.action === null ? {} : { action: q.action },
        q.include === "reads" ? {} : { category: { not: "read" } },
        q.before === null ? {} : { id: { lt: q.before } },
        q.from === null ? {} : { createdAt: { gte: businessDayStart(q.from) } },
        q.to === null ? {} : { createdAt: { lt: businessDayStart(next(q.to)) } },
        q.search === null || q.search === ""
          ? {}
          : {
              actorMembership: {
                user: { name: { contains: q.search, mode: "insensitive" } },
              },
            },
      ],
    };
    const rows = await this.db.auditLog.findMany({
      where,
      include: {
        actorMembership: { include: { user: { select: { name: true } } } },
        business: { select: { id: true, name: true } },
      },
      orderBy: { id: "desc" },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const [venues, labels] = await Promise.all([
      this.db.venue.findMany({
        where: { id: { in: page.flatMap((r) => (r.venueId === null ? [] : [r.venueId])) } },
        select: { id: true, name: true },
      }),
      this.labels(page),
    ]);
    const venueOf = new Map(venues.map((v) => [v.id, v]));
    return {
      entries: page.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        actor: row.actorMembership
          ? { name: row.actorMembership.user.name, role: row.actorMembership.role }
          : null,
        action: row.action as AuditAction,
        category: row.category,
        target: {
          type: row.targetType,
          id: row.targetId,
          label: labels.get(`${row.targetType}:${row.targetId}`) ?? null,
        },
        business: row.business,
        venue: row.venueId === null ? null : (venueOf.get(row.venueId) ?? null),
        outcome: row.outcome,
        change: changeOf(row.change),
      })),
      nextBefore: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Names for targets that have one, read now, so a renamed venue reads as it is called today.
   * Devices, vouchers, sessions and payments stay unnamed: their names are MAC addresses and codes.
   */
  private async labels(
    rows: { targetType: string; targetId: string | null }[],
  ): Promise<Map<string, string>> {
    // A target id is free text: only a UUID can name a row.
    const ids = (type: string) =>
      rows.flatMap((r) =>
        r.targetType === type && r.targetId !== null && UUID.test(r.targetId) ? [r.targetId] : [],
      );
    const named = (rows: { id: string; name: string }[]) =>
      rows.map((r) => [r.id, r.name] as const);
    const [venues, routers, packages, businesses, members] = await Promise.all([
      this.db.venue.findMany({
        where: { id: { in: ids("venue") } },
        select: { id: true, name: true },
      }),
      this.db.router.findMany({
        where: { id: { in: ids("router") } },
        select: { id: true, name: true },
      }),
      this.db.package.findMany({
        where: { id: { in: ids("package") } },
        select: { id: true, name: true },
      }),
      this.db.business.findMany({
        where: { id: { in: ids("business") } },
        select: { id: true, name: true },
      }),
      this.db.membership.findMany({
        where: { id: { in: ids("membership") } },
        select: { id: true, user: { select: { name: true } } },
      }),
    ]);
    return new Map([
      ...named(venues).map(([id, name]) => [`venue:${id}`, name] as const),
      ...named(routers).map(([id, name]) => [`router:${id}`, name] as const),
      ...named(packages).map(([id, name]) => [`package:${id}`, name] as const),
      ...named(businesses).map(([id, name]) => [`business:${id}`, name] as const),
      ...members.map((m) => [`membership:${m.id}`, m.user.name] as const),
    ]);
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
