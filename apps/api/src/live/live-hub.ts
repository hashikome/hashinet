import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { LiveMessage } from "@hashinet/types";
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import { type WebSocket, WebSocketServer } from "ws";
import { allows } from "../access/policy.js";
import { principalFromSession } from "../access/principal-from-session.js";
import { venueScope } from "../access/venue-scope.js";
import { type Auth, BETTER_AUTH } from "../auth/create-auth.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { captureFailure } from "../observability/telemetry.js";
import type { HotspotUpdate } from "../services/live-monitor.js";
import { onRouterLog, type RouterLogEvent } from "../services/router-log.js";

export const LIVE_PATH = "/ws/live";

/** How often an open socket's sign-in is checked again, so a suspension disconnects it. */
export const REVALIDATE_MS = 60_000;

interface Watcher {
  socket: WebSocket;
  headers: Headers;
  /** Null for an admin (every venue); the venues a manager operates otherwise. */
  venueIds: Set<string> | null;
}

/**
 * The live view: routers' hotspot clients and provisioning transcripts, pushed to signed-in
 * staff. Guards do not run on a WebSocket upgrade, so this authenticates the upgrade request
 * itself, as the staff guard would (active staff; an admin only with an authenticator app),
 * and refuses other origins, since a browser sends the session cookie with a cross-site
 * socket too. The earlier `/ws/live` accepted anyone and sent them every venue.
 *
 * Hotspot updates carry guests' voucher codes and MAC addresses, so a manager receives only
 * their venues'; provisioning transcripts name no venue and go to admins only.
 */
@Injectable()
export class LiveHub implements OnModuleInit, OnApplicationShutdown {
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly watchers = new Set<Watcher>();
  private stopLog: (() => void) | null = null;
  private revalidation: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: PrismaService,
    @Inject(BETTER_AUTH) private readonly auth: Auth,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.stopLog = onRouterLog((event) => this.publishLog(event));
    this.revalidation = setInterval(() => {
      void this.revalidate().catch(captureFailure);
    }, REVALIDATE_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopLog?.();
    if (this.revalidation !== null) clearInterval(this.revalidation);
    for (const watcher of this.watchers) watcher.socket.close(1001, "server shutting down");
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Takes over WebSocket upgrades on `LIVE_PATH`; other upgrades are refused. */
  attach(http: Server): void {
    http.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      void this.upgrade(request, socket, head).catch((error: unknown) => {
        captureFailure(error);
        reject(socket, 500);
      });
    });
  }

  /** Whether anyone is watching, so routers are polled at full rate only then. */
  watching(): boolean {
    return this.watchers.size > 0;
  }

  publishHotspot(update: HotspotUpdate): void {
    const message: LiveMessage = update;
    this.send(message, (w) => w.venueIds === null || w.venueIds.has(update.venueId));
  }

  /** Signs every open socket in again; one whose sign-in no longer holds is closed. */
  async revalidate(): Promise<void> {
    for (const watcher of [...this.watchers]) {
      const venueIds = await this.authorise(watcher.headers);
      if (venueIds === false) {
        this.watchers.delete(watcher);
        watcher.socket.close(4401, "sign-in required");
      } else {
        watcher.venueIds = venueIds;
      }
    }
  }

  private async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const path = new URL(request.url ?? "/", "http://api").pathname;
    if (path !== LIVE_PATH) return reject(socket, 404);
    if (request.headers.origin !== this.config.frontendOrigin) return reject(socket, 403);
    const headers = fromNodeHeaders(request.headers);
    const venueIds = await this.authorise(headers);
    if (venueIds === false) return reject(socket, 401);
    this.server.handleUpgrade(request, socket, head, (ws) => {
      const watcher: Watcher = { socket: ws, headers, venueIds };
      this.watchers.add(watcher);
      ws.on("close", () => this.watchers.delete(watcher));
      ws.on("error", () => this.watchers.delete(watcher));
      // The live view only listens; anything a client sends is ignored.
    });
  }

  /**
   * The venues the session may watch (null for every venue), or false when it may not connect:
   * the same principal and policy as the HTTP API. The live view lists guests' devices, so the
   * platform, which sees them only as counts (ADR-0014), does not get it.
   */
  private async authorise(headers: Headers): Promise<Set<string> | null | false> {
    const principal = await principalFromSession(this.db, this.auth, headers);
    if (!principal || principal.access === "account") return false;
    if (!allows(principal.role, "session.read")) return false;
    const venues = await this.db.venue.findMany({
      where: venueScope(principal),
      select: { id: true },
    });
    return new Set(venues.map((v) => v.id));
  }

  private publishLog(event: RouterLogEvent): void {
    if (this.watchers.size === 0) return;
    const message: LiveMessage = {
      type: "provision_log",
      event: {
        runId: event.runId,
        seq: event.seq,
        at: event.at,
        level: event.level,
        phase: event.phase,
        scope: event.scope,
        message: event.message,
        command: event.command ?? null,
        params: event.params ?? null,
        durationMs: event.durationMs ?? null,
        outcome: event.outcome ?? null,
      },
    };
    this.send(message, (w) => w.venueIds === null);
  }

  private send(message: LiveMessage, to: (watcher: Watcher) => boolean): void {
    const payload = JSON.stringify(message);
    for (const watcher of this.watchers) {
      if (to(watcher) && watcher.socket.readyState === watcher.socket.OPEN) {
        watcher.socket.send(payload);
      }
    }
  }
}

function reject(socket: Duplex, status: 401 | 403 | 404 | 500): void {
  const text = { 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 500: "Server Error" };
  socket.end(
    `HTTP/1.1 ${status} ${text[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}
