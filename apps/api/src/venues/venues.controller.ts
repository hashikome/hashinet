import type { VenueList, VenueResponse } from "@hashinet/types";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { venueInput } from "./venue-input.js";
import { type VenuesService } from "./venues.service.js";

@Controller("api/venues")
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  @Get()
  @Can("venue.read")
  async list(@CurrentPrincipal() staff: Principal): Promise<VenueList> {
    return { venues: await this.venues.list(staff) };
  }

  @Get(":id")
  @Can("venue.read")
  async get(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<VenueResponse> {
    return { venue: await this.venues.get(staff, id) };
  }

  @Post()
  @Can("venue.create")
  async create(
    @CurrentPrincipal() staff: Principal,
    @Body() body: unknown,
  ): Promise<VenueResponse> {
    return { venue: await this.venues.create(staff, parseInput(venueInput, body)) };
  }

  /** Replaces the venue: the form sends all of it. */
  @Put(":id")
  @Can("venue.update")
  async update(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<VenueResponse> {
    return { venue: await this.venues.update(staff, id, parseInput(venueInput, body)) };
  }

  @Delete(":id")
  @Can("venue.delete")
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<void> {
    await this.venues.remove(staff, id);
  }
}
