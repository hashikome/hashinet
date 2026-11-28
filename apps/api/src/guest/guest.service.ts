import type { GuestContext, GuestSession, RedeemResult } from "@hashinet/types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { z } from "zod";
import { ownerProtected } from "../access/owner-protected.js";
import { sellingStopped } from "../billing/access-rule.js";
import { BrandService } from "../brand/brand.service.js";
import { Logos } from "../brand/logos.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma, Router, Voucher } from "../generated/prisma/client.js";
import { apiError } from "../http/error-envelope.js";
import { enrichWideEvent } from "../observability/wide-event.js";
import { PackagesService } from "../packages/packages.service.js";
import { bytes } from "../serializers/records.js";
import { RouterSync } from "../services/router-sync.js";
import { countFailure, isLimited, limitedUntil } from "./attempts.js";
import { guestContext } from "./guest-context.js";
import type { contextInput, redeemInput, sessionInput } from "./guest-input.js";
import {
  afterWrongPin,
  makePin,
  PIN_WAIT_MINUTES,
  pinHmac,
  pinMatches,
  VOUCHER_WRONG_PIN_WINDOW_SECONDS,
  VOUCHER_WRONG_PINS,
} from "./switch-pin.js";

const WINDOW_SECONDS = 600;
/** A venue's guests share one public address, so this is generous; the code length is the wall. */
const FAILURES_PER_ADDRESS = 60;
const FAILURES_PER_DEVICE = 10;
const GIB = 1_073_741_824;

const refuse = (code: string, message: string) => new BadRequestException(apiError(code, message));

/** How long a sign-in's admission waits for the router's RADIUS request. */
const ADMISSION_SECONDS = 60;

type Holder = {
  id: string;
  deviceId: string | null;
  macAddress: string;
  ipAddress: string | null;
  router: Router | null;
};

/** A voucher's wrong PINs from any device, within the hour, and the wait they start. */
const voucherWrongPins = (voucherId: string) => `pin:voucher:${voucherId}`;
const voucherPinWait = (voucherId: string) => `pin:voucher-wait:${voucherId}`;
const PIN_WAIT_SECONDS = PIN_WAIT_MINUTES * 60;

const pinLocked = () =>
  new HttpException(
    apiError(
      "PIN_LOCKED",
      "Too many wrong PINs. Show your voucher at the counter: staff can release it.",
    ),
    HttpStatus.LOCKED,
  );

const pinWait = (until: Date) =>
  new HttpException(
    apiError("PIN_WAIT", "Too many wrong PINs. Try again later.", { until: until.toISOString() }),
    HttpStatus.TOO_MANY_REQUESTS,
  );

/** One answer for a code that does not exist and one from another venue. */
const invalidVoucher = () =>
  refuse("INVALID_VOUCHER", "That code is not valid. Check it and try again.");

const notConfirmed = () =>
  new ServiceUnavailableException(
    apiError(
      "ROUTER_NOT_CONFIRMED",
      "Your voucher is fine, but the WiFi router has not let you online yet. Try again in a moment.",
    ),
  );

/**
 * What a guest does before they are online. Everything here is public and every value arrives
 * from the guest's browser, so nothing is trusted because it was sent: the router must be
 * registered and must itself see the device, and a MAC address decides nothing it would matter to
 * forge. No response carries a voucher code, and this API alone signs a device in (ADR-0008).
 */
@Injectable()
export class GuestService {
  constructor(
    private readonly db: PrismaService,
    private readonly sync: RouterSync,
    private readonly brand: BrandService,
    private readonly logos: Logos,
    private readonly packages: PackagesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async context(input: z.infer<typeof contextInput>): Promise<GuestContext> {
    const router = await this.routerOf(input.router);
    const [{ look, logoUrl }, sold, venue] = await Promise.all([
      this.brand.resolve(router.venueId),
      this.packages.onSaleAt(router.venueId),
      this.db.venue.findUniqueOrThrow({
        where: { id: router.venueId },
        include: { business: { select: { access: true } } },
      }),
    ]);
    return guestContext({
      venueName: venue.name,
      internet: router.internetOk,
      mobileMoney: this.config.features.mobileMoney,
      selling: !sellingStopped(venue.business.access),
      look,
      logoUrl,
      packages: sold,
    });
  }

  /**
   * Takes a voucher into use at this router and signs the device in. It is `pending_activation`
   * until the router reports the device online on it, and only then `active`; a guest whose
   * router has not confirmed is told so, and can try again without losing anything.
   */
  async redeem(input: z.infer<typeof redeemInput>, address: string | null): Promise<RedeemResult> {
    const limits = [
      { key: `guest:address:${address ?? "unknown"}`, max: FAILURES_PER_ADDRESS },
      { key: `guest:device:${input.mac}`, max: FAILURES_PER_DEVICE },
    ];
    for (const { key, max } of limits) {
      if (await isLimited(this.db, key, max, WINDOW_SECONDS)) {
        throw new HttpException(
          apiError("TOO_MANY_ATTEMPTS", "Too many attempts. Wait a few minutes and try again."),
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const router = await this.routerOf(input.router);
    enrichWideEvent({ "router.id": router.id, "venue.id": router.venueId });

    await this.refuseBlocked(input.mac, router.venueId);
    // Nothing would load: starting the voucher's time now would only lose the guest's time.
    if (!router.internetOk) {
      throw refuse("NO_INTERNET", "This WiFi has no internet right now. Your voucher is kept.");
    }

    const code = input.code.toUpperCase();
    const voucher = await this.db.voucher.findUnique({
      where: { code },
      include: { package: { select: { deviceLimit: true } } },
    });
    if (!voucher || voucher.venueId !== router.venueId) {
      await Promise.all(limits.map(({ key }) => countFailure(this.db, key, WINDOW_SECONDS)));
      throw invalidVoucher();
    }
    enrichWideEvent({ "voucher.id": voucher.id, "voucher.status": voucher.status });
    refuseIfFinished(voucher);
    if (voucher.blockedAt !== null) {
      throw new ForbiddenException(
        apiError("VOUCHER_BLOCKED", "This voucher cannot use this WiFi."),
      );
    }

    const { pin } = await this.admit(router, voucher, voucher.package?.deviceLimit ?? 1, input);
    const { expiresAt, givenBackMinutes } = await this.db.voucher.findUniqueOrThrow({
      where: { id: voucher.id },
    });
    return {
      dst: safeDestination(input.linkOrig),
      expiresAt: expiresAt?.toISOString() ?? null,
      givenBackMinutes,
      switchPin: pin,
    };
  }

  /** A guest buys nothing while the venue's business can't sell (ADR-0014, 2). */
  async refuseWhilePaused(venueId: string): Promise<void> {
    const venue = await this.db.venue.findUniqueOrThrow({
      where: { id: venueId },
      select: { business: { select: { access: true } } },
    });
    if (sellingStopped(venue.business.access)) {
      throw new ConflictException(
        apiError("SELLING_PAUSED", "Vouchers aren't on sale here right now."),
      );
    }
  }

  /** Refuses a device the venue's business has blocked; another business's block is not this one's. */
  async refuseBlocked(mac: string, venueId: string): Promise<void> {
    const block = await this.db.deviceBlock.findFirst({
      where: { device: { macAddress: mac }, business: { venues: { some: { id: venueId } } } },
    });
    if (block !== null) {
      throw new ForbiddenException(apiError("DEVICE_BLOCKED", "This device cannot use this WiFi."));
    }
  }

  /**
   * Lets a device online on a voucher: the one way in, whether the guest typed a code or paid. The
   * router must see the device; the voucher must have a place for it (devices online at once,
   * across the venue's routers, ADR-0015), which a new device on a voucher in use takes only with
   * its switch PIN; then the API signs it in, the router asks RADIUS, which takes the admission left
   * here, and only once the router reports it online is the voucher `active`. The first device gets
   * the switch PIN, returned here once. A failure is an error a guest can retry.
   */
  async admit(
    router: Router,
    voucher: Voucher,
    deviceLimit: number,
    device: { mac: string; ip: string; pin: string | null },
  ): Promise<{ pin: string | null }> {
    // A device that would need the PIN while it, or the voucher, waits or is locked is refused from
    // the database before any router is asked; the claim checks again under the voucher's lock.
    if (voucher.status !== "unused" && voucher.pinHmac !== null) {
      const known = await this.db.device.findUnique({
        where: { macAddress: device.mac },
        select: {
          id: true,
          vouchers: { where: { voucherId: voucher.id }, select: { deviceId: true } },
        },
      });
      if (known === null || known.vouchers.length === 0) {
        const barred = await this.pinBarrier(this.db, voucher.id, known?.id ?? null, new Date());
        if (barred.refused) throw barred.refused;
      }
    }

    // Asked only once a code is good, so the public route cannot be used to reach a router at will,
    // and before the claim, so the clock never starts for a device that is not here.
    const present = await this.sync.deviceOnNetwork(router, device);
    if (present === null) throw notConfirmed();
    if (!present) {
      throw refuse(
        "DEVICE_NOT_ON_NETWORK",
        "We could not find your phone on this WiFi. Reconnect to it and try again.",
      );
    }

    // Who holds the voucher's places, and which of them have gone: asked of the routers before the
    // voucher is locked, so the lock is never held across a router call.
    const holders = await this.db.wifiSession.findMany({
      where: { voucherId: voucher.id, status: "connected", macAddress: { not: device.mac } },
      orderBy: { startedAt: "asc" },
      select: { id: true, deviceId: true, macAddress: true, ipAddress: true, router: true },
    });
    const answers = await Promise.all(
      holders.map(async (h) =>
        h.router && h.ipAddress ? this.sync.stillThere(h.router, h.ipAddress) : null,
      ),
    );
    const gone = new Set(holders.filter((_, i) => answers[i] === false).map((h) => h.id));

    const claimed = await this.claim(voucher, device, deviceLimit, router, holders, gone);
    if (claimed.refused) throw claimed.refused;
    for (const h of claimed.displaced) {
      if (h.router) await this.sync.endSession(h.router, h.macAddress);
    }

    const client = { user: voucher.code, ip: device.ip, mac: device.mac };
    if (!(await this.sync.signInDevice(router, client))) throw notConfirmed();

    await this.db.voucher.updateMany({
      where: { id: voucher.id, status: "pending_activation" },
      data: { status: "active" },
    });
    // Shown once, now the device is online: its PIN was made with the claim.
    return { pin: claimed.pin };
  }

  /** A venue's or a business's logo, for the portal page. Null when there is none by that name. */
  image(ownerId: string, file: string): Promise<Uint8Array | null> {
    return this.logos.read(ownerId, file);
  }

  /**
   * A device's remaining time and data, for the router's status pages. Those are served over the
   * WiFi in clear, so they hold no code: they name the device. A forged MAC reads a figure, and
   * never a code.
   */
  async session(input: z.infer<typeof sessionInput>): Promise<GuestSession> {
    const inactive: GuestSession = { active: false, time: null, data: null };
    const router = await this.db.router.findUnique({ where: { id: input.router } });
    if (!router) return inactive;
    const voucher = await this.db.voucher.findFirst({
      where: {
        venueId: router.venueId,
        status: "active",
        devices: { some: { device: { macAddress: input.mac } } },
      },
      orderBy: { activatedAt: "desc" },
    });
    const now = new Date();
    if (!voucher || (voucher.expiresAt !== null && voucher.expiresAt < now)) return inactive;
    const usage = await this.db.wifiSession.aggregate({
      where: { voucherId: voucher.id },
      _sum: { uploadBytes: true, downloadBytes: true },
    });
    const usedBytes = bytes((usage._sum.uploadBytes ?? 0n) + (usage._sum.downloadBytes ?? 0n));
    const limitBytes = voucher.dataLimitGb === null ? null : voucher.dataLimitGb * GIB;
    return {
      active: true,
      time: {
        unlimited: voucher.expiresAt === null,
        secondsRemaining:
          voucher.expiresAt === null
            ? null
            : Math.floor((voucher.expiresAt.getTime() - now.getTime()) / 1000),
        expiresAt: voucher.expiresAt?.toISOString() ?? null,
      },
      data: {
        unlimited: limitBytes === null,
        usedBytes,
        limitBytes,
        remainingBytes: limitBytes === null ? null : Math.max(0, limitBytes - usedBytes),
      },
    };
  }

  /**
   * Records the device, starts the voucher and takes it a place, holding a lock on the voucher, so
   * two devices at once can't both take the last place and two sign-ins can't both start its clock.
   * A new device on a voucher in use, or a known one whose places all hold devices still there,
   * needs the switch PIN; a wrong one is counted, and committed, before it is refused. The right one
   * moves the voucher: the oldest device online gives up its place. A device that gives up its place
   * leaves the voucher, so it can't come back by its address before the new device's session opens;
   * it signs in again at the portal. Leaves the admission the router's RADIUS request takes.
   */
  private async claim(
    voucher: Voucher,
    input: { mac: string; ip: string; pin: string | null },
    deviceLimit: number,
    router: Router,
    holders: Holder[],
    gone: Set<string>,
  ): Promise<{ refused: HttpException | null; displaced: Holder[]; pin: string | null }> {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vouchers WHERE id = ${voucher.id}::uuid FOR UPDATE`;
      const now = new Date();
      const device = await tx.device.upsert({
        where: { macAddress: input.mac },
        create: { macAddress: input.mac, lastIpAddress: input.ip, lastActiveAt: now },
        update: { lastIpAddress: input.ip, lastActiveAt: now },
      });
      const current = await tx.voucher.findUniqueOrThrow({ where: { id: voucher.id } });
      refuseIfFinished(current);
      const key = { voucherId_deviceId: { voucherId: voucher.id, deviceId: device.id } };
      const known = (await tx.voucherDevice.findUnique({ where: key })) !== null;
      const live = holders.filter((h) => !gone.has(h.id));
      const full = live.length >= deviceLimit;

      if (current.status !== "unused" && current.pinHmac !== null && (!known || full)) {
        const refused = await this.checkPin(tx, current, device.id, input.pin, now);
        if (refused) return { refused, displaced: [], pin: null };
      }
      const displaced = [
        ...holders.filter((h) => gone.has(h.id)),
        ...(full ? live.slice(0, live.length - deviceLimit + 1) : []),
      ];
      if (displaced.length > 0) {
        await tx.wifiSession.updateMany({
          where: { id: { in: displaced.map((h) => h.id) } },
          data: {
            status: "terminated",
            endedAt: now,
            terminationReason: "moved_to_another_device",
          },
        });
        await tx.voucherDevice.deleteMany({
          where: {
            voucherId: voucher.id,
            OR: [
              { deviceId: { in: displaced.flatMap((h) => (h.deviceId ? [h.deviceId] : [])) } },
              { device: { macAddress: { in: displaced.map((h) => h.macAddress) } } },
            ],
          },
        });
      }
      if (!known)
        await tx.voucherDevice.create({ data: { voucherId: voucher.id, deviceId: device.id } });
      if (current.status === "unused") {
        await tx.voucher.update({
          where: { id: voucher.id },
          data: {
            status: "pending_activation",
            activatedAt: now,
            redeemedByDeviceId: device.id,
            expiresAt: expiryOf(current, now),
          },
        });
      }
      // The switch PIN is made in the claim that starts the voucher, so a second device never finds
      // one in use without it: for the first device (again, while its sign-in is unconfirmed, as the
      // PIN it was never shown can't be asked for), and for the first after a release.
      const first =
        current.status === "unused" ||
        (current.status === "pending_activation" && current.redeemedByDeviceId === device.id);
      const pin = first || current.pinHmac === null ? makePin() : null;
      if (pin !== null) {
        await tx.voucher.update({
          where: { id: voucher.id },
          data: { pinHmac: pinHmac(this.config.pinKey, voucher.id, pin) },
        });
      }
      const admission = {
        voucherId: voucher.id,
        deviceId: device.id,
        expiresAt: new Date(now.getTime() + ADMISSION_SECONDS * 1000),
      };
      await tx.radiusAdmission.upsert({
        where: { routerId_macAddress: { routerId: router.id, macAddress: input.mac } },
        create: { ...admission, routerId: router.id, macAddress: input.mac },
        update: admission,
      });
      return { refused: null, displaced, pin };
    });
  }

  /**
   * Whether a move to the voucher waits or is refused, before a PIN is looked at: this device locked
   * (six wrong) or waiting (three), or the voucher waiting after fifteen wrong from any devices in
   * the hour. Returns this device's attempts too, for the count.
   */
  private async pinBarrier(
    db: Prisma.TransactionClient,
    voucherId: string,
    deviceId: string | null,
    now: Date,
  ): Promise<{ refused: HttpException | null; wrongTries: number }> {
    const attempt =
      deviceId === null
        ? null
        : await db.pinAttempt.findUnique({
            where: { voucherId_deviceId: { voucherId, deviceId } },
          });
    const wrongTries = attempt?.wrongTries ?? 0;
    if (attempt?.lockedAt) return { refused: pinLocked(), wrongTries };
    if (attempt?.waitUntil && attempt.waitUntil > now) {
      return { refused: pinWait(attempt.waitUntil), wrongTries };
    }
    const until = await limitedUntil(db, voucherPinWait(voucherId), 1, PIN_WAIT_SECONDS);
    return { refused: until ? pinWait(until) : null, wrongTries };
  }

  /**
   * The switch PIN, checked for the device asking: locked, waiting, missing and wrong are refused. A
   * wrong one counts against that device (three wait 15 minutes, six lock it until a release) and
   * against the voucher, whose fifteenth in the hour makes every move wait. The right one starts the
   * device's count again. Null when it may go on.
   */
  private async checkPin(
    tx: Prisma.TransactionClient,
    voucher: Voucher,
    deviceId: string,
    pin: string | null,
    now: Date,
  ): Promise<HttpException | null> {
    const barred = await this.pinBarrier(tx, voucher.id, deviceId, now);
    if (barred.refused) return barred.refused;
    if (pin === null) {
      return new ConflictException(
        apiError(
          "PIN_REQUIRED",
          "This voucher is online on another device. Enter its switch PIN to move it to this phone.",
        ),
      );
    }
    const key = { voucherId_deviceId: { voucherId: voucher.id, deviceId } };
    if (
      voucher.pinHmac !== null &&
      pinMatches(this.config.pinKey, voucher.id, pin, voucher.pinHmac)
    ) {
      await tx.pinAttempt.updateMany({
        where: { voucherId: voucher.id, deviceId },
        data: { wrongTries: 0, waitUntil: null },
      });
      return null;
    }
    const after = afterWrongPin(barred.wrongTries, now);
    await tx.pinAttempt.upsert({
      where: key,
      create: { voucherId: voucher.id, deviceId, ...after },
      update: after,
    });
    await countFailure(tx, voucherWrongPins(voucher.id), VOUCHER_WRONG_PIN_WINDOW_SECONDS);
    const voucherFull = await limitedUntil(
      tx,
      voucherWrongPins(voucher.id),
      VOUCHER_WRONG_PINS,
      VOUCHER_WRONG_PIN_WINDOW_SECONDS,
    );
    if (voucherFull) await countFailure(tx, voucherPinWait(voucher.id), PIN_WAIT_SECONDS);
    if (after.lockedAt) return pinLocked();
    if (after.waitUntil) return pinWait(after.waitUntil);
    const until = voucherFull
      ? await limitedUntil(tx, voucherPinWait(voucher.id), 1, PIN_WAIT_SECONDS)
      : null;
    if (until) return pinWait(until);
    return refuse("PIN_WRONG", "That PIN isn't right. Check it and try again.");
  }

  /** The router a guest is at, refused until its venue may serve: once the business's owner has
   * protected their sign-in (ADR-0011, 9). */
  async routerOf(id: string): Promise<Router> {
    const router = await this.db.router.findUnique({
      where: { id },
      include: { venue: { select: { businessId: true } } },
    });
    if (!router) {
      throw new NotFoundException(apiError("UNKNOWN_ROUTER", "This network is not recognised."));
    }
    if (!(await ownerProtected(this.db, router.venue.businessId))) {
      throw new ForbiddenException(apiError("NOT_OPEN", "This WiFi is not open to guests yet."));
    }
    const { venue: _venue, ...rest } = router;
    return rest;
  }
}

function refuseIfFinished(voucher: Pick<Voucher, "status" | "expiresAt">): void {
  if (voucher.status === "refunded") throw refuse("VOUCHER_REFUNDED", "This voucher was refunded.");
  if (voucher.status === "used") throw refuse("VOUCHER_USED", "This voucher has been used up.");
  if (
    voucher.status === "expired" ||
    (voucher.expiresAt !== null && voucher.expiresAt < new Date())
  ) {
    throw refuse("VOUCHER_EXPIRED", "This voucher has expired.");
  }
}

/** The earlier of its use-by date and its duration from now. */
function expiryOf(voucher: Pick<Voucher, "expiresAt" | "durationMinutes">, now: Date): Date | null {
  if (voucher.durationMinutes === null) return voucher.expiresAt;
  const end = now.getTime() + voucher.durationMinutes * 60_000;
  return new Date(Math.min(end, voucher.expiresAt?.getTime() ?? end));
}

/** Where to send the guest afterwards: a web address, or nowhere. */
export function safeDestination(linkOrig: string): string | null {
  if (!URL.canParse(linkOrig)) return null;
  const url = new URL(linkOrig);
  if (!["http:", "https:"].includes(url.protocol)) return null;
  return url.toString();
}
