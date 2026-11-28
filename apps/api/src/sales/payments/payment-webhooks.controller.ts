import {
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  type RawBodyRequest,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../../core/access/access.guard.js";
import { enrichWideEvent } from "../../core/observability/wide-event.js";
import { noSuchProvider, refused, webhookRequest } from "../webhook-http.js";
import { MOBILE_MONEY, type MobileMoney } from "./gateway.js";
import { PaymentsService } from "./payments.service.js";

/**
 * Payment reports, one route per provider. Public, and proved by the provider's signature over
 * the exact bytes received; the body never reaches a log, since it holds a customer's number. The
 * change is written before the 2xx, so a provider's retry covers a crash, and router work happens
 * after it.
 */
@Public()
@Controller("webhooks/payments")
export class PaymentWebhooksController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(MOBILE_MONEY) private readonly mobileMoney: MobileMoney,
  ) {}

  @Post(":provider")
  @HttpCode(200)
  async report(
    @Param("provider") name: string,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<{ ok: true }> {
    const provider = this.mobileMoney.byName(name);
    if (provider === null) throw noSuchProvider();
    const outcome = provider.webhook(webhookRequest(request));
    if (outcome.kind === "refused") {
      enrichWideEvent({ "webhook.rejected": "payment" });
      throw refused();
    }
    if (outcome.kind === "ignored") return { ok: true };
    const { report } = outcome;
    const paymentId = await this.payments.findForReport(
      provider.name,
      report.paymentId,
      report.reference,
    );
    if (paymentId === null) {
      enrichWideEvent({ "webhook.unmatched": "payment" });
      return { ok: true };
    }
    if (report.charge.state === "completed" && report.currency !== "TZS") {
      enrichWideEvent({ "webhook.rejected": "currency" });
      return { ok: true };
    }
    await this.payments.apply(paymentId, report.charge, {
      provider: `payments:${provider.name}`,
      id: report.eventId,
    });
    return { ok: true };
  }
}
