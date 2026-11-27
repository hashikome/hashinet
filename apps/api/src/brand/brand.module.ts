import { Inject, Injectable, Module } from "@nestjs/common";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IntervalJob, ScheduledJobs } from "../jobs/interval-job.js";
import { PortalModule } from "../portal/portal.module.js";
import { RoutersModule } from "../routers/routers.module.js";
import { BusinessPortalController, VenuePortalController } from "./brand.controller.js";
import { BrandService } from "./brand.service.js";

const DAY = 24 * 60 * 60_000;

/** Sweeps the brand store of files nothing references, on start and once a day. */
@Injectable()
class BrandJobs extends ScheduledJobs {
  protected readonly jobs: IntervalJob[];

  constructor(@Inject(APP_CONFIG) config: AppConfig, brand: BrandService) {
    super(config.jobsEnabled);
    this.jobs = [
      new IntervalJob("brand.sweep", DAY, async () => {
        await brand.sweep();
      }),
    ];
  }
}

@Module({
  imports: [RoutersModule, PortalModule],
  controllers: [BusinessPortalController, VenuePortalController],
  providers: [BrandService, BrandJobs],
  exports: [BrandService],
})
export class BrandModule {}
