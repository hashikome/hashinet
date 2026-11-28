import { Module } from "@nestjs/common";
import { VenuesModule } from "../venues/venues.module.js";
import { PaymentWaysController, VenuePaymentWayController } from "./payment-ways.controller.js";
import { PaymentWaysService } from "./payment-ways.service.js";

@Module({
  imports: [VenuesModule],
  controllers: [PaymentWaysController, VenuePaymentWayController],
  providers: [PaymentWaysService],
  exports: [PaymentWaysService],
})
export class PaymentWaysModule {}
