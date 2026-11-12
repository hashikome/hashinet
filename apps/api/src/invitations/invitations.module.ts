import { Module } from "@nestjs/common";
import { AcceptInvitationController, InvitationsController } from "./invitations.controller.js";
import { InvitationsService } from "./invitations.service.js";

/** Invitations: the only way in (ADR-0011). */
@Module({
  controllers: [InvitationsController, AcceptInvitationController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
