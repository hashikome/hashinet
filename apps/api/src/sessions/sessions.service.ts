import type { SessionList, SessionRecord } from "@hashinet/types";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../access/principal.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import type { WifiSessionWhereInput } from "../generated/prisma/models.js";
import { apiError } from "../http/error-envelope.js";
import { captureFailure } from "../observability/telemetry.js";
import { bytes, sessionRecord } from "../serializers/records.js";
import { RouterSync } from "../services/router-sync.js";
import { sessionScope } from "./session-scope.js";

export const sessionQuery = z.object({
  status: z.enum(["connected", "disconnected", "expired", "terminated"]).nullable().default(null),
  venueId: z.uuid().nullable().default(null),
  deviceId: z.uuid().nullable().default(null),
  search: z.string().trim().max(80).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.uuid().nullable().default(null),
  /** Newest first, a page at a time; or those whose voucher ends soonest first, one page. */
  order: z.enum(["newest", "ending"]).default("newest"),
});

export const sessionInclude = {
  voucher: { select: { code: true, expiresAt: true } },
  package: { select: { name: true } },
  venue: { select: { name: true } },
  router: { select: { name: true } },
} as const;

@Injectable()
export class SessionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly sync: RouterSync,
  ) {}

  async list(staff: Principal, query: z.infer<typeof sessionQuery>): Promise<SessionList> {
    const search = query.search === null || query.search === "" ? null : query.search;
    // A code is read off a card in groups ("4827 1693"): its digits find it.
    const digits = search?.replace(/\s/g, "") ?? "";
    const where: WifiSessionWhereInput = {
      ...sessionScope(staff),
      ...(query.status === null ? {} : { status: query.status }),
      ...(query.venueId === null ? {} : { venueId: query.venueId }),
      ...(query.deviceId === null ? {} : { deviceId: query.deviceId }),
      ...(search === null
        ? {}
        : {
            OR: [
              { macAddress: { contains: search, mode: "insensitive" } },
              { ipAddress: { contains: search } },
              { deviceName: { contains: search, mode: "insensitive" } },
              ...(/^\d+$/.test(digits) ? [{ voucher: { code: { contains: digits } } }] : []),
            ],
          }),
    };
    const [rows, total, connected, sums] = await Promise.all([
      this.db.wifiSession.findMany({
        where: query.before === null ? where : { AND: [where, { id: { lt: query.before } }] },
        include: sessionInclude,
        orderBy:
          query.order === "ending"
            ? [{ voucher: { expiresAt: { sort: "asc", nulls: "last" } } }, { id: "desc" }]
            : { id: "desc" },
        take: query.limit + 1,
      }),
      this.db.wifiSession.count({ where }),
      this.db.wifiSession.count({ where: { AND: [where, { status: "connected" }] } }),
      this.db.wifiSession.aggregate({ where, _sum: { uploadBytes: true, downloadBytes: true } }),
    ]);
    const page = rows.slice(0, query.limit);
    return {
      sessions: page.map(sessionRecord),
      nextBefore:
        query.order === "newest" && rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      stats: {
        total,
        connected,
        uploadBytes: bytes(sums._sum.uploadBytes ?? 0n),
        downloadBytes: bytes(sums._sum.downloadBytes ?? 0n),
      },
    };
  }

  async get(staff: Principal, id: string): Promise<SessionRecord> {
    const row = await this.db.wifiSession.findFirst({
      where: { id, ...sessionScope(staff) },
      include: sessionInclude,
    });
    if (!row) throw new NotFoundException(apiError("NOT_FOUND", "That session does not exist."));
    return sessionRecord(row);
  }

  /**
   * Ends a session, drops it from the venue's routers and takes its device off the voucher, or the
   * router would sign it back in by its address through RADIUS. The voucher stays valid: the device
   * signs in again at the portal, with the switch PIN as for any device new to it. To stop it, block
   * the device.
   */
  async terminate(staff: Principal, id: string) {
    const session = await this.get(staff, id);
    const ended = await this.end([id], "staff_disconnect");
    if (ended === 0) {
      throw new ConflictException(
        apiError("SESSION_NOT_ACTIVE", "That session has already ended."),
      );
    }
    const row = await this.db.wifiSession.findUniqueOrThrow({
      where: { id },
      select: { voucherId: true, deviceId: true, macAddress: true },
    });
    if (row.voucherId !== null) {
      await this.db.voucherDevice.deleteMany({
        where: {
          voucherId: row.voucherId,
          // A removed device's sessions keep no device id: its address still names it.
          device: row.deviceId === null ? { macAddress: row.macAddress } : { id: row.deviceId },
        },
      });
    }
    await this.audit.record(staff, {
      ...(await this.audit.atVenue(session.venueId)),
      action: "session.terminate",
      target: { type: "session", id: id },
      change: { before: {}, after: {} },
    });
    return this.get(staff, id);
  }

  /**
   * Marks connected sessions terminated and takes their vouchers' devices off the routers in the
   * background, forgetting them so that the router does not sign them back in. Returns how many
   * were still connected.
   */
  async end(ids: string[], reason: string): Promise<number> {
    const now = new Date();
    const connected = await this.db.wifiSession.findMany({
      where: { id: { in: ids }, status: "connected" },
    });
    let ended = 0;
    for (const session of connected) {
      const updated = await this.db.wifiSession.updateMany({
        where: { id: session.id, status: "connected" },
        data: {
          status: "terminated",
          endedAt: now,
          terminationReason: reason,
          durationSeconds: Math.max(
            0,
            Math.floor((now.getTime() - session.startedAt.getTime()) / 1000),
          ),
        },
      });
      ended += updated.count;
      if (updated.count === 1 && session.venueId !== null) {
        void this.sync.endDevice(session.venueId, session.macAddress).catch(captureFailure);
      }
    }
    return ended;
  }
}
