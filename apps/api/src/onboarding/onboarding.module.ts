import { Inject, Injectable, Module } from "@nestjs/common";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IssuesModule } from "../issues/issues.module.js";
import { IntervalJob, ScheduledJobs } from "../jobs/interval-job.js";
import { OnboardingController } from "./onboarding.controller.js";
import { OnboardingService } from "./onboarding.service.js";

const MINUTE = 60_000;

/** Closes venues' setups as their first guests get online. */
@Injectable()
class OnboardingJobs extends ScheduledJobs {
  protected readonly jobs: IntervalJob[];

  constructor(@Inject(APP_CONFIG) config: AppConfig, onboarding: OnboardingService) {
    super(config.jobsEnabled);
    this.jobs = [new IntervalJob("onboarding.setups", MINUTE, () => onboarding.syncSetups())];
  }
}

/** A venue's way to serving guests (ADR-0013, 2). */
@Module({
  imports: [IssuesModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingJobs],
  exports: [OnboardingService],
})
export class OnboardingModule {}
