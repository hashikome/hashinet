import type { VenueOnboarding } from "@hashinet/types";
import { Body, Controller, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import {
  confirmInput,
  OnboardingService,
  paymentInput,
  preferInput,
  scheduleInput,
} from "./onboarding.service.js";

/** A venue's way to serving guests, and the steps that move it along. */
@Controller("api/venues/:id/onboarding")
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @Can("onboarding.read")
  get(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<VenueOnboarding> {
    return this.onboarding.get(staff, id);
  }

  @Put("preference")
  @Can("onboarding.prefer")
  prefer(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<VenueOnboarding> {
    return this.onboarding.prefer(staff, id, parseInput(preferInput, body).plan);
  }

  @Post("confirm")
  @HttpCode(200)
  @Can("onboarding.manage")
  confirm(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<VenueOnboarding> {
    return this.onboarding.confirm(staff, id, parseInput(confirmInput, body));
  }

  @Post("payment")
  @HttpCode(200)
  @Can("onboarding.manage")
  recordPayment(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<VenueOnboarding> {
    return this.onboarding.recordPayment(staff, id, parseInput(paymentInput, body));
  }

  @Post("schedule")
  @HttpCode(200)
  @Can("onboarding.manage")
  schedule(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<VenueOnboarding> {
    return this.onboarding.schedule(staff, id, parseInput(scheduleInput, body));
  }
}
