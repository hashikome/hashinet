import { Inject, Injectable, Module } from "@nestjs/common";
import { BrandModule } from "../brand/brand.module.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { GuestModule } from "../guest/guest.module.js";
import { IntervalJob, ScheduledJobs } from "../jobs/interval-job.js";
import { SmsReports } from "../messaging/sms-reports.js";
import { PackagesModule } from "../packages/packages.module.js";
import { RoutersModule } from "../routers/routers.module.js";
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
  imports: [RoutersModule, PackagesModule, BrandModule, GuestModule],
  controllers: [GuestPaymentsController, PaymentsController, WebhooksController],
  providers: [PaymentsService, SmsReports, PaymentJobs],
})
export class PaymentsModule {}
