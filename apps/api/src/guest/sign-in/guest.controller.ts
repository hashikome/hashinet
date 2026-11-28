import type { GuestContext, GuestSession, RedeemResult } from "@hashinet/types";
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../../core/access/access.guard.js";
import type { AppConfig } from "../../core/config/config.js";
import { APP_CONFIG } from "../../core/config/config.module.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { idParam } from "../../core/http/id-param.js";
import { parseInput } from "../../core/http/validation.js";
import { resolveBackendEndpoints } from "../../network/provisioning/context.js";
import {
  PORTAL_FILES,
  type PortalFileName,
  renderPortalFile,
} from "../../network/provisioning/portal-files.js";
import { backendSettings } from "../../network/routers/backend-settings.js";
import { GuestService } from "./guest.service.js";
import { contextInput, redeemInput, sessionInput } from "./guest-input.js";

/** The routes a guest's browser calls before it is online. All public; see `GuestService`. */
@Public()
@Controller("api/guest")
export class GuestController {
  constructor(private readonly guest: GuestService) {}

  @Post("context")
  @HttpCode(200)
  context(@Body() body: unknown): Promise<GuestContext> {
    return this.guest.context(parseInput(contextInput, body));
  }

  @Post("redeem")
  @HttpCode(200)
  // Its answer carries the switch PIN, a credential: no cache keeps it.
  @Header("Cache-Control", "no-store")
  redeem(@Body() body: unknown, @Req() request: Request): Promise<RedeemResult> {
    return this.guest.redeem(parseInput(redeemInput, body), request.ip ?? null);
  }

  /** Called by the router's own pages, on the router's origin; it carries no credentials. */
  @Post("session")
  @HttpCode(200)
  @Header("Access-Control-Allow-Origin", "*")
  session(@Body() body: unknown): Promise<GuestSession> {
    return this.guest.session(parseInput(sessionInput, body));
  }
}

/** Brand images. On this path because it is the one a phone can reach before it is online. */
@Public()
@Controller("api/guest/brand")
export class GuestBrandController {
  constructor(private readonly guest: GuestService) {}

  /** A venue's or a business's logo, by its owner's id. */
  @Get(":ownerId/:file")
  async image(
    @Param("ownerId", idParam()) ownerId: string,
    @Param("file") file: string,
    @Res() response: Response,
  ): Promise<void> {
    const bytes = await this.guest.image(ownerId, file);
    if (bytes === null)
      throw new NotFoundException(apiError("NOT_FOUND", "There is no such image."));
    response
      .set({
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      })
      .end(Buffer.from(bytes));
  }
}

/** The pages a router pulls while it is provisioned, before any session exists. */
@Public()
@Controller("portal/hotspot-files")
export class HotspotFilesController {
  constructor(
    private readonly db: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get(":routerId/:name")
  async file(
    @Param("routerId", idParam()) routerId: string,
    @Param("name") name: string,
    @Res() response: Response,
  ): Promise<void> {
    const router = await this.db.router.findUnique({ where: { id: routerId } });
    if (!router || !(PORTAL_FILES as readonly string[]).includes(name)) {
      throw new NotFoundException(apiError("NOT_FOUND", "Not found."));
    }
    const { portal } = resolveBackendEndpoints(router.ipAddress, backendSettings(this.config));
    const page = await renderPortalFile(name as PortalFileName, portal.origin, routerId);
    // Not text/html: the file reaches the router through Cloudflare, which adds its bot-detection
    // script to HTML, and the router's file must match this render byte for byte.
    response
      .type("application/octet-stream")
      .set("Cache-Control", "no-store, no-transform")
      .send(Buffer.from(page, "utf8"));
  }
}
