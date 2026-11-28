import { Module } from "@nestjs/common";
import { RoutersModule } from "../network/routers/routers.module.js";
import { BillingModule } from "../platform/billing/billing.module.js";
import { VenuesModule } from "../venues/venues.module.js";
import { SitesController } from "./sites.controller.js";
import { SitesService } from "./sites.service.js";

@Module({
  imports: [BillingModule, RoutersModule, VenuesModule],
  controllers: [SitesController],
  providers: [SitesService],
})
export class SitesModule {}
