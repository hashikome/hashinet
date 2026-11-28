import type { Region, VenueRecord } from "@hashinet/types";
import { sellingStopped } from "../../core/access/service-pause.js";
/** A venue as the API shows it, selling or paused by its business and its routers. */
import { iso } from "../../core/records/records.js";
import type { ServiceAccess, Venue } from "../../generated/prisma/client.js";
import { sellingOf, type VenueRouter, wifiNameOf } from "../../network/routers/router-journey.js";

export function venueRecord(
  row: Venue,
  routers: VenueRouter[],
  access: ServiceAccess,
): VenueRecord {
  return {
    id: row.id,
    name: row.name,
    businessId: row.businessId,
    region: row.region as Region,
    area: row.area,
    status: row.status,
    routerCount: routers.length,
    // A business that can't sell sells nowhere, whatever its routers do.
    selling: sellingStopped(access) ? { state: "paused" } : sellingOf(routers),
    wifiName: wifiNameOf(row.name, routers),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
