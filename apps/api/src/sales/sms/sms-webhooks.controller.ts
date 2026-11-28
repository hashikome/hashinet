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
import { SMS_SENDER, type Texts } from "./sender.js";
import { SmsReports } from "./sms-reports.js";

/**
 * Delivery reports, one route per provider. Public, and proved by the provider's signature over
 * the exact bytes received; the body never reaches a log, since it holds a customer's number.
 */
@Public()
@Controller("webhooks/sms")
export class SmsWebhooksController {
  constructor(
    private readonly reports: SmsReports,
    @Inject(SMS_SENDER) private readonly texts: Texts,
  ) {}

  @Post(":provider")
  @HttpCode(200)
  async report(
    @Param("provider") name: string,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<{ ok: true }> {
    const provider = this.texts.byName(name);
    if (provider === null) throw noSuchProvider();
    const outcome = provider.webhook(webhookRequest(request));
    if (outcome.kind === "refused") {
      enrichWideEvent({ "webhook.rejected": "sms" });
      throw refused();
    }
    if (outcome.kind === "report") await this.reports.apply(provider.name, outcome.report);
    return { ok: true };
  }
}
