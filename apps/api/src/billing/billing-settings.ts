import type { BillingSettingsRecord, FeeTerms } from "@hashinet/types";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../access/principal.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import type { BillingSetting } from "../generated/prisma/client.js";
import { oneLine } from "../http/validation.js";

/** Today's terms (ADR-0013, 3), until the platform admin saves others. */
export const DEFAULT_FEE_TERMS: FeeTerms = {
  rateBp: 500,
  lowerRateBp: 250,
  lowerRateAboveTsh: 2_000_000,
  minimumTsh: 5_000,
};

const ACCOUNT_NAME = "Shikome Technology Limited";

const basisPoints = z
  .number("must be a number")
  .int("must have at most two decimal places")
  .min(0, "can't be below 0%")
  .max(10_000, "can't be above 100%");
const shillings = z
  .number("must be a number")
  .int("must be whole shillings")
  .min(0, "can't be below zero")
  .max(1_000_000_000, "is too large");
/** Optional: an empty field offers no such way to pay. */
const optional = (max: number) => oneLine(max).transform((v) => (v === "" ? null : v));

export const billingSettingsInput = z.object({
  terms: z
    .object({
      rateBp: basisPoints,
      lowerRateBp: basisPoints,
      lowerRateAboveTsh: shillings,
      minimumTsh: shillings,
    })
    // Volume lowers the rate, never raises it (ADR-0013, 3).
    .refine((t) => t.lowerRateBp <= t.rateBp, {
      path: ["lowerRateBp"],
      message: "can't be above the fee",
    }),
  payTo: z.object({
    mobileMoney: optional(40),
    bankName: optional(80),
    bankAccount: optional(40),
    accountName: oneLine(160).min(1, "is required"),
  }),
});
export type BillingSettingsInput = z.infer<typeof billingSettingsInput>;

function record(row: BillingSetting | null): BillingSettingsRecord {
  if (row === null) {
    return {
      terms: DEFAULT_FEE_TERMS,
      payTo: { mobileMoney: null, bankName: null, bankAccount: null, accountName: ACCOUNT_NAME },
      updatedAt: null,
    };
  }
  return {
    terms: businessFeeTerms(row),
    payTo: {
      mobileMoney: row.payMobileMoney,
      bankName: row.payBankName,
      bankAccount: row.payBankAccount,
      accountName: row.payAccountName,
    },
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The terms a new business copies, and where every business pays HashiNet. */
@Injectable()
export class BillingSettings {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  async get(): Promise<BillingSettingsRecord> {
    // Not findUnique: Prisma batches concurrent ones into an `in`, which a boolean cannot take.
    return record(await this.db.billingSetting.findFirst());
  }

  async save(staff: Principal, input: BillingSettingsInput): Promise<BillingSettingsRecord> {
    const before = await this.get();
    const data = {
      ...feeTermsColumns(input.terms),
      payMobileMoney: input.payTo.mobileMoney,
      payBankName: input.payTo.bankName,
      payBankAccount: input.payTo.bankAccount,
      payAccountName: input.payTo.accountName,
    };
    const row = await this.db.billingSetting.upsert({
      where: { singleton: true },
      create: data,
      update: data,
    });
    const after = record(row);
    // Only what changed, so the log says what the admin did.
    const was: Record<string, string | number | null> = { ...before.terms, ...before.payTo };
    const now: Record<string, string | number | null> = { ...after.terms, ...after.payTo };
    const changed = Object.keys(now).filter((k) => was[k] !== now[k]);
    await this.audit.record(staff, {
      action: "fees.update",
      businessId: null,
      venueId: null,
      target: { type: "fees", id: row.id },
      change: {
        before: Object.fromEntries(changed.map((k) => [k, was[k] ?? null])),
        after: Object.fromEntries(changed.map((k) => [k, now[k] ?? null])),
      },
    });
    return after;
  }
}

/** A business's own copy of the terms, as its columns hold them. */
export function businessFeeTerms(row: {
  feeRateBp: number;
  feeLowerRateBp: number;
  feeLowerRateAboveTsh: number;
  feeMinimumTsh: number;
}): FeeTerms {
  return {
    rateBp: row.feeRateBp,
    lowerRateBp: row.feeLowerRateBp,
    lowerRateAboveTsh: row.feeLowerRateAboveTsh,
    minimumTsh: row.feeMinimumTsh,
  };
}

/** The columns a new business is created with: the platform's terms as they stand. */
export function feeTermsColumns(terms: FeeTerms) {
  return {
    feeRateBp: terms.rateBp,
    feeLowerRateBp: terms.lowerRateBp,
    feeLowerRateAboveTsh: terms.lowerRateAboveTsh,
    feeMinimumTsh: terms.minimumTsh,
  };
}
