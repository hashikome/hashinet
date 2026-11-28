import type { RouterRecord } from "@hashinet/types";
/** A router as the API shows it, with its stage and condition from its journey. */
import { iso, isoOrNull } from "../../core/records/records.js";
import type { Router } from "../../generated/prisma/client.js";
import { DEFAULT_HOTSPOT_NETWORK } from "../../network/provisioning/context.js";
import {
  conditionOf,
  routerJourney,
  type StoredSetup,
} from "../../network/routers/router-journey.js";

/** An allowlist, so a column added later (a key, a secret) stays out until it is mapped. */
export function routerRecord(
  row: Router & { venue: { name: string } },
  /** Whether the reader sets up routers: only they see the setup command. */
  managesRouters: boolean,
): RouterRecord {
  const stage = routerJourney(row, row.lastSetup as StoredSetup | null).stage;
  return {
    id: row.id,
    venueId: row.venueId,
    venueName: row.venue.name,
    name: row.name,
    model: row.model,
    identity: row.identity,
    ipAddress: row.ipAddress,
    hotspotGatewayIp: row.hotspotGatewayIp,
    macAddress: row.macAddress,
    apiUsername: row.apiUsername,
    hasApiPassword: row.apiPasswordEncrypted !== null,
    enableHotspot: row.enableHotspot,
    hotspotName: row.hotspotName,
    hotspotInterface: row.hotspotInterface,
    ssid: row.ssid,
    // The network setup uses: its own, or the default it falls back to.
    networkRange: row.networkRange?.includes("/") ? row.networkRange : DEFAULT_HOTSPOT_NETWORK,
    provisioningCommand: managesRouters ? row.provisioningCommand : null,
    tunnelAddress: row.tunnelAddress,
    rosVersion: row.rosVersion,
    architecture: row.architecture,
    provisionedAt: isoOrNull(row.provisionedAt),
    lastSeenAt: isoOrNull(row.lastSeenAt),
    failedSyncs: row.failedSyncs,
    uptimeSeconds: row.uptimeSeconds,
    connectedDevices: row.connectedDevices,
    status: row.status,
    stage,
    condition: conditionOf(stage, row.status, row.internetOk),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
