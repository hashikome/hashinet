import type { DeviceList, DeviceResponse } from "@hashinet/types";
import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { DevicesService, deviceQuery, deviceStatusInput } from "./devices.service.js";

@Controller("api/devices")
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @Can("device.read")
  list(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<DeviceList> {
    return this.devices.list(staff, parseInput(deviceQuery, query));
  }

  @Get(":id")
  @Can("device.read")
  async get(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<DeviceResponse> {
    return { device: await this.devices.get(staff, id) };
  }

  @Put(":id/status")
  @Can("device.block")
  async setStatus(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<DeviceResponse> {
    const { status } = parseInput(deviceStatusInput, body);
    return { device: await this.devices.setStatus(staff, id, status) };
  }

  @Delete(":id")
  @Can("device.delete")
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<void> {
    await this.devices.remove(staff, id);
  }
}
