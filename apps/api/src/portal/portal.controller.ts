import type { PlatformPortal } from "@hashinet/types";
import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../core/access/access.guard.js";
import type { Principal } from "../core/access/principal.js";
import { idParam } from "../core/http/id-param.js";
import { parseInput } from "../core/http/validation.js";
import { PortalService } from "./portal.service.js";
import { contentInput, themeInput } from "./portal-input.js";

/** What a new business's portal starts with, and the themes every business picks from. */
@Controller("api/portal")
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  @Can("portal.defaults.read")
  get(): Promise<PlatformPortal> {
    return this.portal.get();
  }

  /** Replaces the content: the form sends all of it. */
  @Put()
  @Can("portal.defaults.update")
  save(@CurrentPrincipal() staff: Principal, @Body() body: unknown): Promise<PlatformPortal> {
    return this.portal.save(staff, parseInput(contentInput, body));
  }

  /** Back to HashiNet's own. */
  @Delete()
  @Can("portal.defaults.update")
  restore(@CurrentPrincipal() staff: Principal): Promise<PlatformPortal> {
    return this.portal.restore(staff);
  }

  @Post("themes")
  @Can("portal.defaults.update")
  addTheme(@CurrentPrincipal() staff: Principal, @Body() body: unknown): Promise<PlatformPortal> {
    return this.portal.addTheme(staff, parseInput(themeInput, body));
  }

  @Put("themes/:id/default")
  @Can("portal.defaults.update")
  makeDefault(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<PlatformPortal> {
    return this.portal.makeDefault(staff, id);
  }

  @Delete("themes/:id")
  @Can("portal.defaults.update")
  removeTheme(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<PlatformPortal> {
    return this.portal.removeTheme(staff, id);
  }
}
