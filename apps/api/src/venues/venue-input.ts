import { REGIONS } from "@hashinet/types";
import { z } from "zod";
import { oneLine } from "../core/http/validation.js";

const line = oneLine;

/**
 * A venue as it is entered, for create and for update alike: the form always sends the whole
 * venue, so an absent optional field is cleared rather than left as it was. Who works there is
 * not here: that is each membership's venues.
 */
export const venueInput = z.object({
  name: line(180).min(1, "is required"),
  region: z.enum(REGIONS),
  area: line(160).min(1, "is required"),
  /** Platform staff name the business; a business's own people add to their business. */
  businessId: z.uuid().optional(),
  status: z.enum(["active", "inactive", "maintenance"]).default("active"),
});

export type VenueInput = z.infer<typeof venueInput>;
