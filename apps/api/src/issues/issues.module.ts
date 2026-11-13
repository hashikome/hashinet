import {
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IntervalJob } from "../jobs/interval-job.js";
import { IssuesController } from "./issues.controller.js";
import { IssuesService } from "./issues.service.js";

const MINUTE = 60_000;

/** Keeps router issues in step with the routers while the application is up. */
@Injectable()
class IssueJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly job: IntervalJob;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    issues: IssuesService,
  ) {
    this.job = new IntervalJob("issues.routers", MINUTE, () => issues.syncRouterIssues());
  }

  onApplicationBootstrap(): void {
    if (this.config.jobsEnabled) this.job.start(true);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.job.stop();
  }
}

/** Issues (ADR-0011, 11): everything that needs someone, per workspace. */
@Module({
  controllers: [IssuesController],
  providers: [IssuesService, IssueJobs],
  exports: [IssuesService],
})
export class IssuesModule {}
