import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { AuditLog } from "../../apps/api/src/core/audit/audit-log.js";
import { SecretBox } from "../../apps/api/src/core/crypto/secret-box.js";
import { createPrismaClient, type PrismaClient } from "../../apps/api/src/core/database/client.js";
import type { Prisma, Router } from "../../apps/api/src/generated/prisma/client.js";
import { RouterAccess } from "../../apps/api/src/network/mikrotik/router-credentials.js";
import { RouterLogger } from "../../apps/api/src/network/mikrotik/router-log.js";
import { RouterSync } from "../../apps/api/src/network/monitor/router-sync.js";
import {
  type BackendSettings,
  buildHotspotPlan,
  resolveBackendEndpoints,
} from "../../apps/api/src/network/provisioning/context.js";
import { dialectFor } from "../../apps/api/src/network/provisioning/dialect.js";
import {
  PORTAL_FILES,
  type PortalFileName,
  renderPortalFile,
} from "../../apps/api/src/network/provisioning/portal-files.js";
import { PrismaRouterStore } from "../../apps/api/src/network/provisioning/prisma-store.js";
import { probeRouter } from "../../apps/api/src/network/provisioning/probe.js";
import { setupRouter } from "../../apps/api/src/network/provisioning/setup.js";
import { probeVerify } from "../../apps/api/src/network/provisioning/verify.js";
import { storedSetup } from "../../apps/api/src/network/routers/router-journey.js";
import {
  API_PORT,
  API_USER,
  BACKEND_PORT,
  BACKEND_URL,
  HUB,
  IN_HUB,
  LAN,
  R,
  ROOT,
  readState,
  routerState,
  SIM_DATABASE,
  type SimRouter,
  type SimState,
  simBusinessId,
  simDatabaseUrl,
  simRouter,
  TUNNEL,
  writeState,
} from "./sim.ts";
import { run } from "./vm.ts";

// Setup and verification through the real provisioning code.

/** Whether the router is managed over the tunnel: its RADIUS and its API go through the hub. */
export function tunneled(state: SimState, sim: SimRouter = R): boolean {
  return routerState(state, sim).tunnelKey !== null;
}

/** The management URL the router uses to reach "the API" in this sim. */
export function managementUrl(state: SimState, sim: SimRouter = R): string {
  return tunneled(state, sim) ? `http://${TUNNEL.serverIp}:${BACKEND_PORT}` : BACKEND_URL;
}

/** The sim's backend settings, as the API takes them from its configuration. */
function simBackend(state: SimState, sim: SimRouter = R): BackendSettings {
  return {
    managementUrl: managementUrl(state, sim),
    portalOrigin: process.env.PORTAL_ORIGIN ?? null,
    listenPort: BACKEND_PORT,
  };
}

/**
 * Re-runs this command inside the hub when the router is managed over the tunnel, because only
 * the hub is on the platform side of it. Returns true when it did.
 */
export function delegateToHub(state: SimState, command: string, extra: string[] = []): boolean {
  if (!tunneled(state) || IN_HUB) return false;
  const env = ["-e", "SIM_IN_HUB=1"];
  if (process.env.PORTAL_ORIGIN) env.push("-e", `PORTAL_ORIGIN=${process.env.PORTAL_ORIGIN}`);
  const result = Bun.spawnSync(
    [
      "docker",
      "exec",
      "-u",
      `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      ...env,
      HUB.container,
      "bun",
      "tooling/router-sim/main.ts",
      command,
      ...extra,
      "--router",
      String(R.n),
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  process.exitCode = result.exitCode;
  return true;
}

/**
 * Router access as the API has it, except that without a tunnel the sim reaches the router's
 * API through QEMU's port forward rather than at its LAN address.
 */
class SimRouterAccess extends RouterAccess {
  override managementTarget(router: Router): { host: string; port: number } {
    if (router.tunnelAddress) return { host: router.tunnelAddress, port: API_PORT };
    const n = Number(router.name.match(/^hashinet-sim-(\d+)$/)?.[1] ?? 1);
    return { host: "127.0.0.1", port: simRouter(n).forward.api };
  }
}

/** Creates and migrates the sim database when needed. Runs on the host, before any hub run. */
export function ensureSimDatabase(): void {
  if (IN_HUB) return;
  const exists = Bun.spawnSync([
    "docker",
    "exec",
    "hashinet-postgres",
    "psql",
    "-U",
    "hashinet",
    "-d",
    "hashinet",
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname = '${SIM_DATABASE}'`,
  ]);
  if (exists.exitCode !== 0) {
    throw new Error("PostgreSQL is not running: start it with `bun run infra:up`.");
  }
  if (exists.stdout.toString().trim() !== "1") {
    run(["docker", "exec", "hashinet-postgres", "createdb", "-U", "hashinet", SIM_DATABASE]);
  }
  const migrate = Bun.spawnSync(["bun", "--bun", "prisma", "migrate", "deploy"], {
    cwd: join(ROOT, "apps", "api"),
    env: { ...process.env, DATABASE_URL: simDatabaseUrl() },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (migrate.exitCode !== 0) {
    throw new Error(`Migrating the sim database failed: ${migrate.stderr.toString().trim()}`);
  }
}

export interface SimServices {
  db: PrismaClient;
  access: RouterAccess;
  sync: RouterSync;
  store: PrismaRouterStore;
  router: Router;
}

/**
 * The API's own services on the sim database, with the router's row brought up to date from the
 * sim state (credentials sealed, tunnel address when there is a tunnel), at the sim's one venue.
 */
export async function simServices(sim: SimRouter = R): Promise<SimServices> {
  const state = readState();
  const mine = routerState(state, sim);
  if (!mine.apiPassword) {
    throw new Error(`Run \`bun run router-sim bootstrap --router ${sim.n}\` first.`);
  }
  const encryptionKey = state.encryptionKey ?? randomBytes(32).toString("hex");
  const box = new SecretBox(Buffer.from(encryptionKey, "hex"));
  const db = createPrismaClient(simDatabaseUrl());
  // Generous: the sim shares a machine that can be heavily loaded.
  const access = new SimRouterAccess(box, API_PORT, 30);
  const sync = new RouterSync(db, access, new AuditLog(db));
  const businessId = await simBusinessId(db);
  const venue =
    (state.venueId ? await db.venue.findUnique({ where: { id: state.venueId } }) : null) ??
    (await db.venue.create({
      data: { businessId, name: "Router sim venue", region: "Dar es Salaam", area: "Sim" },
    }));
  const fields = {
    name: sim.name,
    venueId: venue.id,
    ipAddress: LAN.routerIp,
    apiUsername: API_USER,
    apiPasswordEncrypted: box.seal(mine.apiPassword),
    // CHR has no radio: the hotspot runs on the guest-side ethernet port.
    hotspotInterface: "ether2",
    tunnelAddress: mine.tunnelKey ? sim.tunnelIp : null,
    tunnelPublicKey: mine.tunnelKey?.publicKey ?? null,
    tunnelPrivateKeyEncrypted: mine.tunnelKey ? box.seal(mine.tunnelKey.privateKey) : null,
  };
  // By name too: a router reset alone keeps its row, as a venue keeps a router it re-onboards.
  const existing =
    (mine.routerId ? await db.router.findUnique({ where: { id: mine.routerId } }) : null) ??
    (await db.router.findFirst({ where: { name: sim.name } }));
  const router = existing
    ? await db.router.update({ where: { id: existing.id }, data: fields })
    : await db.router.create({ data: fields });
  if (
    router.id !== mine.routerId ||
    encryptionKey !== state.encryptionKey ||
    venue.id !== state.venueId
  ) {
    const now = readState();
    writeState({
      ...now,
      encryptionKey,
      venueId: venue.id,
      routers: { ...now.routers, [String(sim.n)]: { ...mine, routerId: router.id } },
    });
  }
  return {
    db,
    access,
    sync,
    store: new PrismaRouterStore(db, access, box, simBackend(state, sim)),
    router,
  };
}

/** Serves the portal pages the router fetches, as the API's captive-portal route does. */
function serveBackend(state: SimState, routerId: string): ReturnType<typeof Bun.serve> {
  const origin = simBackend(state).portalOrigin ?? managementUrl(state);
  return Bun.serve({
    hostname: IN_HUB ? "0.0.0.0" : "127.0.0.1",
    port: BACKEND_PORT,
    async fetch(req) {
      const name = new URL(req.url).pathname.split("/").at(-1) ?? "";
      if (!(PORTAL_FILES as readonly string[]).includes(name)) {
        return new Response("not found", { status: 404 });
      }
      const body = await renderPortalFile(name as PortalFileName, origin, routerId);
      return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  });
}

function printEvents(logger: RouterLogger): void {
  for (const event of logger.events()) {
    if (event.level === "debug") continue;
    console.log(`  [${event.level}] ${event.message}`);
  }
}

export async function setup(): Promise<void> {
  const state = readState();
  ensureSimDatabase();
  if (delegateToHub(state, "setup")) return;
  const { db, store, router } = await simServices();
  const backend = serveBackend(state, router.id);
  try {
    const logger = new RouterLogger("provision");
    const report = await setupRouter(router.id, store, { force: false, logger });
    printEvents(logger);
    // As the API's Set up records it, so HashiNet counts the router as set up (it serves, sells,
    // and has its outages tracked).
    await db.router.update({
      where: { id: router.id },
      data: {
        lastSetup: storedSetup(report) as unknown as Prisma.InputJsonValue,
        lastSetupAt: new Date(),
      },
    });
    const saved = await db.router.findUniqueOrThrow({ where: { id: router.id } });
    console.log(
      `\nSetup ${report.ok ? "succeeded" : "FAILED"}${report.stoppedAt ? ` at ${report.stoppedAt}` : ""}.` +
        ` Database: router ${saved.status}, ${saved.rosVersion ?? "no version"}, ` +
        `provisioned ${saved.provisionedAt ? "yes" : "no"}.`,
    );
    for (const blocker of report.blockers)
      console.log(`  blocker: ${blocker.reason}\n    fix: ${blocker.fix}`);
    if (!report.ok) process.exitCode = 1;
  } finally {
    backend.stop(true);
    await db.$disconnect();
  }
}

export async function verify(): Promise<void> {
  const state = readState();
  ensureSimDatabase();
  if (delegateToHub(state, "verify")) return;
  const { db, access, router } = await simServices();
  try {
    const creds = access.credentials(router);
    if (!creds) throw new Error("The sim router has no usable credentials");
    const logger = new RouterLogger("probe");
    const profile = await probeRouter(creds, logger);
    const report = await probeVerify(creds, logger, {
      routerId: router.id,
      dialect: dialectFor(profile),
      plan: buildHotspotPlan(router, profile),
      endpoints: resolveBackendEndpoints(router.ipAddress, simBackend(state)),
    });
    for (const check of report.checks) {
      console.log(
        `  ${check.status.padEnd(7)} ${check.title}${check.status === "pass" ? "" : ` — ${check.detail}`}`,
      );
    }
    console.log(
      `\nVerify: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail.`,
    );
    if (!report.ok) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
