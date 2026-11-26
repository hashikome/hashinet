import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module.js";
import { BusinessesController } from "./businesses.controller.js";

@Module({ imports: [BillingModule], controllers: [BusinessesController] })
export class BusinessesModule {}
