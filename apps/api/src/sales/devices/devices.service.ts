import type { AuditAction, DeviceList, DeviceRecord } from "@hashinet/types";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../../core/access/principal.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { captureFailure } from "../../core/observability/telemetry.js";
import { bytes } from "../../core/records/records.js";
import type { Device } from "../../generated/prisma/client.js";
import type { DeviceWhereInput } from "../../generated/prisma/models.js";
import { RouterSync } from "../../network/monitor/router-sync.js";
import { sessionScope } from "../sessions/session-scope.js";
import { SessionsService } from "../sessions/sessions.service.js";

export const deviceQuery = z.object({
  status: z.enum(["online", "offline", "blocked"]).nullable().default(null),
  search: z.string().trim().max(80).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.uuid().nullable().default(null),
});

export const deviceStatusInput = z.object({ status: z.enum(["active", "blocked"]) });

const deviceNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That device does not exist."));

@Injectable()
export class DevicesService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly sessions: SessionsService,
    private readonly sync: RouterSync,
  ) {}

  async list(staff: Principal, query: z.infer<typeof deviceQuery>): Promise<DeviceList> {
    const search = query.search === null || query.search === "" ? null : query.search;
    const scope = this.scope(staff);
    const blockedHere = blockedBy(staff);
    const online: DeviceWhereInput = {
      NOT: blockedHere,
      sessions: { some: { ...sessionScope(staff), status: "connected" } },
    };
    const byStatus: Record<"online" | "offline" | "blocked", DeviceWhereInput> = {
      online,
      offline: { AND: [{ NOT: blockedHere }, { NOT: online }] },
      blocked: blockedHere,
    };
    const filters: DeviceWhereInput[] = [scope];
    if (search !== null) {
      filters.push({
        OR: [
          { macAddress: { contains: search, mode: "insensitive" } },
          { deviceName: { contains: search, mode: "insensitive" } },
        ],
      });
    }
    if (query.status !== null) filters.push(byStatus[query.status]);
    const where: DeviceWhereInput = { AND: filters };

    const [rows, total, onlineCount, blocked] = await Promise.all([
      this.db.device.findMany({
        where: query.before === null ? where : { AND: [where, { id: { lt: query.before } }] },
        orderBy: { id: "desc" },
        take: query.limit + 1,
      }),
      this.db.device.count({ where: scope }),
      this.db.device.count({ where: { AND: [scope, online] } }),
      this.db.device.count({ where: { AND: [scope, byStatus.blocked] } }),
    ]);
    const page = rows.slice(0, query.limit);
    return {
      devices: await this.records(staff, page),
      nextBefore: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      stats: { total, online: onlineCount, offline: total - onlineCount - blocked, blocked },
    };
  }

  async get(staff: Principal, id: string): Promise<DeviceRecord> {
    const row = await this.db.device.findFirst({ where: { id, ...this.scope(staff) } });
    if (!row) throw deviceNotFound();
    const [record] = await this.records(staff, [row]);
    if (!record) throw deviceNotFound();
    return record;
  }

  /**
   * Blocks or unblocks a device for the reader's business: at its routers, which refuse it whatever
   * it tries, and at its portal. Blocking also ends its sessions at the business's venues at once.
   * Another business's WiFi is not this one's to close.
   */
  async setStatus(
    staff: Principal,
    id: string,
    status: "active" | "blocked",
  ): Promise<DeviceRecord> {
    const device = await this.get(staff, id);
    const { businessId } = staff;
    // `device.block` is a business role's, so the reader always has a business.
    if (businessId === null) {
      throw new ForbiddenException(apiError("FORBIDDEN", "Only a business blocks a device."));
    }
    if (status === "blocked") {
      await this.db.deviceBlock.upsert({
        where: { businessId_deviceId: { businessId, deviceId: id } },
        create: { businessId, deviceId: id, blockedById: staff.membershipId },
        update: {},
      });
    } else {
      await this.db.deviceBlock.deleteMany({ where: { businessId, deviceId: id } });
    }
    void this.sync
      .setDeviceBlocked(businessId, device.macAddress, status === "blocked")
      .catch(captureFailure);
    // The block is on its vouchers too (ADR-0015, 9): a MAC address can change, so a voucher it
    // used here, still live, is refused on every device until it is unblocked, and stays refused
    // while another device that used it is still blocked here.
    const vouchers = await this.db.voucher.findMany({
      where: {
        devices: { some: { deviceId: id } },
        venue: { businessId },
        ...(status === "blocked"
          ? { status: { in: ["pending_activation", "active"] } }
          : { NOT: { devices: { some: { device: { blocks: { some: { businessId } } } } } } }),
      },
      select: { id: true },
    });
    const voucherIds = vouchers.map((v) => v.id);
    await this.db.voucher.updateMany({
      where: { id: { in: voucherIds } },
      data: { blockedAt: status === "blocked" ? new Date() : null },
    });
    if (status === "blocked") {
      const connected = await this.db.wifiSession.findMany({
        where: {
          status: "connected",
          venue: { businessId },
          OR: [{ deviceId: id }, { voucherId: { in: voucherIds } }],
        },
        select: { id: true },
      });
      await this.sessions.end(
        connected.map((s) => s.id),
        "device_blocked",
      );
    }
    await this.record(staff, status === "blocked" ? "device.block" : "device.unblock", id);
    return this.get(staff, id);
  }

  /**
   * Forgets a device for the reader's business (a MAC address is personal data): its sessions,
   * payments and vouchers there stay, unlinked, and its block there goes. Another business that
   * saw it keeps it, blocked or not; the device itself goes once no business refers to it.
   */
  async remove(staff: Principal, id: string): Promise<void> {
    const device = await this.get(staff, id);
    const { businessId } = staff;
    if (businessId === null) {
      throw new ForbiddenException(apiError("FORBIDDEN", "Only a business removes a device."));
    }
    const here = { venue: { businessId } };
    const unblocked = await this.db.$transaction(async (tx) => {
      await tx.wifiSession.updateMany({
        where: { deviceId: id, ...here },
        data: { deviceId: null },
      });
      await tx.payment.updateMany({ where: { deviceId: id, ...here }, data: { deviceId: null } });
      await tx.voucher.updateMany({
        where: { redeemedByDeviceId: id, ...here },
        data: { redeemedByDeviceId: null },
      });
      await tx.voucherDevice.deleteMany({ where: { deviceId: id, voucher: here } });
      const block = await tx.deviceBlock.deleteMany({ where: { deviceId: id, businessId } });
      const elsewhere = await tx.device.count({
        where: {
          id,
          OR: [
            { sessions: { some: {} } },
            { payments: { some: {} } },
            { redeemedVouchers: { some: {} } },
            { vouchers: { some: {} } },
            { blocks: { some: {} } },
          ],
        },
      });
      if (elsewhere === 0) await tx.device.delete({ where: { id } });
      return block.count > 0;
    });
    // Its block goes from the business's routers too, or a forgotten device stays refused there.
    if (unblocked) {
      void this.sync.setDeviceBlocked(businessId, device.macAddress, false).catch(captureFailure);
    }
    await this.record(staff, "device.delete", id);
  }

  private scope(staff: Principal): DeviceWhereInput {
    return staff.scope === "platform" ? {} : { sessions: { some: sessionScope(staff) } };
  }

  /** Usage and online state, counted over the sessions the staff member may see. */
  private async records(staff: Principal, rows: Device[]): Promise<DeviceRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [usage, connected, blocks] = await Promise.all([
      this.db.wifiSession.groupBy({
        by: ["deviceId"],
        where: { deviceId: { in: ids }, ...sessionScope(staff) },
        _sum: { uploadBytes: true, downloadBytes: true },
      }),
      this.db.wifiSession.findMany({
        where: { deviceId: { in: ids }, status: "connected", ...sessionScope(staff) },
        select: { deviceId: true },
        distinct: ["deviceId"],
      }),
      this.db.device.findMany({
        where: { id: { in: ids }, ...blockedBy(staff) },
        select: { id: true },
      }),
    ]);
    const blockedIds = new Set(blocks.map((b) => b.id));
    const usageOf = new Map(usage.map((u) => [u.deviceId, u._sum]));
    const onlineIds = new Set(connected.map((c) => c.deviceId));
    return rows.map((row) => ({
      id: row.id,
      macAddress: row.macAddress,
      lastIpAddress: row.lastIpAddress,
      deviceName: row.deviceName,
      deviceType: row.deviceType,
      status: blockedIds.has(row.id) ? "blocked" : "active",
      isOnline: !blockedIds.has(row.id) && onlineIds.has(row.id),
      downloadBytes: bytes(usageOf.get(row.id)?.downloadBytes ?? 0n),
      uploadBytes: bytes(usageOf.get(row.id)?.uploadBytes ?? 0n),
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    }));
  }

  /** A device is seen across venues, so its event belongs to the business that acted on it. */
  private async record(staff: Principal, action: AuditAction, id: string): Promise<void> {
    await this.audit.record(staff, {
      action,
      businessId: staff.businessId,
      venueId: null,
      target: { type: "device", id },
    });
  }
}

/** Devices the reader's business has blocked; for HashiNet's team, blocked by any business. */
function blockedBy(staff: Principal): DeviceWhereInput {
  return {
    blocks: { some: staff.businessId === null ? {} : { businessId: staff.businessId } },
  };
}
