import type { IssueDetail, IssueList } from "@hashinet/types";
import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { handInput, IssuesService, listQuery, noteInput, takeOverInput } from "./issues.service.js";

/** The reader's workspace's issues, and the steps that move one along. */
@Controller("api/issues")
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Get()
  @Can("issue.read")
  list(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<IssueList> {
    return this.issues.list(staff, parseInput(listQuery, query).status);
  }

  @Get(":id")
  @Can("issue.read")
  detail(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<IssueDetail> {
    return this.issues.detail(staff, id);
  }

  @Post(":id/claim")
  @HttpCode(200)
  @Can("issue.work")
  claim(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<IssueDetail> {
    return this.issues.claim(staff, id);
  }

  @Post(":id/release")
  @HttpCode(200)
  @Can("issue.work")
  release(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<IssueDetail> {
    return this.issues.release(staff, id);
  }

  @Post(":id/hand")
  @HttpCode(200)
  @Can("issue.work")
  hand(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<IssueDetail> {
    return this.issues.hand(staff, id, parseInput(handInput, body));
  }

  @Post(":id/take-over")
  @HttpCode(200)
  @Can("issue.work")
  takeOver(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<IssueDetail> {
    return this.issues.takeOver(staff, id, parseInput(takeOverInput, body));
  }

  @Post(":id/note")
  @HttpCode(200)
  @Can("issue.work")
  note(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<IssueDetail> {
    return this.issues.note(staff, id, parseInput(noteInput, body));
  }
}
