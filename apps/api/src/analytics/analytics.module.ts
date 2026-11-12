import { Module } from "@nestjs/common";
import {
  AnalyticsController,
  PaymentsReceivedController,
  RevenueController,
} from "./analytics.controller.js";
import { AnalyticsService } from "./analytics.service.js";

@Module({
  controllers: [AnalyticsController, RevenueController, PaymentsReceivedController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
