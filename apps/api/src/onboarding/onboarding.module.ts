import {
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IssuesModule } from "../issues/issues.module.js";
import { IntervalJob } from "../jobs/interval-job.js";
import { OnboardingController } from "./onboarding.controller.js";
import { OnboardingService } from "./onboarding.service.js";

const MINUTE = 60_000;

/** Closes venues' setups as their first guests get online, while the application is up. */
@Injectable()
class OnboardingJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly job: IntervalJob;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    onboarding: OnboardingService,
  ) {
    this.job = new IntervalJob("onboarding.setups", MINUTE, () => onboarding.syncSetups());
  }

  onApplicationBootstrap(): void {
    if (this.config.jobsEnabled) this.job.start(true);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.job.stop();
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
