import { Inject, Injectable, Module } from "@nestjs/common";
import type { AppConfig } from "../core/config/config.js";
import { APP_CONFIG } from "../core/config/config.module.js";
import { IntervalJob, ScheduledJobs } from "../core/jobs/interval-job.js";
import { GuestModule } from "../guest/guest.module.js";
import { SmsReports } from "../messaging/sms-reports.js";
import { RoutersModule } from "../network/routers/routers.module.js";
import { PackagesModule } from "../venues/packages/packages.module.js";
import { PaymentWaysModule } from "../venues/payment-ways/payment-ways.module.js";
import { GuestPaymentsController, PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { WebhooksController } from "./webhooks.controller.js";

const MINUTE = 60_000;

/** Settles payments whose report never came. */
@Injectable()
class PaymentJobs extends ScheduledJobs {
  protected readonly jobs: IntervalJob[];

  constructor(@Inject(APP_CONFIG) config: AppConfig, payments: PaymentsService) {
    super(config.jobsEnabled);
    this.jobs = [new IntervalJob("payment.reconcile", MINUTE, () => payments.reconcile())];
  }
}

@Module({
  imports: [RoutersModule, PackagesModule, PaymentWaysModule, GuestModule],
  controllers: [GuestPaymentsController, PaymentsController, WebhooksController],
  providers: [PaymentsService, SmsReports, PaymentJobs],
})
export class PaymentsModule {}
