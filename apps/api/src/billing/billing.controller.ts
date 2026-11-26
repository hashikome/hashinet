import type { BillingSettingsResponse, InvoiceList, InvoiceResponse } from "@hashinet/types";
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { BillingSettings, billingSettingsInput } from "./billing-settings.js";
import { Invoices } from "./invoices.js";
import { BillPayments, recordPaymentInput } from "./payments.js";

const invoicesQuery = z.object({ businessId: z.uuid().optional() });
const remindInput = z.object({ businessId: z.uuid() });

@Controller("api/billing")
export class BillingController {
  constructor(
    private readonly settings: BillingSettings,
    private readonly invoices: Invoices,
    private readonly payments: BillPayments,
  ) {}

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

  /** The owner's own invoices; HashiNet's staff name the business. */
  @Get("invoices")
  @Can("billing.read")
  async list(@CurrentPrincipal() staff: Principal, @Query() query: unknown): Promise<InvoiceList> {
    const { businessId } = parseInput(invoicesQuery, query);
    return { invoices: await this.invoices.list(staff, businessId ?? null) };
  }

  /** Money a business paid, as it arrived: on an invoice, or the oldest first. */
  @Post("payments")
  @HttpCode(204)
  @Can("billing.record")
  async record(@CurrentPrincipal() staff: Principal, @Body() body: unknown): Promise<void> {
    await this.payments.record(staff, parseInput(recordPaymentInput, body));
  }

  /** Emails the business's owners what they owe. */
  @Post("reminders")
  @HttpCode(204)
  @Can("billing.remind")
  async remind(@CurrentPrincipal() staff: Principal, @Body() body: unknown): Promise<void> {
    await this.invoices.remind(staff, parseInput(remindInput, body).businessId);
  }

  @Get("invoices/:id")
  @Can("billing.read")
  async get(
    @CurrentPrincipal() staff: Principal,
    @Param("id", idParam()) id: string,
  ): Promise<InvoiceResponse> {
    return { invoice: await this.invoices.get(staff, id) };
  }
}
