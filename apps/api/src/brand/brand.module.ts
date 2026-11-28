import { Inject, Injectable, Module } from "@nestjs/common";
import type { AppConfig } from "../core/config/config.js";
import { APP_CONFIG } from "../core/config/config.module.js";
import { IntervalJob, ScheduledJobs } from "../core/jobs/interval-job.js";
import { PortalModule } from "../portal/portal.module.js";
import { RoutersModule } from "../routers/routers.module.js";
import { BusinessPortalController, VenuePortalController } from "./brand.controller.js";
import { BrandService } from "./brand.service.js";
import { BusinessProfileController, BusinessProfiles } from "./business-profile.js";
import { Logos } from "./logos.js";

const DAY = 24 * 60 * 60_000;

/** Sweeps the brand store of files nothing references, on start and once a day. */
@Injectable()
class BrandJobs extends ScheduledJobs {
  protected readonly jobs: IntervalJob[];

  constructor(@Inject(APP_CONFIG) config: AppConfig, logos: Logos) {
    super(config.jobsEnabled);
    this.jobs = [
      new IntervalJob("brand.sweep", DAY, async () => {
        await logos.sweep();
      }),
    ];
  }
}

@Module({
  imports: [RoutersModule, PortalModule],
  controllers: [BusinessPortalController, VenuePortalController, BusinessProfileController],
  providers: [BrandService, Logos, BusinessProfiles, BrandJobs],
  exports: [BrandService, Logos],
})
export class BrandModule {}
