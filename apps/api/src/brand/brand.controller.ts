import type { VenueBrandResponse } from "@hashinet/types";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
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
import { brandInput } from "../portal/portal-input.js";
import { BrandService } from "./brand.service.js";
import type { BrandImageKind } from "./brand-images.js";
import { MAX_UPLOAD_BYTES } from "./brand-images.js";

const tooLarge = () =>
  new HttpException(
    apiError("IMAGE_TOO_LARGE", "That image is too large: 8 MB at most."),
    HttpStatus.PAYLOAD_TOO_LARGE,
  );

function kindOf(value: string): BrandImageKind {
  if (value === "logo" || value === "background") return value;
  throw new NotFoundException(apiError("NOT_FOUND", "There is no such image."));
}

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

@Controller("api/venues/:id/brand")
export class BrandController {
  constructor(private readonly brand: BrandService) {}

  @Get()
  @Can("brand.read")
  get(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<VenueBrandResponse> {
    return this.brand.ofVenue(staff, id);
  }

  @Put()
  @Can("brand.update")
  save(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<VenueBrandResponse> {
    return this.brand.save(staff, id, parseInput(brandInput, body));
  }

  /** Back to the HashiNet default. */
  @Delete()
  @Can("brand.update")
  reset(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<VenueBrandResponse> {
    return this.brand.reset(staff, id);
  }

  @Put("images/:kind")
  @Can("brand.update")
  async putImage(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Param("kind") kind: string,
    @Req() request: Request,
  ): Promise<VenueBrandResponse> {
    const imageKind = kindOf(kind);
    await this.brand.ofVenue(staff, id);
    return this.brand.putImage(staff, id, imageKind, await readUpload(request));
  }

  @Delete("images/:kind")
  @Can("brand.update")
  removeImage(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Param("kind") kind: string,
  ): Promise<VenueBrandResponse> {
    return this.brand.removeImage(staff, id, kindOf(kind));
  }
}
