import type { VoucherList } from "@hashinet/types";
import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import type { Principal } from "../access/principal.js";
import { venueScope } from "../access/venue-scope.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import type { VoucherWhereInput } from "../generated/prisma/models.js";
import { voucherRecord } from "../serializers/records.js";
import type { listQuery } from "./voucher-input.js";

/** Vouchers in the staff member's venues; admins also see ones whose venue is gone. */
function inScope(staff: Principal) {
  return staff.scope === "platform" ? {} : { venue: { is: venueScope(staff) } };
}

/**
 * Vouchers as their business sees them. A voucher exists only by its sale (ADR-0017): it is made
 * by `PaymentsService` when someone sells it or a guest buys it, never here.
 */
@Injectable()
export class VouchersService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  async list(staff: Principal, query: z.infer<typeof listQuery>): Promise<VoucherList> {
    const where: VoucherWhereInput = {
      ...inScope(staff),
      ...(query.venueId === null ? {} : { venueId: query.venueId }),
      ...(query.status === null ? {} : { status: query.status }),
      ...(query.code ? { code: { contains: query.code } } : {}),
      ...(query.before === null ? {} : { id: { lt: query.before } }),
    };
    const rows = await this.db.voucher.findMany({
      where,
      include: { package: { select: { name: true } }, venue: { select: { name: true } } },
      orderBy: { id: "desc" },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    await this.recordRead(staff, page.length, query.venueId);
    return {
      vouchers: page.map((row) => ({
        ...voucherRecord(row),
        packageName: row.package?.name ?? null,
        venueName: row.venue?.name ?? null,
      })),
      nextBefore: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Showing codes is a read that reveals something (ADR-0012): recorded, with how many. */
  private async recordRead(staff: Principal, count: number, venueId: string | null) {
    if (count === 0) return;
    await this.audit.record(staff, {
      action: "voucher.read",
      category: "read",
      ...(venueId === null
        ? { businessId: staff.businessId, venueId: null }
        : await this.audit.atVenue(venueId)),
      target: { type: "voucher", id: null },
      change: { before: {}, after: { count } },
    });
  }
}
