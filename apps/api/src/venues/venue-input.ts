import { REGIONS } from "@hashinet/types";
import { z } from "zod";

/** One line of text: trimmed, no control characters (names reach printed vouchers and the portal). */
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, "must be one line of text");

/**
 * A venue as it is entered, for create and for update alike: the form always sends the whole
 * venue, so an absent optional field is cleared rather than left as it was. Who works there is
 * not here: that is each membership's venues.
 */
const HOST_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A pasted address reduced to its host name, as the router's walled garden takes it. */
const allowedSite = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^https?:\/\//, "").replace(/[/?#:].*$/, ""))
  .refine((value) => HOST_NAME.test(value), "must be a site's address, such as hotel.co.tz");

export const venueInput = z.object({
  name: line(180).min(1, "is required"),
  allowedSites: z
    .array(allowedSite)
    .max(20)
    .default([])
    .transform((sites) => [...new Set(sites)]),
  region: z.enum(REGIONS),
  area: line(160).min(1, "is required"),
  /** Platform staff name the business; a business's own people add to their business. */
  businessId: z.uuid().optional(),
  status: z.enum(["active", "inactive", "maintenance"]).default("active"),
});

export type VenueInput = z.infer<typeof venueInput>;
