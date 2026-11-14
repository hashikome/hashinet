import { z } from "zod";
import { oneLine } from "../http/validation.js";
import { mobileNumber } from "../payments/payment-input.js";

const STATUSES = ["unused", "pending_activation", "active", "expired", "used", "refunded"] as const;

export const listQuery = z.object({
  venueId: z.uuid().nullable().default(null),
  status: z.enum(STATUSES).nullable().default(null),
  /** Digits of a code, as typed in the search: the vouchers whose code holds them. */
  code: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .pipe(z.string().max(12))
    .nullable()
    .default(null),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  before: z.uuid().nullable().default(null),
});

/**
 * A refund (ADR-0017, 7): the full price back, by cash, or by mobile money to the guest's number
 * with the reference from its message; a reason if there is one.
 */
export const refundInput = z
  .object({
    method: z.enum(["cash", "mobile_money"]),
    phone: mobileNumber.nullable().default(null),
    reference: oneLine(80).nullable().default(null),
    reason: oneLine(200).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.method === "cash") return;
    if (v.phone === null) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "is required for mobile money" });
    }
    if (v.reference === null || v.reference === "") {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "is required for mobile money",
      });
    }
  });
