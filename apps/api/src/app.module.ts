import { type DynamicModule, Module } from "@nestjs/common";
import { AnalyticsModule } from "./analytics/analytics.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { BrandModule } from "./brand/brand.module.js";
import { BusinessesModule } from "./businesses/businesses.module.js";
import type { AppConfig } from "./config/config.js";
import { configModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import type { EmailSender } from "./email/email-sender.js";
import { GuestModule } from "./guest/guest.module.js";
import { HealthController } from "./health/health.controller.js";
import { InvitationsModule } from "./invitations/invitations.module.js";
import { PackagesModule } from "./packages/packages.module.js";
import { PaymentsModule } from "./payments/payments.module.js";
import { PortalModule } from "./portal/portal.module.js";
import { RoutersModule } from "./routers/routers.module.js";
import { SessionsModule } from "./sessions/sessions.module.js";
import { VenuesModule } from "./venues/venues.module.js";
import { VouchersModule } from "./vouchers/vouchers.module.js";

@Module({})
export class AppModule {}

export function appModule(config: AppConfig, email: EmailSender | null): DynamicModule {
  return {
    module: AppModule,
    imports: [
      configModule(config, email),
      DatabaseModule,
      AuditModule,
      AuthModule,
      InvitationsModule,
      BusinessesModule,
      RoutersModule,
      VenuesModule,
      PackagesModule,
      VouchersModule,
      SessionsModule,
      AnalyticsModule,
      PortalModule,
      BrandModule,
      GuestModule,
      PaymentsModule,
    ],
    controllers: [HealthController],
  };
}
