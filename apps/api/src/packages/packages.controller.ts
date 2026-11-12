import type { PackageList, PackageResponse, VenuePackages } from "@hashinet/types";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { packageInput } from "./package-input.js";
import { PackagesService } from "./packages.service.js";

@Controller("api/packages")
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  @Can("package.read")
  async list(@CurrentPrincipal() staff: Principal): Promise<PackageList> {
    return { packages: await this.packages.list(staff) };
  }

  @Get(":id")
  @Can("package.read")
  async get(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<PackageResponse> {
    return { package: await this.packages.get(staff, id) };
  }

  @Post()
  @Can("package.manage")
  async create(
    @CurrentPrincipal() staff: Principal,
    @Body() body: unknown,
  ): Promise<PackageResponse> {
    return { package: await this.packages.create(staff, parseInput(packageInput, body)) };
  }

  /** Replaces the package: the form sends all of it. */
  @Put(":id")
  @Can("package.manage")
  async update(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<PackageResponse> {
    return {
      package: await this.packages.update(staff, id, parseInput(packageInput, body)),
    };
  }

  @Delete(":id")
  @Can("package.manage")
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<void> {
    await this.packages.remove(staff, id);
  }
}

/** What a venue sells, and admins' assignments of packages to it. */
@Controller("api/venues/:venueId/packages")
export class VenuePackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  @Can("package.read")
  soldAt(
    @CurrentPrincipal() staff: Principal,
    @Param("venueId", idParam()) venueId: string,
  ): Promise<VenuePackages> {
    return this.packages.soldAt(staff, venueId);
  }

  @Put(":packageId")
  @Can("package.venue.assign")
  assign(
    @CurrentPrincipal() staff: Principal,
    @Param("venueId", idParam()) venueId: string,
    @Param("packageId", idParam()) packageId: string,
  ): Promise<VenuePackages> {
    return this.packages.assign(staff, venueId, packageId);
  }

  @Delete(":packageId")
  @Can("package.venue.assign")
  unassign(
    @CurrentPrincipal() staff: Principal,
    @Param("venueId", idParam()) venueId: string,
    @Param("packageId", idParam()) packageId: string,
  ): Promise<VenuePackages> {
    return this.packages.unassign(staff, venueId, packageId);
  }
}
