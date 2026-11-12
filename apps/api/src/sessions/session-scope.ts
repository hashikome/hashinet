import type { Principal } from "../access/principal.js";
import { venueScope } from "../access/venue-scope.js";
import type { WifiSessionWhereInput } from "../generated/prisma/models.js";

/**
 * Sessions the staff member may see: every one for an admin, those at a manager's venues
 * otherwise. Devices are scoped through this too, since a device belongs to no venue: a
 * manager sees a device, and its usage, only as their venues saw it (finding 6).
 */
export function sessionScope(staff: Principal): WifiSessionWhereInput {
  return staff.scope === "platform" ? {} : { venue: { is: venueScope(staff) } };
}
