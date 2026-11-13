import type { InvitationRecord, TeamList } from "@hashinet/types";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { changeRoleInput, inviteMemberInput, TeamService } from "./team.service.js";

/** HashiNet's team: its people and pending invitations, managed by rank. */
@Controller("api/team")
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @Can("team.read")
  list(@CurrentPrincipal() staff: Principal): Promise<TeamList> {
    return this.team.list(staff);
  }

  @Post("invitations")
  @Can("team.manage")
  async invite(
    @CurrentPrincipal() staff: Principal,
    @Body() body: unknown,
  ): Promise<{ invitation: InvitationRecord }> {
    return { invitation: await this.team.invite(staff, parseInput(inviteMemberInput, body)) };
  }

  @Post("invitations/:id/resend")
  @HttpCode(200)
  @Can("team.manage")
  async resend(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<{ invitation: InvitationRecord }> {
    return { invitation: await this.team.resend(staff, id) };
  }

  @Delete("invitations/:id")
  @HttpCode(204)
  @Can("team.manage")
  async revoke(@CurrentPrincipal() staff: Principal, @Param("id", idParam()) id: string) {
    await this.team.revoke(staff, id);
  }

  @Put(":membershipId")
  @HttpCode(204)
  @Can("team.manage")
  async changeRole(
    @CurrentPrincipal() staff: Principal,
    @Param("membershipId", idParam()) membershipId: string,
    @Body() body: unknown,
  ) {
    await this.team.changeRole(staff, membershipId, parseInput(changeRoleInput, body).role);
  }

  @Delete(":membershipId")
  @HttpCode(204)
  @Can("team.manage")
  async remove(
    @CurrentPrincipal() staff: Principal,
    @Param("membershipId", idParam()) membershipId: string,
  ) {
    await this.team.remove(staff, membershipId);
  }
}
