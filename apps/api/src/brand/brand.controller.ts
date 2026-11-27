import type { PortalEditor } from "@hashinet/types";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Put,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { apiError } from "../http/error-envelope.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { lookInput } from "../portal/portal-input.js";
import { BrandService } from "./brand.service.js";
import { MAX_UPLOAD_BYTES } from "./brand-images.js";

const tooLarge = () =>
  new HttpException(
    apiError("IMAGE_TOO_LARGE", "That image is too large: 8 MB at most."),
    HttpStatus.PAYLOAD_TOO_LARGE,
  );

/** The image is the request's body. Stops reading at the limit, so a large one costs nothing. */
async function readUpload(request: Request): Promise<Uint8Array> {
  if (Number(request.headers["content-length"] ?? 0) > MAX_UPLOAD_BYTES) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > MAX_UPLOAD_BYTES) throw tooLarge();
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

/** What a business's new venues start with: whoever reaches the whole business changes it. */
@Controller("api/portal/business")
export class BusinessPortalController {
  constructor(private readonly brand: BrandService) {}

  @Get()
  @Can("portal.business.update")
  get(@CurrentPrincipal() staff: Principal): Promise<PortalEditor> {
    return this.brand.ofBusiness(staff);
  }

  /** Replaces the template: the form sends all of it. */
  @Put()
  @Can("portal.business.update")
  save(@CurrentPrincipal() staff: Principal, @Body() body: unknown): Promise<PortalEditor> {
    return this.brand.saveBusiness(staff, parseInput(lookInput, body));
  }

  /** Back to what the platform's new businesses start with. */
  @Delete()
  @Can("portal.business.update")
  restore(@CurrentPrincipal() staff: Principal): Promise<PortalEditor> {
    return this.brand.restoreBusiness(staff);
  }
}

/** A venue's own portal and logo: its owner and managers change them. */
@Controller("api/venues/:id/portal")
export class VenuePortalController {
  constructor(private readonly brand: BrandService) {}

  @Get()
  @Can("brand.read")
  get(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<PortalEditor> {
    return this.brand.ofVenue(staff, id);
  }

  /** Replaces the venue's portal: the form sends all of it. */
  @Put()
  @Can("brand.update")
  save(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<PortalEditor> {
    return this.brand.saveVenue(staff, id, parseInput(lookInput, body));
  }

  /** Back to what the business's new venues start with. */
  @Delete()
  @Can("brand.update")
  restore(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<PortalEditor> {
    return this.brand.restoreVenue(staff, id);
  }

  @Put("logo")
  @Can("brand.update")
  async putLogo(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Req() request: Request,
  ): Promise<PortalEditor> {
    // Scope first: an upload to a venue out of reach is refused before it is read.
    await this.brand.ofVenue(staff, id);
    return this.brand.putLogo(staff, id, await readUpload(request));
  }

  @Delete("logo")
  @Can("brand.update")
  removeLogo(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<PortalEditor> {
    return this.brand.removeLogo(staff, id);
  }
}
