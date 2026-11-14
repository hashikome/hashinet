import type { VenuePaymentDetails } from "@hashinet/types";
import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { PaymentDetailsService, paymentDetailsInput } from "./payment-details.service.js";

/** A venue's payment details (ADR-0017, 4): read by whoever sells there, kept by its managers. */
@Controller("api/venues/:id/payment-details")
export class PaymentDetailsController {
  constructor(private readonly details: PaymentDetailsService) {}

  @Get()
  @Can("payment_details.read")
  get(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<VenuePaymentDetails> {
    return this.details.get(staff, id);
  }

  @Put()
  @Can("payment_details.update")
  update(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
    @Body() body: unknown,
  ): Promise<VenuePaymentDetails> {
    return this.details.update(staff, id, parseInput(paymentDetailsInput, body));
  }
}
