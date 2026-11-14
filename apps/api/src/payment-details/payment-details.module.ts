import { Module } from "@nestjs/common";
import { VenuesModule } from "../venues/venues.module.js";
import { PaymentDetailsController } from "./payment-details.controller.js";
import { PaymentDetailsService } from "./payment-details.service.js";

@Module({
  imports: [VenuesModule],
  controllers: [PaymentDetailsController],
  providers: [PaymentDetailsService],
})
export class PaymentDetailsModule {}
