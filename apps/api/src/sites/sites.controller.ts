import type { VenueSites } from "@hashinet/types";
import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { SitesService, siteInput } from "./sites.service.js";

/** A venue's sites open before paying (slice 5): read by whoever works there, kept by its managers. */
@Controller("api/venues/:id/sites")
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  @Can("venue.read")
  list(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<VenueSites> {
    return this.sites.list(staff, id);
  }

  @Post()
  @Can("venue.site.manage")
  add(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<VenueSites> {
    return this.sites.add(staff, id, parseInput(siteInput, body));
  }

  @Delete(":siteId")
  @Can("venue.site.manage")
  remove(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Param("siteId", idParam()) siteId: string,
  ): Promise<VenueSites> {
    return this.sites.remove(staff, id, siteId);
  }
}
