import { getLogger } from "@logtape/logtape";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import {
  closeConnection,
  connectToRouter,
  endHotspotSession,
  getActiveClients,
  getSystemUptimeSeconds,
  type MikroTikActiveClient,
  type MikroTikConn,
  reachesInternet,
} from "../mikrotik/mikrotik.js";
import type { RouterAccess } from "../mikrotik/router-credentials.js";
import { bytesUsed, PACKAGE_SPEED_SELECT, throttledNow } from "../radius/access-decision.js";

// Voucher codes are credentials: logs name the session or router, never the code.
const logger = getLogger(["hashinet", "live-monitor"]);

export const POLL_INTERVAL_MS = 5_000;
export const HEALTH_CHECK_INTERVAL_MS = 60_000;
/**
 * With nobody watching the live view there is no console to feed, but session status still has
 * to be reconciled (the Users page reads it as "online now"), so poll every Nth tick instead of
 * skipping, and a walked-away device stops reading as connected within 30 s.
 */
export const IDLE_POLL_EVERY_N_TICKS = 6;
const THROTTLE_RETRY_MS = 10 * 60_000;
/** Pings that fail in a row before a router counts as having no internet. */
const INTERNET_FAILS_DOWN = 2;

/** A router's connected sessions, as a poll reconciles them and checks their speed. */
const SESSION_SELECT = {
  id: true,
  macAddress: true,
  startedAt: true,
  voucherId: true,
  isThrottled: true,
  package: { select: PACKAGE_SPEED_SELECT },
} as const;
type ConnectedSession = Prisma.WifiSessionGetPayload<{ select: typeof SESSION_SELECT }>;

/** One router's live clients, for the admin live view. */
export interface HotspotUpdate {
  type: "hotspot_update";
  routerId: string;
  routerName: string;
  venueId: string;
  venueName: string;
  timestamp: string;
  clients: MikroTikActiveClient[];
}

/**
 * Polls online routers for their live hotspot clients: records traffic and router health,
 * closes sessions that left, and applies package throttling. Recovers routers that went offline.
 */
export class LiveMonitor {
  /**
   * Sessions whose last throttle attempt failed, and when to next try them.
   *
   * The old code updated `isThrottled` *inside* the try, after the router write. A rejected write
   * therefore left the flag unchanged, `shouldThrottle === session.isThrottled` stayed false, and the
   * same failing command went back out on **every poll** — every 5s per client, forever. On a 32MB
   * smips board that is real CPU. Keyed by session so one bad package cannot stall the rest.
   */
  private readonly throttleBackoff = new Map<string, number>();

  constructor(
    private readonly db: PrismaClient,
    private readonly access: RouterAccess,
  ) {}

  /** Polls every online router once. `onUpdate` receives each router's live clients. */
  async pollOnce(onUpdate: (update: HotspotUpdate) => void = () => {}): Promise<void> {
    const onlineRouters = await this.db.router.findMany({
      where: { status: "online" },
      include: { venue: { select: { name: true } } },
    });
    if (onlineRouters.length === 0) return;

    await Promise.allSettled(
      onlineRouters.map(async (router) => {
        const creds = this.access.credentials(router);
        if (!creds) return;
        let conn: MikroTikConn | null = null;
        try {
          conn = await connectToRouter(creds);
          // Taken before the list is read: a session that opens after it is not on it.
          const readAt = new Date();
          const [clients, uptimeSeconds, internet] = await Promise.all([
            getActiveClients(conn),
            getSystemUptimeSeconds(conn),
            reachesInternet(conn),
          ]);
          onUpdate({
            type: "hotspot_update",
            routerId: router.id,
            routerName: router.name,
            venueId: router.venueId,
            venueName: router.venue.name,
            timestamp: new Date().toISOString(),
            clients,
          });

          await this.db.router.update({
            where: { id: router.id },
            data: { lastSeenAt: new Date(), connectedDevices: clients.length, uptimeSeconds },
          });
          await recordInternet(this.db, router.id, internet);

          const sessions = await this.db.wifiSession.findMany({
            where: { routerId: router.id, status: "connected" },
            select: SESSION_SELECT,
          });
          await recordClients(this.db, sessions, clients, readAt);
          const listed = new Set(clients.map((c) => c.mac));
          await this.applyThrottle(
            conn,
            sessions.filter((s) => listed.has(s.macAddress)),
          );
        } catch (err) {
          logger.error("Poll failed for router {router}", {
            router: router.name,
            routerId: router.id,
            error: err instanceof Error ? err.message : String(err),
          });
          await this.db.router.update({
            where: { id: router.id },
            data: { status: "error", connectedDevices: 0 },
          });
        } finally {
          if (conn) await closeConnection(conn);
        }
      }),
    );
  }

  /** Tries to reach routers marked offline or in error, and marks those that answer online. */
  async healthCheck(): Promise<void> {
    const deadRouters = await this.db.router.findMany({
      where: { status: { in: ["offline", "error"] } },
    });
    await Promise.allSettled(
      deadRouters.map(async (router) => {
        const creds = this.access.credentials(router);
        if (!creds) return;
        let conn: MikroTikConn | null = null;
        try {
          conn = await connectToRouter(creds);
          await this.db.router.update({
            where: { id: router.id },
            data: { status: "online", lastSeenAt: new Date() },
          });
          logger.info("Router {router} recovered and is online", { router: router.name });
        } catch {
          // Still unreachable: its status stays as it is.
        } finally {
          if (conn) await closeConnection(conn);
        }
      }),
    );
  }

  /**
   * Ends a session whose speed no longer holds: its package's peak hours began or ended, or its
   * voucher passed the data it throttles after. RADIUS sets a session's speed when it starts, so
   * the device comes back by its address and RADIUS gives it the speed that holds now, by the same
   * rule (`throttledNow`); its new session carries that, so it isn't ended again.
   */
  private async applyThrottle(conn: MikroTikConn, sessions: ConnectedSession[]): Promise<void> {
    if (sessions.length === 0) return;
    const now = new Date();
    // A session that fails and then disconnects never clears its own entry, and this process
    // runs for weeks, so expired entries are dropped each pass.
    for (const [sessionId, retryAt] of this.throttleBackoff) {
      if (retryAt <= now.getTime()) this.throttleBackoff.delete(sessionId);
    }
    // Only a package that throttles after its data needs what its vouchers have used.
    const voucherIds = [
      ...new Set(
        sessions.flatMap((s) =>
          s.voucherId === null || s.package?.throttleAfterGb == null ? [] : [s.voucherId],
        ),
      ),
    ];
    const usage =
      voucherIds.length === 0
        ? []
        : await this.db.wifiSession.groupBy({
            by: ["voucherId"],
            where: { voucherId: { in: voucherIds } },
            _sum: { uploadBytes: true, downloadBytes: true },
          });
    const usedBy = new Map(usage.map((u) => [u.voucherId, bytesUsed(u._sum)]));
    for (const session of sessions) {
      if (!session.package || session.voucherId === null) continue;
      const used = usedBy.get(session.voucherId) ?? 0n;
      if (throttledNow(session.package, used, now) === session.isThrottled) {
        this.throttleBackoff.delete(session.id);
        continue;
      }
      const retryAt = this.throttleBackoff.get(session.id);
      if (retryAt !== undefined && now.getTime() < retryAt) continue;
      try {
        await endHotspotSession(conn, session.macAddress);
        await this.db.wifiSession.update({
          where: { id: session.id },
          data: { status: "terminated", endedAt: now, terminationReason: "speed_changed" },
        });
        this.throttleBackoff.delete(session.id);
      } catch (err) {
        // Latch the failure: retrying a rejected command every 5 s pinned the CPU on an hAP lite.
        this.throttleBackoff.set(session.id, now.getTime() + THROTTLE_RETRY_MS);
        logger.error("Could not end session {sessionId} for its new speed; retrying later", {
          sessionId: session.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

/**
 * Brings a router's sessions in line with what it reported at `readAt`: the counters of those
 * online, and an end for those it no longer lists (a lost accounting Stop). Only sessions that
 * started before the list was read can be missing from it. Sessions open from accounting, by device
 * address, since a device back by its address shows that as its user (ADR-0015).
 */
export async function recordClients(
  db: Pick<PrismaClient, "wifiSession">,
  sessions: Pick<ConnectedSession, "id" | "macAddress" | "startedAt">[],
  clients: MikroTikActiveClient[],
  readAt: Date,
): Promise<void> {
  const byMac = new Map(clients.map((c) => [c.mac, c]));
  const gone = sessions
    .filter((s) => !byMac.has(s.macAddress) && s.startedAt < readAt)
    .map((s) => s.id);
  if (gone.length > 0) {
    await db.wifiSession.updateMany({
      where: { id: { in: gone }, status: "connected" },
      data: { status: "disconnected", endedAt: new Date() },
    });
  }
  await Promise.allSettled(
    sessions.flatMap((s) => {
      const client = byMac.get(s.macAddress);
      if (!client) return [];
      return [
        db.wifiSession.update({
          where: { id: s.id },
          data: { uploadBytes: BigInt(client.bytesIn), downloadBytes: BigInt(client.bytesOut) },
        }),
      ];
    }),
  );
}

/**
 * Whether the router reaches the internet itself. Two failed pings in a row mark it down and one
 * good one marks it up, so one lost ping doesn't flap it; `internetSeenAt` keeps the last good one,
 * when an outage without internet began.
 */
export async function recordInternet(
  db: Pick<PrismaClient, "router">,
  routerId: string,
  reached: boolean,
): Promise<void> {
  if (reached) {
    await db.router.update({
      where: { id: routerId },
      data: { internetOk: true, internetFails: 0, internetSeenAt: new Date() },
    });
    return;
  }
  const { internetFails } = await db.router.update({
    where: { id: routerId },
    data: { internetFails: { increment: 1 } },
    select: { internetFails: true },
  });
  if (internetFails >= INTERNET_FAILS_DOWN) {
    await db.router.update({ where: { id: routerId }, data: { internetOk: false } });
  }
}
