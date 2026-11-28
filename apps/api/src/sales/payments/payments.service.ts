import { createHash, randomBytes } from "node:crypto";
import {
  type Capabilities,
  type GuestPaymentStarted,
  type GuestPaymentStatus,
  groupedCode,
} from "@hashinet/types";
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuditLog } from "../../core/audit/audit-log.js";
import type { AppConfig } from "../../core/config/config.js";
import { APP_CONFIG } from "../../core/config/config.module.js";
import { sameBytes } from "../../core/crypto/same-bytes.js";
import { SecretBox } from "../../core/crypto/secret-box.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { captureFailure } from "../../core/observability/telemetry.js";
import { enrichWideEvent } from "../../core/observability/wide-event.js";
import { Prisma } from "../../generated/prisma/client.js";
import { countFailure, isLimited } from "../../guest/sign-in/attempts.js";
import { GuestService, safeDestination } from "../../guest/sign-in/guest.service.js";
import { RouterSync } from "../../network/monitor/router-sync.js";
import { PackagesService } from "../../venues/packages/packages.service.js";
import { PaymentWaysService } from "../../venues/payment-ways/payment-ways.service.js";
import { SMS_SENDER, type Texts } from "../sms/sender.js";
import { unusedCode } from "../vouchers/voucher-codes.js";
import {
  type ChargeState,
  MOBILE_MONEY,
  type MobileMoney,
  type MobileMoneyGateway,
} from "./gateway.js";
import type { PaymentStatusInput, StartPaymentInput } from "./payment-input.js";

const WINDOW_SECONDS = 600;
/** Each attempt prompts a real phone, so these guard people, not only the provider's bill. */
const PROMPTS_PER_PHONE = 3;
const PROMPTS_PER_DEVICE = 5;
/** A venue's guests share one public address, so this has to allow a busy evening. */
const PROMPTS_PER_ADDRESS = 120;
/** How often a guest's waiting screen may ask the provider or the router. */
const POLL_GAP_MS = 5_000;
const RECONCILE_AFTER_MS = 60_000;
/** A device that paid is signed in only while it can still be waiting. */
const SIGN_IN_WINDOW_MS = 30 * 60_000;
/** After this, a paid payment still without its router needs a person. */
const PROVISION_WINDOW_MS = 7 * 24 * 3_600_000;
const SMS_CONFIRM_MS = 10 * 60_000;
const BATCH = 50;

/** What a payment is read with, for the guest's status and staff's lists alike. */
export const PAYMENT_INCLUDE = {
  voucher: true,
  package: true,
  router: true,
  venue: { select: { id: true, name: true } },
  sms: true,
} as const;

export type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

const notFound = () => new NotFoundException(apiError("NOT_FOUND", "That payment does not exist."));

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Money to access. Everything that can finish a payment (the webhook, the reconcile job, a
 * guest's waiting screen) goes through `complete`, which holds a lock on the payment, so one
 * payment is one voucher however many arrive at once. Paid is not online: `settle` does the
 * router's part, and a payment is only provisioned once the router confirms (AGENTS.md).
 */
@Injectable()
export class PaymentsService {
  private readonly settling = new Set<string>();

  constructor(
    private readonly db: PrismaService,
    private readonly sync: RouterSync,
    private readonly guest: GuestService,
    private readonly packages: PackagesService,
    readonly _audit: AuditLog,
    readonly _ways: PaymentWaysService,
    @Inject(MOBILE_MONEY) private readonly mobileMoney: MobileMoney,
    @Inject(SMS_SENDER) private readonly texts: Texts,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.box = new SecretBox(config.encryptionKey);
  }

  /** Seals the switch PIN between the sign-in that makes it and the session that reads it. */
  private readonly box: SecretBox;

  /** The provider taking new charges; off until one is set up. A counter sale needs none. */
  private activeGateway(): MobileMoneyGateway {
    if (this.mobileMoney.active !== null) return this.mobileMoney.active;
    throw new ServiceUnavailableException(
      apiError("PAYMENTS_OFF", "Mobile money is not available here yet. Ask for a voucher."),
    );
  }

  /** Starts a purchase: every check comes before a prompt reaches anybody's phone. */
  async start(input: StartPaymentInput, address: string | null): Promise<GuestPaymentStarted> {
    const gateway = this.activeGateway();
    const limits = [
      { key: `pay:address:${address ?? "unknown"}`, max: PROMPTS_PER_ADDRESS },
      { key: `pay:device:${input.mac}`, max: PROMPTS_PER_DEVICE },
      // Hashed: a rate limit is no reason to keep a number.
      { key: `pay:phone:${hash(input.phone).slice(0, 32)}`, max: PROMPTS_PER_PHONE },
    ];
    for (const { key, max } of limits) {
      if (await isLimited(this.db, key, max, WINDOW_SECONDS)) {
        throw new HttpException(
          apiError("TOO_MANY_ATTEMPTS", "Too many attempts. Wait a few minutes and try again."),
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const router = await this.guest.routerOf(input.router);
    enrichWideEvent({ "router.id": router.id, "venue.id": router.venueId });
    await this.guest.refuseBlocked(input.mac, router.venueId);
    await this.guest.refuseWhilePaused(router.venueId);

    const sold = await this.packages.onSaleAt(router.venueId);
    const pkg = sold.find((p) => p.id === input.packageId) ?? null;
    if (pkg === null) {
      throw new BadRequestException(
        apiError("PACKAGE_NOT_ON_SALE", "That package is not sold here."),
      );
    }
    const amount = Number(pkg.priceTsh);
    if (!this.mobileMoney.payable(pkg.priceTsh)) {
      throw new BadRequestException(
        apiError("PACKAGE_NOT_PAYABLE", "This package cannot be bought with mobile money."),
      );
    }
    // A device the router cannot see could never be let online, so it is not charged. A router
    // that cannot be asked is different: a payment then waits, as access owed.
    if ((await this.sync.deviceOnNetwork(router, { mac: input.mac, ip: input.ip })) === false) {
      throw new BadRequestException(
        apiError(
          "DEVICE_NOT_ON_NETWORK",
          "We could not find your phone on this WiFi. Reconnect to it and try again.",
        ),
      );
    }
    await Promise.all(limits.map(({ key }) => countFailure(this.db, key, WINDOW_SECONDS)));

    const secret = randomBytes(32).toString("hex");
    const payment = await this.db.payment.create({
      data: {
        provider: "mobile_money",
        gateway: gateway.name,
        packageId: pkg.id,
        venueId: router.venueId,
        routerId: router.id,
        phone: input.phone,
        amountTsh: amount,
        macAddress: input.mac,
        ipAddress: input.ip,
        destination: safeDestination(input.linkOrig),
        sessionSecretHash: hash(secret),
        idempotencyKey: randomBytes(15).toString("hex"),
      },
    });
    enrichWideEvent({ "payment.id": payment.id });
    try {
      const charge = await gateway.charge({
        paymentId: payment.id,
        idempotencyKey: payment.idempotencyKey ?? "",
        phone: input.phone,
        amount,
      });
      await this.db.payment.update({
        where: { id: payment.id },
        data: { providerReference: charge.reference, expiresAt: charge.expiresAt },
      });
    } catch (err) {
      await this.fail(payment.id, "The payment could not be started", null);
      captureFailure(err);
      throw new BadGatewayException(
        apiError("PAYMENT_UNAVAILABLE", "Mobile money is not available right now. Try again soon."),
      );
    }
    return { paymentId: payment.id, secret };
  }

  /**
   * What the paying session sees. Without its secret, a payment does not exist: the code goes to
   * whoever started the purchase and nobody else, never to a request naming an id or a device.
   */
  async status(input: PaymentStatusInput): Promise<GuestPaymentStatus> {
    let row = await this.db.payment.findUnique({
      where: { id: input.paymentId },
      include: PAYMENT_INCLUDE,
    });
    if (
      row?.sessionSecretHash == null ||
      !sameBytes(Buffer.from(row.sessionSecretHash), Buffer.from(hash(input.secret)))
    ) {
      throw notFound();
    }
    const quiet =
      row.lastCheckedAt === null || Date.now() - row.lastCheckedAt.getTime() >= POLL_GAP_MS;
    if (quiet) {
      await this.db.payment.update({
        where: { id: row.id },
        data: { lastCheckedAt: new Date() },
      });
      if (row.status === "pending") await this.check(row);
      else if (this.unfinished(row)) await this.settle(row.id);
      row = await this.db.payment.findUniqueOrThrow({
        where: { id: row.id },
        include: PAYMENT_INCLUDE,
      });
    }
    return guestStatus(row, await this.takePin(row));
  }

  /**
   * The switch PIN made when the paying device was signed in, to the paying session once: taken
   * off the payment as it is read, as the redeem returns it once (ADR-0015, 4).
   */
  private async takePin(row: PaymentRow): Promise<string | null> {
    if (row.switchPinSealed === null) return null;
    const { count } = await this.db.payment.updateMany({
      where: { id: row.id, switchPinSealed: row.switchPinSealed },
      data: { switchPinSealed: null },
    });
    // A voucher released since has no PIN any more; another read took it first.
    if (count === 0 || row.voucher?.pinHmac == null) return null;
    return this.box.open(row.switchPinSealed);
  }

  /** Asks the provider about a payment: for a lost webhook, and where there is no webhook. */
  private async check(row: PaymentRow): Promise<void> {
    if (row.providerReference === null) return;
    // The provider that took it, even after a switch; one no longer set up can't be asked.
    const gateway = this.mobileMoney.byName(row.gateway);
    const remote = gateway === null ? null : await gateway.state(row.providerReference);
    if (remote !== null) await this.apply(row.id, remote, null);
    // Whatever the provider says, or if it says nothing: money that arrives later still counts.
    if (remote?.state !== "completed" && row.expiresAt !== null && row.expiresAt < new Date()) {
      await this.fail(row.id, "The payment was not approved in time", null);
    }
  }

  /** Acts on what the provider reports. `event` makes a repeat of the same report do nothing. */
  async apply(
    paymentId: string,
    remote: ChargeState,
    event: { provider: string; id: string } | null,
  ): Promise<void> {
    if (remote.state === "completed") await this.complete(paymentId, remote.amount, event);
    else if (remote.state === "failed") {
      await this.fail(paymentId, remote.failureReason ?? "The payment failed", event);
    }
  }

  /**
   * The payment a provider's report is about, among the payments it took: by our id, since it can
   * beat the reference.
   */
  async findForReport(
    provider: string,
    paymentId: string | null,
    reference: string | null,
  ): Promise<string | null> {
    if (paymentId === null && reference === null) return null;
    const row = await this.db.payment.findFirst({
      where: {
        gateway: provider,
        OR: [
          ...(paymentId !== null && /^[0-9a-f-]{36}$/.test(paymentId) ? [{ id: paymentId }] : []),
          ...(reference === null ? [] : [{ providerReference: reference }]),
        ],
      },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Pending to paid, once. The voucher is made in the same transaction, under a lock on the
   * payment, so two callers cannot both make one. A failure reported earlier does not stand
   * against money that arrived.
   */
  async complete(
    paymentId: string,
    amount: number | null,
    event: { provider: string; id: string } | null,
  ): Promise<void> {
    const row = await this.db.payment.findUnique({
      where: { id: paymentId },
      include: PAYMENT_INCLUDE,
    });
    if (row === null || row.status === "paid") return;
    if (amount !== null && amount !== Number(row.amountTsh)) {
      // Never grant on a mismatch: this needs a person, and staff see why it is stuck.
      enrichWideEvent({ "payment.id": paymentId, "error.message": "amount does not match" });
      await this.db.payment.update({
        where: { id: paymentId },
        data: { provisionError: "The amount reported does not match this payment" },
      });
      captureFailure(new Error(`Payment ${paymentId}: the amount reported does not match`));
      return;
    }
    const code = await unusedCode(this.db);

    const done = await this.db.$transaction(async (tx) => {
      if (event !== null && !(await firstTime(tx, event))) return false;
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
      const current = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (current.status === "paid") return false;
      const customer =
        current.phone === null
          ? null
          : await tx.customer.upsert({
              where: { phone: current.phone },
              create: { phone: current.phone },
              update: {},
            });
      const voucher = await tx.voucher.create({
        data: {
          code,
          packageId: current.packageId,
          venueId: current.venueId,
          priceTsh: current.amountTsh,
          durationMinutes: row.package?.durationMinutes ?? null,
          dataLimitGb: row.package?.dataLimitGb ?? null,
        },
      });
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: "paid",
          paidAt: new Date(),
          voucherId: voucher.id,
          customerId: customer?.id ?? null,
        },
      });
      return true;
    });
    // After the commit: the money is recorded, so the provider can have its answer now.
    if (done) void this.settle(paymentId).catch(captureFailure);
  }

  /** Only a payment still pending can fail: a late failure never walks back a paid one. */
  private async fail(
    paymentId: string,
    reason: string,
    event: { provider: string; id: string } | null,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      if (event !== null && !(await firstTime(tx, event))) return;
      await tx.payment.updateMany({
        where: { id: paymentId, status: "pending" },
        data: { status: "failed", metadata: { failureReason: reason.slice(0, 200) } },
      });
    });
  }

  /**
   * The router's part, safe to repeat: the code goes out, the router confirms the voucher, and
   * the device that paid is signed in. What fails here waits for the reconcile job, as access
   * owed, and the code is on the paying session's screen throughout.
   */
  async settle(paymentId: string): Promise<void> {
    if (this.settling.has(paymentId)) return;
    this.settling.add(paymentId);
    try {
      const row = await this.db.payment.findUnique({
        where: { id: paymentId },
        include: PAYMENT_INCLUDE,
      });
      if (row === null || row.status !== "paid" || row.voucher === null) return;
      await this.sendCode(row);
      if (row.venueId === null) return;
      // Nothing goes to a router: RADIUS answers from the voucher itself (ADR-0015).
      if (row.routerProvisionedAt === null) {
        await this.db.payment.update({
          where: { id: paymentId },
          data: { routerProvisionedAt: new Date(), provisionError: null },
        });
      }
      if (row.signedInAt !== null || row.router === null || row.macAddress === null) return;
      // Where the device is now: an address can change while a guest approves a payment.
      const ip = await this.sync.deviceAddress(row.router, row.macAddress);
      if (ip === null) return;
      const admitted = await this.guest
        .admit(row.router, row.voucher, { mac: row.macAddress, ip, pin: null })
        // The device has moved or left: its code still works, and it is on its screen.
        .catch((err: unknown) => {
          if (err instanceof HttpException) return null;
          throw err;
        });
      if (admitted !== null) {
        await this.db.payment.update({
          where: { id: paymentId },
          data: {
            signedInAt: new Date(),
            deviceId: await this.deviceId(row.macAddress),
            // Made at this first sign-in, perhaps from a webhook: kept for the paying session.
            ...(admitted.pin === null ? {} : { switchPinSealed: this.box.seal(admitted.pin) }),
          },
        });
      }
    } finally {
      this.settling.delete(paymentId);
    }
  }

  private async deviceId(mac: string): Promise<string | null> {
    const device = await this.db.device.findUnique({ where: { macAddress: mac } });
    return device?.id ?? null;
  }

  /** Once per payment: the unique row is the guard, so a repeat of `settle` sends nothing. */
  private async sendCode(row: PaymentRow): Promise<void> {
    const sender = this.texts.active;
    if (row.phone === null || row.voucher === null || sender === null) return;
    const { count } = await this.db.smsMessage.createMany({
      data: [
        {
          paymentId: row.id,
          gateway: sender.name,
          confirmBy: new Date(Date.now() + SMS_CONFIRM_MS),
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) return;
    // The guest knows the venue by its name; a payment with none is HashiNet's.
    const venue =
      row.venueId === null
        ? { name: "HashiNet" }
        : await this.db.venue.findUniqueOrThrow({
            where: { id: row.venueId },
            select: { name: true },
          });
    try {
      const { jobId } = await sender.send({
        to: row.phone,
        text: `${venue.name} WiFi code: ${groupedCode(row.voucher.code)}. Keep it to reconnect or add a device.`,
      });
      await this.db.smsMessage.update({
        where: { paymentId: row.id },
        // Nothing reports on a message with no job: the development outbox has it already.
        data: jobId === null ? { status: "delivered" } : { status: "sent", jobId },
      });
    } catch (err) {
      captureFailure(err);
      await this.db.smsMessage.update({
        where: { paymentId: row.id },
        data: { status: "failed", failureReason: "The message could not be sent" },
      });
    }
  }

  /** Whether a paid payment still has work to do. */
  private unfinished(row: PaymentRow): boolean {
    if (row.status !== "paid" || row.paidAt === null) return false;
    if (row.routerProvisionedAt === null) return true;
    const waiting = Date.now() - row.paidAt.getTime() < SIGN_IN_WINDOW_MS;
    return row.signedInAt === null && row.macAddress !== null && waiting;
  }

  /** For lost webhooks, routers that were down, and texts nobody reported on. */
  async reconcile(): Promise<void> {
    const now = Date.now();
    const pending = await this.db.payment.findMany({
      where: {
        status: "pending",
        provider: "mobile_money",
        providerReference: { not: null },
        createdAt: { lt: new Date(now - RECONCILE_AFTER_MS) },
      },
      include: PAYMENT_INCLUDE,
      // The longest unasked first, so stuck payments cannot crowd out new ones.
      orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
      take: BATCH,
    });
    for (const row of pending) {
      await this.db.payment.update({
        where: { id: row.id },
        data: { lastCheckedAt: new Date() },
      });
      await this.check(row);
    }

    const owed = await this.db.payment.findMany({
      where: {
        status: "paid",
        paidAt: { gt: new Date(now - PROVISION_WINDOW_MS) },
        OR: [
          { routerProvisionedAt: null },
          {
            signedInAt: null,
            macAddress: { not: null },
            paidAt: { gt: new Date(now - SIGN_IN_WINDOW_MS) },
          },
        ],
      },
      select: { id: true },
      orderBy: { paidAt: "asc" },
      take: BATCH,
    });
    for (const { id } of owed) await this.settle(id).catch(captureFailure);

    await this.db.smsMessage.updateMany({
      where: { status: { in: ["sending", "sent"] }, confirmBy: { lt: new Date(now) } },
      data: { status: "unconfirmed" },
    });
  }

  capabilities(): Capabilities {
    return { mobileMoney: this.mobileMoney.active !== null, sms: this.texts.active !== null };
  }
}

/** Records a provider's event; false if it has been seen. */
async function firstTime(
  tx: Prisma.TransactionClient,
  event: { provider: string; id: string },
): Promise<boolean> {
  const { count } = await tx.webhookEvent.createMany({
    data: [{ provider: event.provider, eventId: event.id }],
    skipDuplicates: true,
  });
  return count > 0;
}

function guestStatus(row: PaymentRow, switchPin: string | null): GuestPaymentStatus {
  const voucher = row.voucher;
  const ended =
    voucher !== null &&
    (["expired", "used", "refunded"].includes(voucher.status) ||
      (voucher.expiresAt !== null && voucher.expiresAt < new Date()));
  return {
    state: row.status === "paid" ? "paid" : row.status === "pending" ? "pending" : "failed",
    code: voucher === null || ended ? null : voucher.code,
    expiresAt: voucher?.expiresAt?.toISOString() ?? null,
    online: row.signedInAt !== null && !ended,
    ended,
    owed: row.status === "paid" && row.routerProvisionedAt === null,
    sms: row.sms?.status ?? null,
    dst: row.destination,
    switchPin: ended ? null : switchPin,
  };
}
