import type { VoucherList, VoucherListItem } from "@hashinet/types";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { z } from "zod";
import type { Principal } from "../access/principal.js";
import { venueScope } from "../access/venue-scope.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import type { VoucherWhereInput } from "../generated/prisma/models.js";
import { apiError } from "../http/error-envelope.js";
import { voucherRecord } from "../serializers/records.js";
import { SessionsService } from "../sessions/sessions.service.js";
import type { listQuery, refundInput } from "./voucher-input.js";

const voucherNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That voucher does not exist."));

/** Vouchers in the staff member's venues; admins also see ones whose venue is gone. */
const LIST_INCLUDE = {
  package: { select: { name: true } },
  venue: { select: { name: true } },
} as const;

function listItem(
  row: Parameters<typeof voucherRecord>[0] & {
    package: { name: string } | null;
    venue: { name: string } | null;
  },
): VoucherListItem {
  return {
    ...voucherRecord(row),
    packageName: row.package?.name ?? null,
    venueName: row.venue?.name ?? null,
  };
}

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
    private readonly sessions: SessionsService,
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
      include: LIST_INCLUDE,
      orderBy: { id: "desc" },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    await this.recordRead(staff, page.length, query.venueId);
    return {
      vouchers: page.map(listItem),
      nextBefore: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Gives a voucher's price back while it is not used yet (ADR-0017, 7): the full amount of its
   * sale, recorded with how it went back, and the voucher stops working, at the router too. A
   * voucher is refunded once: the conditional update makes two refunds at once one.
   */
  async refund(
    staff: Principal,
    id: string,
    input: z.infer<typeof refundInput>,
  ): Promise<VoucherListItem> {
    const voucher = await this.db.voucher.findFirst({
      where: { id, ...inScope(staff) },
      include: { payments: { where: { status: "paid" }, orderBy: { paidAt: "asc" }, take: 1 } },
    });
    if (voucher === null) throw voucherNotFound();
    const [sale] = voucher.payments;
    if (sale === undefined) {
      throw new ConflictException(apiError("CONFLICT", "This voucher has no sale to give back."));
    }
    await this.db.$transaction(async (tx) => {
      const claimed = await tx.voucher.updateMany({
        where: { id, status: "unused" },
        data: { status: "refunded", refundedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          apiError("CONFLICT", "Only a voucher that is not used yet can be refunded."),
        );
      }
      const refund = await tx.refund.create({
        data: {
          voucherId: id,
          paymentId: sale.id,
          venueId: voucher.venueId,
          packageId: voucher.packageId,
          amountTsh: sale.amountTsh,
          method: input.method,
          phone: input.method === "cash" ? null : input.phone,
          reference: input.method === "cash" ? null : input.reference,
          reason: input.reason || null,
          refundedById: staff.membershipId,
        },
      });
      await this.audit.record(
        staff,
        {
          ...(await this.audit.atVenue(voucher.venueId)),
          action: "voucher.refund",
          target: { type: "voucher", id },
          change: {
            before: { status: "unused" },
            after: { status: "refunded", method: input.method, refund: refund.id },
          },
        },
        tx,
      );
    });
    return listItem(
      await this.db.voucher.findUniqueOrThrow({ where: { id }, include: LIST_INCLUDE }),
    );
  }

  /**
   * Frees a voucher in use for the guest who shows it at the counter, when their phone changed or
   * its PIN was lost or locked (ADR-0015, 6): its devices, their sessions and its switch PIN are
   * cleared, so the next device signs in with the code alone and gets a new PIN; its time keeps
   * running.
   */
  async release(staff: Principal, id: string): Promise<VoucherListItem> {
    const voucher = await this.db.voucher.findFirst({ where: { id, ...inScope(staff) } });
    if (voucher === null) throw voucherNotFound();
    if (voucher.status !== "active" && voucher.status !== "pending_activation") {
      throw new ConflictException(apiError("CONFLICT", "Only a voucher in use can be released."));
    }
    const connected = await this.db.wifiSession.findMany({
      where: { voucherId: id, status: "connected" },
      select: { id: true },
    });
    const ended = await this.sessions.end(
      connected.map((s) => s.id),
      "voucher_released",
    );
    const freed = await this.db.voucherDevice.deleteMany({ where: { voucherId: id } });
    await this.db.voucher.update({
      where: { id },
      data: { pinHmac: null, pinWrongTries: 0, pinWaitUntil: null, pinLockedAt: null },
    });
    await this.audit.record(staff, {
      ...(await this.audit.atVenue(voucher.venueId)),
      action: "voucher.release",
      target: { type: "voucher", id },
      change: { before: { devices: freed.count }, after: { devices: 0, sessionsEnded: ended } },
    });
    return listItem(
      await this.db.voucher.findUniqueOrThrow({ where: { id }, include: LIST_INCLUDE }),
    );
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
