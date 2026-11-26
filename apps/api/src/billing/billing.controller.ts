import type {
  BillingAccount,
  BillingOverview,
  BillingSettingsResponse,
  InvoiceResponse,
} from "@hashinet/types";
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { Can, CurrentPrincipal } from "../access/access.guard.js";
import type { Principal } from "../access/principal.js";
import { monthParam } from "../analytics/analytics.service.js";
import { idParam } from "../http/id-param.js";
import { parseInput } from "../http/validation.js";
import { BillingSettings, billingSettingsInput } from "./billing-settings.js";
import { Invoices } from "./invoices.js";
import { BillPayments, recordPaymentInput } from "./payments.js";

const accountQuery = z.object({ businessId: z.uuid().optional() });
const remindInput = z.object({ businessId: z.uuid() });
const overviewQuery = z
  .object({ from: monthParam.optional(), to: monthParam.optional() })
  .refine((q) => (q.from === undefined) === (q.to === undefined), {
    path: ["to"],
    message: "comes with from",
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ["to"],
    message: "must not be before from",
  });

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

  /** A business's account: the owner's own, or the one HashiNet's staff name. */
  @Get("account")
  @Can("billing.read")
  async account(
    @CurrentPrincipal() staff: Principal,
    @Query() query: unknown,
  ): Promise<BillingAccount> {
    const { businessId } = parseInput(accountQuery, query);
    return this.invoices.account(staff, businessId ?? null);
  }

  @Get("overview")
  @Can("billing.overview")
  async overview(@Query() query: unknown): Promise<BillingOverview> {
    const { from, to } = parseInput(overviewQuery, query);
    return this.invoices.overview(from && to ? { from, to } : null);
  }

  /** Money a business paid, as it arrived: on an invoice, or the oldest first. */
  @Post("payments")
  @HttpCode(204)
  @Can("billing.record")
  async record(@CurrentPrincipal() staff: Principal, @Body() body: unknown): Promise<void> {
    const input = parseInput(recordPaymentInput, body);
    await this.payments.record(staff, input);
    await this.invoices.syncBillIssues(input.businessId);
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
    return this.invoices.get(staff, id);
  }
}
