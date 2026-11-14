import { z } from "zod";

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
