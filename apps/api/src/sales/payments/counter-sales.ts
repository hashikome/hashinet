import { type SaleResult } from "@hashinet/types";
import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Principal } from "../../core/access/principal.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { captureFailure } from "../../core/observability/telemetry.js";
import { SERVING } from "../../network/routers/router-journey.js";
import { PackagesService } from "../../venues/packages/packages.service.js";
import { PaymentWaysService } from "../../venues/payment-ways/payment-ways.service.js";
import { SMS_SENDER, type Texts } from "../sms/sender.js";
import { unusedCode } from "../vouchers/voucher-codes.js";
import type { SaleInput } from "./payment-input.js";

import { PaymentsService } from "./payments.service.js";

/** A sale at the counter: the money in hand, the voucher made at its sale (ADR-0017). */
@Injectable()
export class CounterSales {
  constructor(
    private readonly audit: AuditLog,
    private readonly db: PrismaService,
    private readonly packages: PackagesService,
    private readonly payments: PaymentsService,
    @Inject(SMS_SENDER) private readonly texts: Texts,
    private readonly ways: PaymentWaysService,
  ) {}

  /**
   * A sale staff record: the money has changed hands, so no prompt reaches a phone. The voucher
   * is shown to them, and sent if there is a number.
   */
  async recordSale(staff: Principal, input: SaleInput): Promise<SaleResult> {
    // What the venue sells, in the seller's scope, and whether a router can take a voucher.
    const [sold, serving] = await Promise.all([
      this.packages.onSaleIn(staff, input.venueId),
      this.db.router.count({ where: { venueId: input.venueId, ...SERVING } }),
    ]);
    // A voucher with no router to take it sells nothing a guest can use.
    if (serving === 0) {
      throw new ConflictException(
        apiError(
          "VENUE_NOT_SERVING",
          "This venue has no router serving guests right now, so it can't sell.",
        ),
      );
    }
    const pkg = sold.find((p) => p.id === input.packageId) ?? null;
    if (pkg === null) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          packageId: "is not on sale at this venue",
        }),
      );
    }
    // By mobile money the guest pays the venue's way, so a sale needs one and keeps what was read out.
    const paidTo =
      input.method === "mobile_money" ? (await this.ways.resolve(input.venueId)).way : null;
    if (input.method === "mobile_money" && paidTo === null) {
      throw new ConflictException(
        apiError(
          "NO_PAYMENT_WAY",
          "This business has no way to pay by mobile money yet. Sell for cash, or add one in Settings › Payments.",
        ),
      );
    }
    const code = await unusedCode(this.db);
    const { phone } = input;
    const payment = await this.db.$transaction(async (tx) => {
      const customer =
        phone === null
          ? null
          : await tx.customer.upsert({ where: { phone }, create: { phone }, update: {} });
      const voucher = await tx.voucher.create({
        data: {
          code,
          packageId: pkg.id,
          venueId: input.venueId,
          priceTsh: pkg.priceTsh,
          durationMinutes: pkg.durationMinutes,
          dataLimitGb: pkg.dataLimitGb,
        },
      });
      return tx.payment.create({
        data: {
          provider: input.method === "cash" ? "cash" : "mobile_money",
          status: "paid",
          paidAt: new Date(),
          packageId: pkg.id,
          venueId: input.venueId,
          voucherId: voucher.id,
          customerId: customer?.id ?? null,
          phone,
          amountTsh: pkg.priceTsh,
          recordedById: staff.membershipId,
          paidThrough: paidTo?.through ?? null,
          paidToNumber: paidTo?.number ?? null,
          paidToName: paidTo?.name ?? null,
        },
      });
    });
    await this.audit.record(staff, {
      ...(await this.audit.atVenue(input.venueId)),
      action: "sale.record",
      target: { type: "payment", id: payment.id },
      change: { before: {}, after: { method: input.method } },
    });
    // The money is in hand, so the seller never waits on a router or a text: they settle after the
    // answer (ADR-0010, 2), and the guest's sign-in confirms the voucher with the router regardless.
    void this.payments.settle(payment.id).catch(captureFailure);
    return { paymentId: payment.id, code, texted: phone !== null && this.texts.active !== null };
  }
}
