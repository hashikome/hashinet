import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module.js";
import { RoutersModule } from "../routers/routers.module.js";
import { VenuesModule } from "../venues/venues.module.js";
import { SitesController } from "./sites.controller.js";
import { SitesService } from "./sites.service.js";

@Module({
  imports: [BillingModule, RoutersModule, VenuesModule],
  controllers: [SitesController],
  providers: [SitesService],
})
export class SitesModule {}
