import { Module } from "@nestjs/common";
import { OnboardingModule } from "../onboarding/onboarding.module.js";
import { BusinessesController } from "./businesses.controller.js";

@Module({ imports: [OnboardingModule], controllers: [BusinessesController] })
export class BusinessesModule {}
