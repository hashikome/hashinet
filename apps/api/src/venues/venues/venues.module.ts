import { Module } from "@nestjs/common";
import { BrandModule } from "../../guest/brand/brand.module.js";
import { RoutersModule } from "../../network/routers/routers.module.js";
import { OnboardingModule } from "../../platform/onboarding/onboarding.module.js";
import { VenuesController } from "./venues.controller.js";
import { VenuesService } from "./venues.service.js";

@Module({
  imports: [RoutersModule, BrandModule, OnboardingModule],
  controllers: [VenuesController],
  providers: [VenuesService],
  exports: [VenuesService],
})
export class VenuesModule {}
