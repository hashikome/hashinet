import { getLogger } from "@logtape/logtape";
import type { AuditLog } from "../audit/audit-log.js";
import type { PrismaClient, Router } from "../generated/prisma/client.js";
import { passedSetup } from "../routers/router-journey.js";
import {
  answersArp,
  closeConnection,
  connectToRouter,
  endHotspotSession,
  hotspotClientAddress,
  hotspotSessionUser,
  loginHotspotClient,
  type MikroTikConn,
  setDeviceBlocked,
} from "./mikrotik.js";
import { ROUTER_REACH, type RouterAccess, type RouterReach } from "./router-credentials.js";
import { RouterLogger } from "./router-log.js";
import { RosClient } from "./router-provision/ros-client.js";
import { applyAllowedSites } from "./router-provision/steps.js";

const logger = getLogger(["hashinet", "router-sync"]);

/**
 * What HashiNet changes on a venue's routers outside a setup: a device's session, its block, and the
 * sites open before paying. No voucher lives on a router: RADIUS answers every login (ADR-0015).
 */
export class RouterSync {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: RouterAccess,
    private readonly audit: AuditLog,
  ) {}

  /** Puts the blocks of the router's business on a newly added or set-up router. */
  async syncBlocks(routerId: string): Promise<void> {
    const router = await this.db.router.findUnique({ where: { id: routerId } });
    if (!router) return;
    if (!this.access.credentials(router)) return;
    // The devices this venue's business has blocked; other businesses' blocks stay theirs.
    const blocked = await this.db.device.findMany({
      where: { blocks: { some: { business: { venues: { some: { id: router.venueId } } } } } },
      select: { macAddress: true },
    });
    const done = await this.onRouter(router, async (conn) => {
      for (const device of blocked) await setDeviceBlocked(conn, device.macAddress, true);
      return true;
    });
    if (done) {
      await this.db.router.update({
        where: { id: routerId },
        data: { status: "online", lastSeenAt: new Date(), failedSyncs: 0 },
      });
      return;
    }
    await this.db.router.update({ where: { id: routerId }, data: { status: "error" } });
    await this.failed(router);
  }

  /**
   * A failed sync adds to the router's count; only the first of a run is audited, so a router that
   * stays unreachable leaves one row, not one per attempt.
   */
  private async failed(router: { id: string; venueId: string }): Promise<void> {
    const { failedSyncs } = await this.db.router.update({
      where: { id: router.id },
      data: { failedSyncs: { increment: 1 } },
      select: { failedSyncs: true },
    });
    if (failedSyncs > 1) return;
    await this.audit.system({
      action: "router.sync_failed",
      target: { type: "router", id: router.id },
      ...(await this.audit.atVenue(router.venueId)),
      outcome: "failed",
      change: null,
    });
  }

  /**
   * Whether this router sees the device at this address. Null when it cannot be asked. What a
   * guest's browser names is checked here, so a cookie is never planted for a device not present.
   */
  async deviceOnNetwork(
    router: Router,
    device: { mac: string; ip: string },
  ): Promise<boolean | null> {
    return this.onRouter(
      router,
      async (conn) => (await hotspotClientAddress(conn, device.mac)) === device.ip,
    );
  }

  /** Where the router sees a device now; null if it does not, or cannot be asked. */
  async deviceAddress(router: Router, mac: string): Promise<string | null> {
    return this.onRouter(router, (conn) => hotspotClientAddress(conn, mac));
  }

  /** Whether the device holding a place still answers on this router; null when it can't be asked. */
  async stillThere(
    router: RouterReach & Pick<Router, "hotspotInterface">,
    ip: string,
  ): Promise<boolean | null> {
    const iface = router.hotspotInterface;
    if (iface === null) return null;
    return this.onRouter(router, (conn) => answersArp(conn, ip, iface));
  }

  /** Ends one device's session on this router. Best effort: the session ends at its limit anyway. */
  async endSession(router: RouterReach, mac: string): Promise<void> {
    await this.onRouter(router, (conn) => endHotspotSession(conn, mac));
  }

  /**
   * Ends one device's session on every router of its venue, wherever it is online: a device may
   * have moved between them. Best effort, like `endSession`.
   */
  async endDevice(venueId: string, mac: string): Promise<void> {
    const routers = await this.db.router.findMany({ where: { venueId }, select: ROUTER_REACH });
    await Promise.allSettled(routers.map((router) => this.endSession(router, mac)));
  }

  /**
   * Signs a device in on this router with its voucher's code: the router asks RADIUS, which takes
   * the admission the sign-in left. True only once the router reports it online on that code.
   */
  async signInDevice(
    router: Router,
    client: { user: string; ip: string; mac: string },
  ): Promise<boolean> {
    const online = await this.onRouter(router, async (conn) => {
      if ((await hotspotSessionUser(conn, client.mac)) !== client.user) {
        await loginHotspotClient(conn, client);
      }
      return (await hotspotSessionUser(conn, client.mac)) === client.user;
    });
    return online === true;
  }

  private async onRouter<T>(
    router: RouterReach,
    work: (conn: MikroTikConn) => Promise<T>,
  ): Promise<T | null> {
    const creds = this.access.credentials(router);
    if (!creds) return null;
    let conn: MikroTikConn | null = null;
    try {
      conn = await connectToRouter(creds);
      return await work(conn);
    } catch {
      return null;
    } finally {
      if (conn) await closeConnection(conn);
    }
  }

  /**
   * Brings each of a venue's routers' open sites in line with `hosts`, now rather than at the next
   * Set up: after a site is added, removed or paid for. Best effort: a router that can't be reached
   * gets them at its next Set up, which applies the same list.
   */
  async pushOpenSites(venueId: string, hosts: string[]): Promise<void> {
    // Only routers set up: setup probed what each supports and made its walled garden; one not
    // set up gets the sites at Set up.
    const routers = await this.db.router.findMany({ where: { venueId } });
    for (const router of routers.filter((r) => passedSetup(r.lastSetup))) {
      const creds = this.access.credentials(router);
      if (!creds) continue;
      await this.onRouter(router, (conn) =>
        applyAllowedSites(new RosClient(conn, new RouterLogger("sync"), creds.host), hosts),
      );
    }
  }

  /**
   * Blocks or unblocks a device at every router of one business, the one that blocked it. A router
   * that misses a block gets it from `syncBlocks`.
   */
  async setDeviceBlocked(businessId: string, mac: string, blocked: boolean): Promise<void> {
    for (const router of await this.db.router.findMany({ where: { venue: { businessId } } })) {
      const creds = this.access.credentials(router);
      if (!creds) continue;
      let conn: MikroTikConn | null = null;
      try {
        conn = await connectToRouter(creds);
        await setDeviceBlocked(conn, mac, blocked);
      } catch (err) {
        logger.error("Failed to update a device block on {router}", {
          router: router.name,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (conn) await closeConnection(conn);
      }
    }
  }
}
