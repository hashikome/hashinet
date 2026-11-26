import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller.js";
import { BillingSettings } from "./billing-settings.js";

/** What businesses pay HashiNet (ADR-0013): the terms, invoices and payments. */
@Module({
  controllers: [BillingController],
  providers: [BillingSettings],
  exports: [BillingSettings],
})
export class BillingModule {}
