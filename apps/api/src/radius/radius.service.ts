import type { SecretBox } from "../crypto/secret-box.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
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

const SPEED_SELECT = {
  deviceLimit: true,
  downloadSpeedMbps: true,
  uploadSpeedMbps: true,
  throttledDownloadMbps: true,
  throttledUploadMbps: true,
  peakStartHour: true,
  peakEndHour: true,
  throttleAfterGb: true,
} as const;

const VOUCHER_SELECT = {
  id: true,
  expiresAt: true,
  dataLimitGb: true,
  blockedAt: true,
  package: { select: SPEED_SELECT },
} as const;

type VoucherRow = Prisma.VoucherGetPayload<{ select: typeof VOUCHER_SELECT }>;

/** A throttled session is marked in the Class its accounting brings back. */
const THROTTLED = ":t";

function factsOf(v: VoucherRow, usedBytes: bigint): VoucherFacts {
  const p = v.package;
  return {
    id: v.id,
    expiresAt: v.expiresAt,
    deviceLimit: p?.deviceLimit ?? 1,
    dataLimitGb: v.dataLimitGb,
    usedBytes,
    blocked: v.blockedAt !== null,
    speed: {
      downloadSpeedMbps: p?.downloadSpeedMbps ?? 0,
      uploadSpeedMbps: p?.uploadSpeedMbps ?? null,
      throttledDownloadMbps: p?.throttledDownloadMbps ?? null,
      throttledUploadMbps: p?.throttledUploadMbps ?? null,
      peakStartHour: p?.peakStartHour ?? null,
      peakEndHour: p?.peakEndHour ?? null,
      throttleAfterGb: p?.throttleAfterGb ?? null,
    },
  };
}

/** What a voucher's sessions have used, up and down. */
async function usedBytesOf(
  db: Pick<PrismaService, "wifiSession">,
  voucherId: string,
): Promise<bigint> {
  const sum = await db.wifiSession.aggregate({
    where: { voucherId },
    _sum: { uploadBytes: true, downloadBytes: true },
  });
  return (sum._sum.uploadBytes ?? 0n) + (sum._sum.downloadBytes ?? 0n);
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
  /** Answers by request, kept from before the request is decided, so a repeat waits for it. */
  private readonly recent = new Map<string, { answer: Promise<Buffer | null>; at: number }>();

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

    // A router repeats a request while the first is still being decided; deciding it again would
    // find the admission used up and refuse it.
    const answer = this.answer(
      { id: router.id, venueId: router.venueId, businessId: router.venue.businessId },
      packet,
      secret,
      now,
    );
    this.recent.set(key, { answer, at: now.getTime() });
    // One that failed is decided afresh when it is repeated.
    answer.catch(() => this.recent.delete(key));
    return answer;
  }

  private async answer(
    router: { id: string; venueId: string; businessId: string },
    packet: Packet,
    secret: Buffer,
    now: Date,
  ): Promise<Buffer | null> {
    if (packet.code === CODE.accessRequest) {
      const decided = await this.access(router, packet, secret, now);
      return decided.accept
        ? reply(CODE.accessAccept, packet, this.acceptAttributes(decided), secret)
        : reply(CODE.accessReject, packet, [], secret);
    }
    if (packet.code === CODE.accountingRequest) {
      await this.account(router, packet, now);
      return reply(CODE.accountingResponse, packet, [], secret);
    }
    return null;
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
      [ATTR.class, Buffer.from(`${a.voucherId}${a.throttled ? THROTTLED : ""}`)],
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
      return terms(factsOf(voucher, await usedBytesOf(this.db, voucher.id)), now);
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
      factsOf(used.voucher, await usedBytesOf(this.db, used.voucher.id)),
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
    const throttled = named?.endsWith(THROTTLED) ?? false;
    const voucherId = named === null ? null : throttled ? named.slice(0, -THROTTLED.length) : named;
    const voucher =
      voucherId !== null && UUID.test(voucherId)
        ? await this.db.voucher.findFirst({
            where: { id: voucherId, venueId: router.venueId },
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
        isThrottled: throttled,
        startedAt:
          status === ACCT_STATUS.start
            ? now
            : new Date(now.getTime() - counters.durationSeconds * 1000),
        ...counters,
        ...state,
      },
      // A Stop never reopens a session; a late Interim after its Stop changes nothing.
      update: counters,
    });
    // HashiNet ends a session at the router (moved to another device, released, a new speed) and
    // records why first; the router's Stop then says only "admin reset", so it ends just what is
    // still open.
    if (ended) {
      await this.db.wifiSession.updateMany({
        where: { routerId: router.id, acctSessionId, status: "connected" },
        data: state,
      });
    }
  }
}
