import type {
  Capabilities,
  CustomerList,
  GuestPaymentStarted,
  GuestPaymentStatus,
  PaymentList,
  SaleResult,
} from "@hashinet/types";
import { Body, Controller, Get, HttpCode, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { Can, CurrentPrincipal, Public } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { parseInput } from "../http/validation.js";
import {
  paymentListInput,
  paymentStatusInput,
  saleInput,
  startPaymentInput,
} from "./payment-input.js";
import { PaymentsService } from "./payments.service.js";

/** A guest buying on the portal. Public, like the rest of `/api/guest/*`. */
@Public()
@Controller("api/guest/payments")
export class GuestPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(200)
  start(@Body() body: unknown, @Req() request: Request): Promise<GuestPaymentStarted> {
    return this.payments.start(parseInput(startPaymentInput, body), request.ip ?? null);
  }

  @Post("status")
  @HttpCode(200)
  status(@Body() body: unknown): Promise<GuestPaymentStatus> {
    return this.payments.status(parseInput(paymentStatusInput, body));
  }
}

@Controller("api")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** What this installation can offer, so the admin shows only what works. */
  @Get("capabilities")
  @Can("payment.read")
  capabilities(): Capabilities {
    return this.payments.capabilities();
  }

  @Get("payments")
  @Can("payment.read")
  async list(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<PaymentList> {
    return { payments: await this.payments.list(staff, parseInput(paymentListInput, query)) };
  }

  @Get("customers")
  @Can("customer.read")
  async customers(@CurrentPrincipal() staff: Principal): Promise<CustomerList> {
    return { customers: await this.payments.customers(staff) };
  }

  /** The code is in this response: it is what staff read out, or print. */
  @Post("sales")
  @Can("sale.record")
  sale(@CurrentPrincipal() staff: Principal, @Body() body: unknown): Promise<SaleResult> {
    return this.payments.recordSale(staff, parseInput(saleInput, body));
  }
}
