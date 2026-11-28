import { Inject, Injectable, Module } from "@nestjs/common";
import { AuditLog } from "../../core/audit/audit-log.js";
import type { AppConfig } from "../../core/config/config.js";
import { APP_CONFIG } from "../../core/config/config.module.js";
import { SecretBox } from "../../core/crypto/secret-box.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { IntervalJob, ScheduledJobs } from "../../core/jobs/interval-job.js";
import { LiveHub } from "../../core/live/live-hub.js";
import { IssuesModule } from "../../platform/issues/issues.module.js";
import { VoucherExpiry } from "../../sales/vouchers/voucher-expiry.js";
import { RouterAccess } from "../mikrotik/router-credentials.js";
import {
  HEALTH_CHECK_INTERVAL_MS,
  IDLE_POLL_EVERY_N_TICKS,
  LiveMonitor,
  POLL_INTERVAL_MS,
} from "../monitor/live-monitor.js";
import { RouterOutages } from "../monitor/router-outages.js";
import { RouterSync } from "../monitor/router-sync.js";
import { PrismaRouterStore } from "../provisioning/prisma-store.js";
import { TUNNEL_ALLOCATOR, TunnelAllocator } from "../tunnel/tunnel-allocator.js";
import { TunnelPeersController } from "../tunnel/tunnel-peers.controller.js";
import { backendSettings } from "./backend-settings.js";
import { RoutersController } from "./routers.controller.js";
import { RoutersService } from "./routers.service.js";

const MINUTE = 60_000;

/** Runs the routers' and vouchers' background jobs while the application is up. */
@Injectable()
export class BackgroundJobs extends ScheduledJobs {
  protected readonly jobs: IntervalJob[];
  private tick = 0;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    monitor: LiveMonitor,
    expiry: VoucherExpiry,
    outages: RouterOutages,
    live: LiveHub,
    routers: RoutersService,
  ) {
    super(config.jobsEnabled);
    this.jobs = [
      // Every tick while someone watches the live view; otherwise every Nth, to keep session
      // status honest without polling routers every five seconds.
      new IntervalJob("live-monitor.poll", POLL_INTERVAL_MS, async () => {
        this.tick++;
        if (live.watching() || this.tick % IDLE_POLL_EVERY_N_TICKS === 0) {
          await monitor.pollOnce((update) => live.publishHotspot(update));
          // Straight after the monitor records each router, so a short outage isn't missed between
          // its records: outages open and close, and the time goes back.
          await outages.track();
        }
      }),
      new IntervalJob("live-monitor.health", HEALTH_CHECK_INTERVAL_MS, async () => {
        await monitor.healthCheck();
        await outages.track();
      }),
      new IntervalJob("voucher.expiry", MINUTE, async () => {
        await expiry.runOnce();
      }),
      // At start, so a release's routers are set up again straight away; hourly after, for one
      // that was offline or stopped (it has an issue meanwhile).
      new IntervalJob("router.setup-again", 60 * MINUTE, async () => {
        await routers.setUpAgainAfterRelease();
      }),
    ];
  }
}

@Module({
  imports: [IssuesModule],
  providers: [
    {
      provide: RouterAccess,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new RouterAccess(
          new SecretBox(config.encryptionKey),
          config.mikrotik.apiPort,
          config.mikrotik.connectTimeoutSeconds,
          config.mikrotik.targetOverride,
        ),
    },
    {
      provide: RouterSync,
      inject: [PrismaService, RouterAccess, AuditLog],
      useFactory: (db: PrismaService, access: RouterAccess, audit: AuditLog) =>
        new RouterSync(db, access, audit),
    },
    {
      provide: PrismaRouterStore,
      inject: [PrismaService, RouterAccess, APP_CONFIG],
      useFactory: (db: PrismaService, access: RouterAccess, config: AppConfig) =>
        new PrismaRouterStore(
          db,
          access,
          new SecretBox(config.encryptionKey),
          backendSettings(config),
        ),
    },
    {
      provide: LiveMonitor,
      inject: [PrismaService, RouterAccess],
      useFactory: (db: PrismaService, access: RouterAccess) => new LiveMonitor(db, access),
    },
    {
      provide: VoucherExpiry,
      inject: [PrismaService, RouterSync],
      useFactory: (db: PrismaService, sync: RouterSync) => new VoucherExpiry(db, sync),
    },
    {
      provide: TUNNEL_ALLOCATOR,
      inject: [PrismaService, APP_CONFIG],
      useFactory: (db: PrismaService, config: AppConfig) =>
        config.tunnel === null
          ? null
          : new TunnelAllocator(db, new SecretBox(config.encryptionKey), {
              network: config.tunnel.network,
            }),
    },
    RoutersService,
    RouterOutages,
    LiveHub,
    BackgroundJobs,
  ],
  controllers: [RoutersController, TunnelPeersController],
  exports: [
    LiveHub,
    RouterOutages,
    RouterAccess,
    RouterSync,
    PrismaRouterStore,
    LiveMonitor,
    VoucherExpiry,
  ],
})
export class RoutersModule {}
