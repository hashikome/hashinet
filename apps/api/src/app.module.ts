import { type DynamicModule, Module } from "@nestjs/common";
import { AnalyticsModule } from "./analytics/analytics.module.js";
import { BrandModule } from "./brand/brand.module.js";
import { AuditModule } from "./core/audit/audit.module.js";
import type { AppConfig } from "./core/config/config.js";
import { configModule } from "./core/config/config.module.js";
import { DatabaseModule } from "./core/database/database.module.js";
import type { EmailSender } from "./core/email/email-sender.js";
import { HealthController } from "./core/health/health.controller.js";
import { GuestModule } from "./guest/guest.module.js";
import { RadiusModule } from "./network/radius/radius.module.js";
import { RoutersModule } from "./network/routers/routers.module.js";
import { PackagesModule } from "./packages/packages.module.js";
import { PaymentWaysModule } from "./payment-ways/payment-ways.module.js";
import { PaymentsModule } from "./payments/payments.module.js";
import { AuthModule } from "./people/auth/auth.module.js";
import { InvitationsModule } from "./people/invitations/invitations.module.js";
import { TeamModule } from "./people/team/team.module.js";
import { BillingModule } from "./platform/billing/billing.module.js";
import { BusinessesModule } from "./platform/businesses/businesses.module.js";
import { IssuesModule } from "./platform/issues/issues.module.js";
import { OnboardingModule } from "./platform/onboarding/onboarding.module.js";
import { PortalModule } from "./portal/portal.module.js";
import { SessionsModule } from "./sessions/sessions.module.js";
import { SitesModule } from "./sites/sites.module.js";
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
      IssuesModule,
      OnboardingModule,
      TeamModule,
      RoutersModule,
      RadiusModule,
      VenuesModule,
      PackagesModule,
      VouchersModule,
      SessionsModule,
      AnalyticsModule,
      PortalModule,
      BillingModule,
      BrandModule,
      GuestModule,
      PaymentWaysModule,
      SitesModule,
      PaymentsModule,
    ],
    controllers: [HealthController],
  };
}
