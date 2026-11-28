import { Module } from "@nestjs/common";
import { BillingModule } from "../../platform/billing/billing.module.js";
import { OnboardingModule } from "../../platform/onboarding/onboarding.module.js";
import { AcceptInvitationController, InvitationsController } from "./invitations.controller.js";
import { InvitationsService } from "./invitations.service.js";

/** Invitations: the only way in (ADR-0011). */
@Module({
  imports: [OnboardingModule, BillingModule],
  controllers: [InvitationsController, AcceptInvitationController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
