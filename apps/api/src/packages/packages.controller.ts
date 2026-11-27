import type { PackageList, PackageResponse, VenuePackages } from "@hashinet/types";
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { packageInput } from "./package-input.js";
import { PackagesService, venuePackageInput } from "./packages.service.js";

@Controller("api/packages")
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  @Can("package.read")
  async list(@CurrentPrincipal() staff: Principal): Promise<PackageList> {
    return this.packages.list(staff);
  }

  /** Every package, its price and where it is sold, as `packages.csv`. */
  @Get("export.csv")
  @Can("package.read")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="packages.csv"')
  exportCsv(@CurrentPrincipal() staff: Principal): Promise<string> {
    return this.packages.exportCsv(staff);
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

/** What a venue sells: its own prices for the business's packages, and its own packages. */
@Controller("api/venues/:venueId")
export class VenuePackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get("packages")
  @Can("package.read")
  soldAt(
    @CurrentPrincipal() staff: Principal,
    @Param("venueId", idParam()) venueId: string,
  ): Promise<VenuePackages> {
    return this.packages.soldAt(staff, venueId);
  }

  /** The venue's price for a business package, or not selling it there. */
  @Put("packages/:packageId")
  @Can("package.venue.assign")
  set(
    @CurrentPrincipal() staff: Principal,
    @Param("venueId", idParam()) venueId: string,
    @Param("packageId", idParam()) packageId: string,
    @Body() body: unknown,
  ): Promise<VenuePackages> {
    return this.packages.setAtVenue(staff, venueId, packageId, parseInput(venuePackageInput, body));
  }

  @Post("own-packages")
  @Can("package.venue.own")
  createOwn(
    @CurrentPrincipal() staff: Principal,
    @Param("venueId", idParam()) venueId: string,
    @Body() body: unknown,
  ): Promise<VenuePackages> {
    return this.packages.createOwn(staff, venueId, parseInput(packageInput, body));
  }

  @Put("own-packages/:id")
  @Can("package.venue.own")
  updateOwn(
    @CurrentPrincipal() staff: Principal,
    @Param("venueId", idParam()) venueId: string,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<VenuePackages> {
    return this.packages.updateOwn(staff, venueId, id, parseInput(packageInput, body));
  }

  @Delete("own-packages/:id")
  @Can("package.venue.own")
  removeOwn(
    @CurrentPrincipal() staff: Principal,
    @Param("venueId", idParam()) venueId: string,
    @Param("id", idParam()) id: string,
  ): Promise<VenuePackages> {
    return this.packages.removeOwn(staff, venueId, id);
  }
}
