import type { SecretBox } from "../crypto/secret-box.js";
import type { PrismaService } from "../database/prisma.service.js";
import {
  type Answer,
  askOf,
  comesBack,
  normalMac,
  terms,
  type VoucherFacts,
} from "./access-decision.js";
import {
  ACCT_STATUS,
  ATTR,
  attr,
  CODE,
  decode,
  int,
  MalformedPacket,
  MIKROTIK,
  mikrotik,
  type Packet,
  password,
  reply,
  signedBy,
  text,
  u32,
} from "./codec.js";

/** How often a router reports a session's bytes (Acct-Interim-Interval). */
export const INTERIM_SECONDS = 60;
/** A router repeats a request it got no answer to: the same answer, within this long. */
const REPEAT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const VOUCHER_SELECT = {
  id: true,
  expiresAt: true,
  dataLimitGb: true,
  dataUsedBytes: true,
  pinLockedAt: true,
  package: {
    select: {
      deviceLimit: true,
      downloadSpeedMbps: true,
      uploadSpeedMbps: true,
      throttledDownloadMbps: true,
      throttledUploadMbps: true,
    },
  },
} as const;

type VoucherRow = {
  id: string;
  expiresAt: Date | null;
  dataLimitGb: number | null;
  dataUsedBytes: bigint;
  pinLockedAt: Date | null;
  package: {
    deviceLimit: number;
    downloadSpeedMbps: number;
    uploadSpeedMbps: number | null;
    throttledDownloadMbps: number | null;
    throttledUploadMbps: number | null;
  } | null;
};

function factsOf(v: VoucherRow): VoucherFacts {
  return {
    id: v.id,
    expiresAt: v.expiresAt,
    deviceLimit: v.package?.deviceLimit ?? 1,
    dataLimitGb: v.dataLimitGb,
    dataUsedBytes: v.dataUsedBytes,
    pinLocked: v.pinLockedAt !== null,
    speed: {
      downloadSpeedMbps: v.package?.downloadSpeedMbps ?? 0,
      uploadSpeedMbps: v.package?.uploadSpeedMbps ?? null,
      throttledDownloadMbps: v.package?.throttledDownloadMbps ?? null,
      throttledUploadMbps: v.package?.throttledUploadMbps ?? null,
    },
  };
}

/** What a session ended for, from the router's Acct-Terminate-Cause (RFC 2866, 5.10). */
function endOf(cause: number | null): {
  status: "expired" | "terminated" | "disconnected";
  reason: string;
} {
  if (cause === 5) return { status: "expired", reason: "session_timeout" };
  if (cause === 6) return { status: "terminated", reason: "admin_reset" };
  if (cause === 4) return { status: "disconnected", reason: "idle_timeout" };
  if (cause === 1) return { status: "disconnected", reason: "user_request" };
  return { status: "disconnected", reason: "lost_carrier" };
}

const bytes = (packet: Packet, octets: number, gigawords: number) =>
  BigInt(int(packet, octets) ?? 0) + (BigInt(int(packet, gigawords) ?? 0) << 32n);

/**
 * HashiNet's answer to every hotspot login and session report (ADR-0015), relayed by the tunnel
 * service with the router's tunnel address. An Access-Request is answered from the database alone,
 * inside the router's RADIUS timeout: the slow checks happened at the portal's sign-in, which left an
 * admission for the next request. A request from no known router, or not signed with its secret, gets
 * no answer at all.
 */
export class RadiusService {
  private readonly recent = new Map<string, { answer: Buffer | null; at: number }>();

  constructor(
    private readonly db: PrismaService,
    private readonly box: SecretBox,
  ) {}

  async handle(peer: string, raw: Buffer, now = new Date()): Promise<Buffer | null> {
    let packet: Packet;
    try {
      packet = decode(raw);
    } catch (err) {
      if (err instanceof MalformedPacket) return null;
      throw err;
    }
    const router = await this.db.router.findUnique({
      where: { tunnelAddress: peer },
      select: {
        id: true,
        venueId: true,
        radiusSecretEncrypted: true,
        venue: { select: { businessId: true } },
      },
    });
    if (!router?.radiusSecretEncrypted) return null;
    const secret = Buffer.from(this.box.open(router.radiusSecretEncrypted));
    if (!signedBy(raw, packet, secret)) return null;

    const key = `${router.id}|${packet.code}|${packet.identifier}|${packet.authenticator.toString("hex")}`;
    this.forgetOld(now.getTime());
    const seen = this.recent.get(key);
    if (seen) return seen.answer;

    let answer: Buffer | null = null;
    if (packet.code === CODE.accessRequest) {
      const decided = await this.access(
        { id: router.id, venueId: router.venueId, businessId: router.venue.businessId },
        packet,
        secret,
        now,
      );
      answer = decided.accept
        ? reply(CODE.accessAccept, packet, this.acceptAttributes(decided), secret)
        : reply(CODE.accessReject, packet, [], secret);
    } else if (packet.code === CODE.accountingRequest) {
      await this.account({ id: router.id, venueId: router.venueId }, packet, now);
      answer = reply(CODE.accountingResponse, packet, [], secret);
    }
    this.recent.set(key, { answer, at: now.getTime() });
    return answer;
  }

  private forgetOld(nowMs: number): void {
    for (const [key, { at }] of this.recent) {
      if (nowMs - at > REPEAT_MS) this.recent.delete(key);
    }
  }

  private acceptAttributes(a: Extract<Answer, { accept: true }>): [number, Buffer][] {
    return [
      [ATTR.sessionTimeout, u32(a.sessionSeconds)],
      [ATTR.acctInterimInterval, u32(INTERIM_SECONDS)],
      // Comes back in its accounting, naming the voucher whatever the router shows as its user.
      [ATTR.class, Buffer.from(a.voucherId)],
      ...(a.rateLimit ? [mikrotik(MIKROTIK.rateLimit, Buffer.from(a.rateLimit))] : []),
    ];
  }

  private async access(
    router: { id: string; venueId: string; businessId: string },
    packet: Packet,
    secret: Buffer,
    now: Date,
  ): Promise<Answer> {
    const ask = askOf(
      text(packet, ATTR.userName),
      text(packet, ATTR.callingStationId),
      attr(packet, ATTR.userPassword) ? password(packet, secret) : null,
    );
    if (ask.kind === "unknown") return { accept: false, reason: "unknown" };
    const device = await this.db.device.findUnique({
      where: { macAddress: ask.mac },
      select: {
        id: true,
        blocks: { where: { businessId: router.businessId }, select: { deviceId: true } },
      },
    });
    if (device && device.blocks.length > 0) return { accept: false, reason: "blocked" };

    if (ask.kind === "code") {
      const voucher = await this.db.voucher.findFirst({
        where: { code: ask.code, venueId: router.venueId },
        select: VOUCHER_SELECT,
      });
      if (!voucher) return { accept: false, reason: "unknown_code" };
      // Only a sign-in the API just made: its admission is taken, once.
      const taken = await this.db.radiusAdmission.deleteMany({
        where: {
          routerId: router.id,
          macAddress: ask.mac,
          voucherId: voucher.id,
          expiresAt: { gt: now },
        },
      });
      if (taken.count === 0) return { accept: false, reason: "not_admitted" };
      return terms(factsOf(voucher), now);
    }

    if (!device) return { accept: false, reason: "unknown_device" };
    const used = await this.db.voucherDevice.findFirst({
      where: {
        deviceId: device.id,
        voucher: { venueId: router.venueId, status: "active", expiresAt: { gt: now } },
      },
      orderBy: { createdAt: "desc" },
      select: { voucher: { select: VOUCHER_SELECT } },
    });
    if (!used) return { accept: false, reason: "no_voucher" };
    const online = await this.db.wifiSession.findMany({
      where: { voucherId: used.voucher.id, status: "connected" },
      select: { macAddress: true },
    });
    return comesBack(
      factsOf(used.voucher),
      online.map((s) => ({ mac: s.macAddress })),
      ask.mac,
      now,
    );
  }

  /** A session's reports: it opens, counts its bytes and ends here, once per Acct-Session-Id. */
  private async account(
    router: { id: string; venueId: string },
    packet: Packet,
    now: Date,
  ): Promise<void> {
    const status = int(packet, ATTR.acctStatusType);
    if (status === ACCT_STATUS.on || status === ACCT_STATUS.off) {
      // The router started or stopped: nothing it had online is still online.
      await this.db.wifiSession.updateMany({
        where: { routerId: router.id, status: "connected" },
        data: { status: "disconnected", endedAt: now, terminationReason: "router_restarted" },
      });
      return;
    }
    const acctSessionId = text(packet, ATTR.acctSessionId);
    const mac = normalMac(text(packet, ATTR.callingStationId));
    if (acctSessionId === null || mac === null) return;
    if (
      status !== ACCT_STATUS.start &&
      status !== ACCT_STATUS.interim &&
      status !== ACCT_STATUS.stop
    ) {
      return;
    }
    const named = text(packet, ATTR.class);
    const voucher =
      named !== null && UUID.test(named)
        ? await this.db.voucher.findFirst({
            where: { id: named, venueId: router.venueId },
            select: { id: true, packageId: true },
          })
        : null;
    const ip = attr(packet, ATTR.framedIpAddress);
    const ipAddress = ip && ip.length === 4 ? [...ip].join(".") : null;
    const device = await this.db.device.upsert({
      where: { macAddress: mac },
      create: { macAddress: mac, lastIpAddress: ipAddress, lastActiveAt: now },
      update: { lastIpAddress: ipAddress, lastActiveAt: now },
      select: { id: true },
    });
    const counters = {
      uploadBytes: bytes(packet, ATTR.acctInputOctets, ATTR.acctInputGigawords),
      downloadBytes: bytes(packet, ATTR.acctOutputOctets, ATTR.acctOutputGigawords),
      durationSeconds: int(packet, ATTR.acctSessionTime) ?? 0,
    };
    const ended = status === ACCT_STATUS.stop ? endOf(int(packet, ATTR.acctTerminateCause)) : null;
    const state = ended
      ? { status: ended.status, endedAt: now, terminationReason: ended.reason }
      : {};
    await this.db.wifiSession.upsert({
      where: { routerId_acctSessionId: { routerId: router.id, acctSessionId } },
      create: {
        routerId: router.id,
        venueId: router.venueId,
        acctSessionId,
        voucherId: voucher?.id ?? null,
        packageId: voucher?.packageId ?? null,
        deviceId: device.id,
        macAddress: mac,
        ipAddress,
        startedAt:
          status === ACCT_STATUS.start
            ? now
            : new Date(now.getTime() - counters.durationSeconds * 1000),
        ...counters,
        ...state,
      },
      // A Stop never reopens a session; a late Interim after its Stop changes nothing.
      update: ended ? { ...counters, ...state } : counters,
    });
  }
}
