import type {
  AcceptedInvitation,
  InvitationList,
  InvitationPreview,
  InvitationRecord,
} from "@hashinet/types";
import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { Can, CurrentPrincipal, Public } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import {
  acceptBusinessInput,
  InvitationsService,
  inviteBusinessInput,
} from "./invitations.service.js";

/** HashiNet's team invites businesses and manages the invitations not yet accepted. */
@Controller("api/invitations")
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get("businesses")
  @Can("business.read")
  async pending(): Promise<InvitationList> {
    return { invitations: await this.invitations.pendingBusinesses() };
  }

  @Post("businesses")
  @Can("business.invite")
  async invite(
    @CurrentPrincipal() staff: Principal,
    @Body() body: unknown,
  ): Promise<{ invitation: InvitationRecord }> {
    const { email } = parseInput(inviteBusinessInput, body);
    return { invitation: await this.invitations.inviteBusiness(staff, email) };
  }

  @Post(":id/resend")
  @HttpCode(200)
  @Can("business.invite")
  async resend(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<{ invitation: InvitationRecord }> {
    return { invitation: await this.invitations.resend(staff, id) };
  }

  @Delete(":id")
  @HttpCode(204)
  @Can("business.invite")
  async revoke(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<void> {
    await this.invitations.revoke(staff, id);
  }
}

const tokenInput = z.object({ token: z.string().min(20).max(100) });

/**
 * The invitation page's routes, before anyone signs in. The token comes in the body, never the
 * URL, so it stays out of logs; an unknown, used, revoked or expired one is simply not found.
 */
@Public()
@Controller("api/invitations/accept")
export class AcceptInvitationController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post("preview")
  @HttpCode(200)
  preview(@Body() body: unknown): Promise<InvitationPreview> {
    return this.invitations.preview(parseInput(tokenInput, body).token);
  }

  @Post("business")
  @HttpCode(201)
  accept(@Body() body: unknown): Promise<AcceptedInvitation> {
    return this.invitations.acceptBusiness(parseInput(acceptBusinessInput, body));
  }
}
