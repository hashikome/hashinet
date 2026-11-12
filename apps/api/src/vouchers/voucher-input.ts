import { z } from "zod";

/** A batch request: how many cards of a package, for a venue. */
export const batchInput = z.object({
  venueId: z.uuid(),
  packageId: z.uuid(),
  quantity: z.number().int("must be a whole number").min(1).max(1000),
  /** Days until unused cards stop working; null for no date. */
  expiryDays: z.number().int("must be a whole number").min(1).max(365).nullable().default(null),
});

export type BatchInput = z.infer<typeof batchInput>;

const STATUSES = ["unused", "pending_activation", "active", "expired", "used", "revoked"] as const;

export const listQuery = z.object({
  venueId: z.uuid().nullable().default(null),
  batchId: z.uuid().nullable().default(null),
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

/** Vouchers chosen by id, to revoke or to print. */
export const revokeInput = z.object({
  ids: z.array(z.uuid()).min(1, "choose at least one voucher").max(1000),
});
