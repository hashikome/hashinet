import { Injectable } from "@nestjs/common";
import { AuditLog } from "../../core/audit/audit-log.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { captureFailure } from "../../core/observability/telemetry.js";
import { Prisma } from "../../generated/prisma/client.js";
import { IssuesService } from "../../platform/issues/issues.service.js";

const MINUTE_MS = 60_000;

/**
 * Outages, and the paid time they take given back (the plan, slice 2 step j). A set-up router that
 * stops serving (unreachable, failing, or answering with no internet) has an outage from when it
 * was last seen serving; once it serves again with its internet working, every paid voucher whose
 * time ran through it then is given that time back, never more than it had left when the outage
 * began, once.
 */
@Injectable()
export class RouterOutages {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly issues: IssuesService,
  ) {}

  /** Opens and closes outages from what the live monitor last recorded about each router. */
  async track(now = new Date()): Promise<void> {
    const routers = await this.db.router.findMany({
      where: { lastSetup: { path: ["ok"], equals: true } },
      select: {
        id: true,
        status: true,
        internetOk: true,
        lastSeenAt: true,
        internetSeenAt: true,
        outages: { where: { endedAt: null }, select: { id: true }, take: 1 },
      },
    });
    for (const r of routers) {
      const serving = r.status === "online" && r.internetOk;
      const [open] = r.outages;
      if (!serving && open === undefined) {
        const noInternet = r.status === "online";
        const since = (noInternet ? r.internetSeenAt : r.lastSeenAt) ?? now;
        await this.db.routerOutage
          .create({
            data: {
              routerId: r.id,
              kind: noInternet ? "no_internet" : "offline",
              startedAt: since,
            },
          })
          // Opened at the same moment by another run (`router_outages_one_open`): it is open.
          .catch((err: unknown) => {
            if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
              throw err;
            }
          });
      } else if (serving && open !== undefined) {
        await this.db.routerOutage.update({ where: { id: open.id }, data: { endedAt: now } });
        await this.giveBack(open.id, now).catch(captureFailure);
      }
    }
  }

  /**
   * Gives each paid voucher whose time ran during the outage at its router the time it lost: the
   * overlap of the outage with its time, which is never more than it had left when the outage
   * began, from when it can be used again (the later of its end and the outage's). One that expired
   * meanwhile works again, and the routers' limit for it rises by as much. Once per outage: the
   * conditional update claims it.
   */
  async giveBack(outageId: string, now = new Date()): Promise<void> {
    const claimed = await this.db.routerOutage.updateMany({
      where: { id: outageId, givenBackAt: null, endedAt: { not: null } },
      data: { givenBackAt: now },
    });
    if (claimed.count === 0) return;
    const outage = await this.db.routerOutage.findUniqueOrThrow({
      where: { id: outageId },
      include: { router: { select: { id: true, venueId: true } } },
    });
    const ended = outage.endedAt ?? now;
    const sessions = await this.db.wifiSession.findMany({
      where: {
        routerId: outage.routerId,
        voucherId: { not: null },
        startedAt: { lt: ended },
        OR: [{ endedAt: null }, { endedAt: { gt: outage.startedAt } }],
      },
      select: { voucherId: true },
      distinct: ["voucherId"],
    });
    const vouchers = await this.db.voucher.findMany({
      where: {
        id: { in: sessions.flatMap((s) => (s.voucherId === null ? [] : [s.voucherId])) },
        status: { in: ["active", "expired"] },
        payments: { some: { status: "paid" } },
        activatedAt: { not: null },
        expiresAt: { not: null },
      },
    });
    const given: number[] = [];
    for (const v of vouchers) {
      if (v.activatedAt === null || v.expiresAt === null) continue;
      const from = Math.max(outage.startedAt.getTime(), v.activatedAt.getTime());
      const to = Math.min(ended.getTime(), v.expiresAt.getTime());
      const minutes = Math.ceil((to - from) / MINUTE_MS);
      if (minutes <= 0) continue;
      // From when the guest can use it again: one that would have ended during the outage gets its
      // lost minutes after the outage, not before it ended.
      const resumes = Math.max(v.expiresAt.getTime(), ended.getTime());
      const expiresAt = new Date(resumes + minutes * MINUTE_MS);
      await this.db.voucher.update({
        where: { id: v.id },
        data: {
          expiresAt,
          givenBackMinutes: { increment: minutes },
          ...(v.status === "expired" && expiresAt > now ? { status: "active" } : {}),
        },
      });
      // A device online keeps its old Session-Timeout; when it ends, the device comes back by its
      // address and RADIUS gives it the time to the new end.
      given.push(minutes);
    }
    if (given.length === 0) return;
    await this.audit.system({
      action: "router.time_given_back",
      target: { type: "router", id: outage.routerId },
      ...(await this.audit.atVenue(outage.router.venueId)),
      outcome: "success",
      change: {
        before: {},
        after: { guests: given.length, minutes: given.reduce((a, b) => a + b, 0) },
      },
    });
    await this.issues.logRouterStep(outage.routerId, {
      step: "time_given_back",
      guests: given.length,
      minutes: given.join(","),
    });
  }
}
