import type {
  BootstrapScriptResponse,
  ProvisioningBacklog,
  RouterList,
  RouterResponse,
} from "@hashinet/types";
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { bootstrapInput, routerInput, testConnectionInput } from "./router-input.js";
import { RoutersService } from "./routers.service.js";

const listQuery = z.object({ venueId: z.uuid().nullable().default(null) });
const flag = z.enum(["1", "true", "0", "false"]).transform((v) => v === "1" || v === "true");
/** A query flag; absent means off. */
const flagOf = (value: unknown) => parseInput(flag, value ?? "0");

@Controller("api/routers")
export class RoutersController {
  constructor(private readonly routers: RoutersService) {}

  @Get()
  @Can("router.read")
  async list(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<RouterList> {
    const { venueId } = parseInput(listQuery, query);
    return { routers: await this.routers.list(staff, venueId) };
  }

  /** Guests waiting on a router in the caller's venues. */
  @Get("provisioning-backlog")
  @Can("router.check")
  backlog(@CurrentPrincipal() staff: Principal): Promise<ProvisioningBacklog> {
    return this.routers.backlog(staff);
  }

  @Post("test-connection")
  @Can("router.check")
  @HttpCode(200)
  testConnection(@Body() body: unknown) {
    return this.routers.testConnection(parseInput(testConnectionInput, body));
  }

  @Get(":id")
  @Can("router.read")
  async get(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<RouterResponse> {
    return { router: await this.routers.get(staff, id) };
  }

  @Post()
  @Can("router.manage")
  async create(
    @CurrentPrincipal() staff: Principal,
    @Body() body: unknown,
  ): Promise<RouterResponse> {
    return { router: await this.routers.create(staff, parseInput(routerInput, body)) };
  }

  @Put(":id")
  @Can("router.manage")
  async update(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<RouterResponse> {
    return {
      router: await this.routers.update(staff, id, parseInput(routerInput, body)),
    };
  }

  @Delete(":id")
  @Can("router.manage")
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<void> {
    await this.routers.remove(staff, id);
  }

  @Post(":id/sync")
  @Can("router.manage")
  @HttpCode(200)
  async sync(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<RouterResponse> {
    return { router: await this.routers.syncNow(staff, id) };
  }

  /** Carries the router's API password, so no cache may keep it. */
  @Post(":id/bootstrap-script")
  @Can("router.manage")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  bootstrapScript(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<BootstrapScriptResponse> {
    return this.routers.bootstrapScript(staff, id, parseInput(bootstrapInput, body));
  }

  @Post(":id/probe")
  @Can("router.check")
  @HttpCode(200)
  probe(@CurrentPrincipal() staff: Principal, @Param("id", idParam()) id: string) {
    return this.routers.probe(staff, id);
  }

  @Post(":id/verify")
  @Can("router.check")
  @HttpCode(200)
  verify(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Query("skipWriteTest") skipWriteTest: unknown,
  ) {
    return this.routers.verify(staff, id, !flagOf(skipWriteTest));
  }

  @Post(":id/setup")
  @Can("router.manage")
  @HttpCode(202)
  setup(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Query("force") force: unknown,
  ) {
    return this.routers.startSetup(staff, id, flagOf(force));
  }

  @Get(":id/journey")
  @Can("router.read")
  journey(@CurrentPrincipal() staff: Principal, @Param("id", idParam()) id: string) {
    return this.routers.journey(staff, id);
  }

  @Post(":id/provision")
  @Can("router.manage")
  @HttpCode(200)
  provision(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Query("dryRun") dryRun: unknown,
  ) {
    return this.routers.provision(staff, id, flagOf(dryRun));
  }

  @Get(":id/provision/latest")
  @Can("router.read")
  latestProvision(@CurrentPrincipal() staff: Principal, @Param("id", idParam()) id: string) {
    return this.routers.latestProvision(staff, id);
  }
}
