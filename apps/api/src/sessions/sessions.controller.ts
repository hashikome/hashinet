import type { SessionList, SessionResponse } from "@hashinet/types";
import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { SessionsService, sessionQuery } from "./sessions.service.js";

@Controller("api/sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @Can("session.read")
  list(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<SessionList> {
    return this.sessions.list(staff, parseInput(sessionQuery, query));
  }

  @Get(":id")
  @Can("session.read")
  async get(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<SessionResponse> {
    return { session: await this.sessions.get(staff, id) };
  }

  /** Managers end sessions at their venues; admins anywhere. */
  @Post(":id/terminate")
  @Can("session.terminate")
  @HttpCode(200)
  async terminate(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<SessionResponse> {
    return { session: await this.sessions.terminate(staff, id) };
  }
}
