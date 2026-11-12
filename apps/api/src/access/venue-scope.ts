import type { VenueWhereInput } from "../generated/prisma/models.js";
import type { Principal } from "./principal.js";

/**
 * The venues a principal may reach (ADR-0011, 4 and 5): every venue for platform roles, the
 * business's for its owner and business managers, and only their own venues for a venue
 * manager or venue operator. Every scoped query goes through this, and a record outside it is
 * answered as not found, never as forbidden, so its existence is not revealed.
 */
export function venueScope(principal: Principal): VenueWhereInput {
  if (principal.scope === "platform") return {};
  if (principal.venueIds === null) return { businessId: principal.businessId ?? "" };
  return { businessId: principal.businessId ?? "", id: { in: principal.venueIds } };
}

/** The business a principal acts in; null on the platform, which reaches every business. */
export function businessScope(principal: Principal): { businessId?: string } {
  return principal.scope === "platform" ? {} : { businessId: principal.businessId ?? "" };
}
