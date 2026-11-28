import { Inject, Injectable, Module } from "@nestjs/common";
import type { AppConfig } from "../../core/config/config.js";
import { APP_CONFIG } from "../../core/config/config.module.js";
import { IntervalJob, ScheduledJobs } from "../../core/jobs/interval-job.js";
import { IssuesController } from "./issues.controller.js";
import { IssuesService } from "./issues.service.js";
import { RouterIssues } from "./router-issues.js";

const MINUTE = 60_000;

/** Keeps router issues in step with the routers. */
@Injectable()
class IssueJobs extends ScheduledJobs {
  protected readonly jobs: IntervalJob[];

  constructor(@Inject(APP_CONFIG) config: AppConfig, routerIssues: RouterIssues) {
    super(config.jobsEnabled);
    this.jobs = [new IntervalJob("issues.routers", MINUTE, () => routerIssues.syncRouterIssues())];
  }
}

/** Issues (ADR-0011, 11): everything that needs someone, per workspace. */
@Module({
  controllers: [IssuesController],
  providers: [IssuesService, RouterIssues, IssueJobs],
  exports: [IssuesService, RouterIssues],
})
export class IssuesModule {}
