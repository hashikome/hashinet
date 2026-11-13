import { Module } from "@nestjs/common";
import { BrandModule } from "../brand/brand.module.js";
import { OnboardingModule } from "../onboarding/onboarding.module.js";
import { RoutersModule } from "../routers/routers.module.js";
import { VenuesController } from "./venues.controller.js";
import { VenuesService } from "./venues.service.js";

@Module({
  imports: [RoutersModule, BrandModule, OnboardingModule],
  controllers: [VenuesController],
  providers: [VenuesService],
  exports: [VenuesService],
})
export class VenuesModule {}
