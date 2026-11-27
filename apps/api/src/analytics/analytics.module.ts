import { Module } from "@nestjs/common";
import { AnalyticsController, PaymentsReceivedController } from "./analytics.controller.js";
import { AnalyticsService } from "./analytics.service.js";
import { AnalyticsReports } from "./reports.js";

@Module({
  controllers: [AnalyticsController, PaymentsReceivedController],
  providers: [AnalyticsService, AnalyticsReports],
})
export class AnalyticsModule {}
