import type { PortalSettingsResponse } from "@hashinet/types";
import { Body, Controller, Get, Put } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { parseInput } from "../http/validation.js";
import { PortalService } from "./portal.service.js";
import { portalInput } from "./portal-input.js";

@Controller("api/portal")
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  @Can("portal.defaults.read")
  async get(): Promise<PortalSettingsResponse> {
    return { settings: await this.portal.get() };
  }

  /** Replaces the settings: the portal page's form sends all of them. */
  @Put()
  @Can("portal.defaults.update")
  async save(
    @CurrentPrincipal() staff: Principal,
    @Body() body: unknown,
  ): Promise<PortalSettingsResponse> {
    return { settings: await this.portal.save(staff, parseInput(portalInput, body)) };
  }
}
