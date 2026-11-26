import { Inject, Injectable, Module } from "@nestjs/common";
import { businessDayOf, monthBefore } from "../analytics/business-day.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IssuesModule } from "../issues/issues.module.js";
import { IntervalJob, ScheduledJobs } from "../jobs/interval-job.js";
import { BillingController } from "./billing.controller.js";
import { BillingSettings } from "./billing-settings.js";
import { BILLING_STARTS, Invoices } from "./invoices.js";
import { BillPayments } from "./payments.js";
import { ServiceAccessService } from "./service-access.js";

const HOUR = 60 * 60 * 1000;

/**
 * Every hour: last month's invoices, issued once each, so the 1st's are out within the hour and a
 * run the API missed while down is made up; and any onboarding invoice a crash left unissued.
 */
@Injectable()
export class BillingJobs extends ScheduledJobs {
  protected readonly jobs: IntervalJob[];

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    invoices: Invoices,
    access: ServiceAccessService,
  ) {
    super(config.jobsEnabled);
    this.jobs = [
      new IntervalJob("billing.invoices", HOUR, async () => {
        const period = monthBefore(businessDayOf(new Date()));
        if (period >= BILLING_STARTS) await invoices.issueMonth(period);
        await invoices.issueMissingOnboarding();
        // Due today and unpaid: its owners hear, once.
        await invoices.remindDue();
        // What each owner owes, as an issue at the top of theirs.
        await invoices.syncBillIssues();
        // Overdue bills move each business's access, up to read-only and back (ADR-0014, 2).
        await access.sync();
      }),
    ];
  }
}

/** What businesses pay HashiNet (ADR-0013): the terms, invoices and payments. */
@Module({
  imports: [IssuesModule],
  controllers: [BillingController],
  providers: [BillingSettings, Invoices, BillPayments, ServiceAccessService, BillingJobs],
  exports: [BillingSettings, Invoices, ServiceAccessService],
})
export class BillingModule {}
