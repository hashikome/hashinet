import type { BillingSettingsResponse } from "@hashinet/types";
import { Body, Controller, Get, Put } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { parseInput } from "../http/validation.js";
import { BillingSettings, billingSettingsInput } from "./billing-settings.js";

@Controller("api/billing")
export class BillingController {
  constructor(private readonly settings: BillingSettings) {}

  @Get("settings")
  @Can("fees.read")
  async getSettings(): Promise<BillingSettingsResponse> {
    return { settings: await this.settings.get() };
  }

  /** Replaces them: Fees sends every field. */
  @Put("settings")
  @Can("fees.update")
  async saveSettings(
    @CurrentPrincipal() staff: Principal,
    @Body() body: unknown,
  ): Promise<BillingSettingsResponse> {
    return { settings: await this.settings.save(staff, parseInput(billingSettingsInput, body)) };
  }
}
