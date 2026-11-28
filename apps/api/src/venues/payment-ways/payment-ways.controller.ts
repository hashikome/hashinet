import type { PaymentWayList, VenuePaymentWay } from "@hashinet/types";
import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../../core/access/access.guard.js";
import type { Principal } from "../../core/access/principal.js";
import { idParam } from "../../core/http/id-param.js";
import { parseInput } from "../../core/http/validation.js";
import {
  PaymentWaysService,
  paymentWayInput,
  venuePaymentWayInput,
} from "./payment-ways.service.js";

/** A business's ways to pay (ADR-0017, 4), in Settings › Payments. */
@Controller("api/payment-ways")
export class PaymentWaysController {
  constructor(private readonly ways: PaymentWaysService) {}

  @Get()
  @Can("payment_way.read")
  list(@CurrentPrincipal() staff: Principal): Promise<PaymentWayList> {
    return this.ways.list(staff);
  }

  @Post()
  @Can("payment_way.manage")
  create(@CurrentPrincipal() staff: Principal, @Body() body: unknown): Promise<PaymentWayList> {
    return this.ways.create(staff, parseInput(paymentWayInput, body));
  }

  @Put(":id")
  @Can("payment_way.manage")
  update(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<PaymentWayList> {
    return this.ways.update(staff, id, parseInput(paymentWayInput, body));
  }

  @Delete(":id")
  @Can("payment_way.manage")
  remove(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<PaymentWayList> {
    return this.ways.remove(staff, id);
  }
}

/** The way whoever sells at a venue reads out: read by them, chosen by its managers. */
@Controller("api/venues/:id/payment-way")
export class VenuePaymentWayController {
  constructor(private readonly ways: PaymentWaysService) {}

  @Get()
  @Can("venue.payment_way.read")
  get(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<VenuePaymentWay> {
    return this.ways.atVenue(staff, id);
  }

  @Put()
  @Can("venue.payment_way.choose")
  choose(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<VenuePaymentWay> {
    return this.ways.choose(staff, id, parseInput(venuePaymentWayInput, body));
  }
}
