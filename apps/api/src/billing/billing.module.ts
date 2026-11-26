import { Inject, Injectable, Module } from "@nestjs/common";
import { businessDayOf } from "../analytics/business-day.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IntervalJob, ScheduledJobs } from "../jobs/interval-job.js";
import { BillingController } from "./billing.controller.js";
import { BillingSettings } from "./billing-settings.js";
import { BILLING_STARTS, Invoices } from "./invoices.js";

const HOUR = 60 * 60 * 1000;

/** The month before the one `today` falls in, as its first day. */
export function monthBefore(today: string): string {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

/**
 * Every hour: last month's invoices, issued once each, so the 1st's are out within the hour and a
 * run the API missed while down is made up; and any onboarding invoice a crash left unissued.
 */
@Injectable()
export class BillingJobs extends ScheduledJobs {
  protected readonly jobs: IntervalJob[];

  constructor(@Inject(APP_CONFIG) config: AppConfig, invoices: Invoices) {
    super(config.jobsEnabled);
    this.jobs = [
      new IntervalJob("billing.invoices", HOUR, async () => {
        const period = monthBefore(businessDayOf(new Date()));
        if (period >= BILLING_STARTS) await invoices.issueMonth(period);
        await invoices.issueMissingOnboarding();
      }),
    ];
  }
}

/** What businesses pay HashiNet (ADR-0013): the terms, invoices and payments. */
@Module({
  controllers: [BillingController],
  providers: [BillingSettings, Invoices, BillingJobs],
  exports: [BillingSettings, Invoices],
})
export class BillingModule {}
