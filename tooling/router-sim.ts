// The router sim: a MikroTik Cloud Hosted Router (CHR) in QEMU, standing in for a venue's router
// so onboarding, provisioning and verification run against real RouterOS without hardware.
// Procedure and topology: docs/runbooks/router-sim.md.
//
// bun run router-sim <up|down|reset|status|console|hub|bootstrap|setup|verify|voucher|guest|guest-test> [--router <n>]

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { Principal } from "../apps/api/src/access/principal.js";
import { AuditLog } from "../apps/api/src/audit/audit-log.js";
import { SecretBox } from "../apps/api/src/crypto/secret-box.js";
import { createPrismaClient, type PrismaClient } from "../apps/api/src/database/client.js";
import type { PrismaService } from "../apps/api/src/database/prisma.service.js";
import type { Prisma, Router } from "../apps/api/src/generated/prisma/client.js";
import { bootstrapPlatform } from "../apps/api/src/platform/bootstrap.js";
import { storedSetup } from "../apps/api/src/routers/router-journey.js";
import {
  closeConnection,
  connectToRouter,
  type MikroTikConn,
} from "../apps/api/src/services/mikrotik.js";
import { RouterAccess } from "../apps/api/src/services/router-credentials.js";
import { RouterLogger } from "../apps/api/src/services/router-log.js";
import { buildBootstrapScript } from "../apps/api/src/services/router-provision/bootstrap.js";
import {
  type BackendSettings,
  buildHotspotPlan,
  portalOriginFor,
  resolveBackendEndpoints,
} from "../apps/api/src/services/router-provision/context.js";
import { dialectFor } from "../apps/api/src/services/router-provision/dialect.js";
import {
  PORTAL_FILES,
  type PortalFileName,
  renderPortalFile,
} from "../apps/api/src/services/router-provision/portal-files.js";
import { PrismaRouterStore } from "../apps/api/src/services/router-provision/prisma-store.js";
import { probeRouter } from "../apps/api/src/services/router-provision/probe.js";
import { toRows } from "../apps/api/src/services/router-provision/ros-client.js";
import { setupRouter } from "../apps/api/src/services/router-provision/setup.js";
import {
  generateWireguardKeyPair,
  type WireguardKeyPair,
} from "../apps/api/src/services/router-provision/tunnel.js";
import { probeVerify } from "../apps/api/src/services/router-provision/verify.js";
import { RouterSync } from "../apps/api/src/services/router-sync.js";
import { SessionsService } from "../apps/api/src/sessions/sessions.service.js";
import { VouchersService } from "../apps/api/src/vouchers/vouchers.service.js";
import { serveRadius } from "../apps/tunnel/src/radius-relay.js";

const ROOT = resolve(import.meta.dir, "..");
const SIM = join(ROOT, "data", "router-sim");
const ROS_VERSION = "7.25";
const BASE_IMAGE = join(SIM, `chr-${ROS_VERSION}.img`);
const STATE_FILE = join(SIM, "state.json");

/** The sim venue LAN is QEMU's user network: the host is the "ISP router" at 10.0.2.2. */
const LAN = { routerIp: "10.0.2.15", prefix: 24, gatewayIp: "10.0.2.2" } as const;
/** The host side of 10.0.2.2:4006, where the router fetches its portal pages. */
const BACKEND_PORT = 4006;
const BACKEND_URL = `http://${LAN.gatewayIp}:${BACKEND_PORT}`;
const API_USER = "hashinet";
/**
 * The sim's own database on the compose.yml PostgreSQL, migrated by the real migrations. From
 * inside the hub container the host's loopback is not reachable, so the hub joins the compose
 * network and reaches PostgreSQL by its container name.
 */
const SIM_DATABASE = "hashinet_sim";
const COMPOSE_NETWORK = "hashinet_default";
function simDatabaseUrl(): string {
  return IN_HUB
    ? `postgresql://hashinet:hashinet@hashinet-postgres:5432/${SIM_DATABASE}`
    : `postgresql://hashinet:hashinet@127.0.0.1:5438/${SIM_DATABASE}`;
}
const API_PORT = 8728;
/** The guest VM's address, fixed by a static lease while the demo runs. */
const GUEST_IP = "10.5.50.254";

/**
 * The management tunnel. The hub container stands in for the platform: each router dials it at
 * 10.0.2.2:51820 (QEMU's user network, outbound only, like carrier-grade NAT), and the sim
 * reaches the routers through the tunnel alone. RADIUS comes back through it too, so the relay
 * tells the routers apart by their tunnel addresses.
 */
const TUNNEL = { serverIp: "10.88.0.1", prefix: 24, port: 51820 } as const;
const HUB = { container: "hashinet-router-sim-hub", image: "hashinet-router-sim-hub:1" } as const;
/** Set when this process runs inside the hub container, on the platform side of the tunnel. */
const IN_HUB = process.env.SIM_IN_HUB === "1";

/**
 * One router of the sim's venue, with its guest VM. Router 1 keeps the names and ports the sim had
 * with a single router; each further router has its own overlay, sockets, forwarded ports, guest
 * link, MAC addresses and tunnel address, so two run side by side.
 */
interface SimRouter {
  n: number;
  name: string;
  overlay: string;
  serial: string;
  monitor: string;
  pidFile: string;
  /** Host ports forwarded to the router's RouterOS API, SSH and WinBox. */
  forward: { api: number; ssh: number; winbox: number };
  /** UDP ports on 127.0.0.1 carrying the guest link (router ether2 <-> guest eth0). */
  guestLink: { router: number; guest: number };
  tunnelIp: string;
  macs: { lan: string; guests: string };
  guest: { serial: string; pid: string; mac: string };
}

function simRouter(n: number): SimRouter {
  const suffix = n === 1 ? "" : `-${n}`;
  const step = 10 * (n - 1);
  const octet = (n - 1).toString(16).padStart(2, "0");
  return {
    n,
    name: `hashinet-sim${suffix}`,
    overlay: join(SIM, `sim${suffix}.qcow2`),
    serial: join(SIM, `serial${suffix}.sock`),
    monitor: join(SIM, `monitor${suffix}.sock`),
    pidFile: join(SIM, `qemu${suffix}.pid`),
    forward: { api: 18728 + step, ssh: 18022 + step, winbox: 18291 + step },
    guestLink: { router: 18100 + step, guest: 18101 + step },
    tunnelIp: `10.88.0.${n + 1}`,
    macs: { lan: `52:54:00:4a:${octet}:01`, guests: `52:54:00:4a:${octet}:02` },
    guest: {
      serial: join(SIM, `guest-serial${suffix}.sock`),
      pid: join(SIM, `guest${suffix}.pid`),
      mac: `52:54:00:4A:${octet.toUpperCase()}:10`,
    },
  };
}

/** `--router <n>` picks the router a command acts on; without it, router 1. */
const ARGV = process.argv.slice(2);
const ROUTER_FLAG = ARGV.indexOf("--router");
const ROUTER_N = ROUTER_FLAG === -1 ? 1 : Number(ARGV[ROUTER_FLAG + 1]);
if (!Number.isInteger(ROUTER_N) || ROUTER_N < 1 || ROUTER_N > 9) {
  throw new Error("--router takes a router number from 1 to 9");
}
if (ROUTER_FLAG !== -1) ARGV.splice(ROUTER_FLAG, 2);
const R = simRouter(ROUTER_N);

interface RouterState {
  adminPassword: string | null;
  apiPassword: string | null;
  /** Its WireGuard keys, when it was bootstrapped with the management tunnel. */
  tunnelKey: WireguardKeyPair | null;
  /** Its row in the sim database. */
  routerId: string | null;
}

/** What the sim's routers share, and each router's own, in one file. */
interface SimState {
  /** The sim's encryption key (hex), sealing every router's credentials in its database. */
  encryptionKey: string | null;
  /** The hub's WireGuard keys: every router's tunnel peer. */
  hubKey: WireguardKeyPair | null;
  /** The relay's bearer secret to the sim API (`TUNNEL_SYNC_SECRET`). Never printed. */
  syncSecret: string | null;
  /** The venue every sim router serves, so one voucher spans them. */
  venueId: string | null;
  routers: Record<string, RouterState>;
}

const NO_ROUTER: RouterState = {
  adminPassword: null,
  apiPassword: null,
  tunnelKey: null,
  routerId: null,
};

function readState(): SimState {
  const empty: SimState = {
    encryptionKey: null,
    hubKey: null,
    syncSecret: null,
    venueId: null,
    routers: {},
  };
  if (!existsSync(STATE_FILE)) return empty;
  const stored: Partial<SimState> = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  return { ...empty, ...stored };
}

function writeState(state: SimState): void {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function routerState(state: SimState, sim: SimRouter = R): RouterState {
  return { ...NO_ROUTER, ...state.routers[String(sim.n)] };
}

/** Saves a change to one router's state, keeping the rest of the file as it now stands. */
function saveRouter(change: Partial<RouterState>, sim: SimRouter = R): void {
  const state = readState();
  writeState({
    ...state,
    routers: { ...state.routers, [String(sim.n)]: { ...routerState(state, sim), ...change } },
  });
}

function randomPassword(length: number): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function livePid(file: string): number | null {
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, "utf8").trim());
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function qemuPid(sim: SimRouter = R): number | null {
  return livePid(sim.pidFile);
}

async function up(): Promise<void> {
  if (qemuPid() !== null) {
    console.log(`Router sim ${R.n} is already running.`);
    return;
  }
  if (!existsSync(BASE_IMAGE)) {
    throw new Error(
      `Missing ${BASE_IMAGE}. Download and verify the CHR image first (docs/runbooks/router-sim.md).`,
    );
  }
  mkdirSync(SIM, { recursive: true });
  if (!existsSync(R.overlay)) {
    run(["qemu-img", "create", "-q", "-f", "qcow2", "-b", BASE_IMAGE, "-F", "raw", R.overlay]);
  }
  const forwards = [
    `hostfwd=tcp:127.0.0.1:${R.forward.api}-:8728`,
    `hostfwd=tcp:127.0.0.1:${R.forward.ssh}-:22`,
    `hostfwd=tcp:127.0.0.1:${R.forward.winbox}-:8291`,
  ].join(",");
  run([
    "qemu-system-x86_64",
    "-name",
    R.name,
    "-enable-kvm",
    "-m",
    "256",
    "-smp",
    "1",
    "-drive",
    `file=${R.overlay},if=virtio,format=qcow2`,
    // ether1: the venue LAN, uplink to the "ISP router". Each router has a user network of its own.
    "-netdev",
    `user,id=lan,net=10.0.2.0/${LAN.prefix},host=${LAN.gatewayIp},${forwards}`,
    "-device",
    `virtio-net-pci,netdev=lan,mac=${R.macs.lan}`,
    // ether2: the guest network, a point-to-point UDP link to the guest VM. Not multicast: the
    // host may route multicast into a VPN (Cloudflare WARP did), where it never loops back.
    "-netdev",
    `socket,id=guests,udp=127.0.0.1:${R.guestLink.guest},localaddr=127.0.0.1:${R.guestLink.router}`,
    "-device",
    `virtio-net-pci,netdev=guests,mac=${R.macs.guests}`,
    "-display",
    "none",
    "-serial",
    `unix:${R.serial},server=on,wait=off`,
    "-monitor",
    `unix:${R.monitor},server=on,wait=off`,
    "-pidfile",
    R.pidFile,
    "-daemonize",
  ]);
  const serial = await SerialConsole.open();
  await serial.waitFor(/Login:\s*$/, 120_000);
  serial.close();
  console.log(
    `Router sim ${R.n} is up: RouterOS ${ROS_VERSION}, API on 127.0.0.1:${R.forward.api}.`,
  );
}

function down(): void {
  const pid = qemuPid();
  if (pid === null) {
    console.log(`Router sim ${R.n} is not running.`);
    return;
  }
  process.kill(pid, "SIGTERM");
  console.log(`Router sim ${R.n} stopped.`);
}

/**
 * A factory-fresh router. Router 1 starts the whole sim again, its database included, so a new
 * venue starts without the old one's vouchers; any other router is replaced alone, keeping its
 * database row (found again by name) and the venue.
 */
async function reset(): Promise<void> {
  down();
  await Bun.sleep(1000);
  rmSync(R.overlay, { force: true });
  const state = readState();
  const routers = { ...state.routers };
  delete routers[String(R.n)];
  if (R.n === 1) {
    for (const key of Object.keys(routers)) {
      routers[key] = { ...NO_ROUTER, ...routers[key], routerId: null };
    }
    if (!IN_HUB) {
      Bun.spawnSync([
        "docker",
        "exec",
        "hashinet-postgres",
        "dropdb",
        "-U",
        "hashinet",
        "--if-exists",
        "--force",
        SIM_DATABASE,
      ]);
    }
  }
  writeState({ ...state, venueId: R.n === 1 ? null : state.venueId, routers });
  await up();
}

function run(cmd: string[]): void {
  const result = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${cmd[0]} failed: ${result.stderr.toString().trim()}`);
  }
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips the terminal's ANSI escape sequences
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b[=>]|\r/g;

/** The router's serial console, driven the way an operator would type into a terminal. */
class SerialConsole {
  private buffer = "";
  private socket: Bun.Socket<undefined> | null = null;

  static async open(path: string = R.serial): Promise<SerialConsole> {
    const serial = new SerialConsole();
    serial.socket = await Bun.connect({
      unix: path,
      socket: {
        data: (_socket, data) => {
          serial.buffer += data.toString("utf8");
        },
      },
    });
    return serial;
  }

  send(text: string): void {
    this.socket?.write(text);
  }

  close(): void {
    this.socket?.end();
  }

  /** Waits until the cleaned output matches, and returns everything received until then. */
  async waitFor(pattern: RegExp, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const text = this.buffer.replace(ANSI, "");
      if (pattern.test(text)) {
        this.buffer = "";
        return text;
      }
      await Bun.sleep(50);
    }
    const tail = this.buffer.replace(ANSI, "").slice(-300);
    throw new Error(
      `Timed out waiting for ${pattern} on the serial console. Last output:\n${tail}`,
    );
  }

  /**
   * Logs in as admin, answering first-login prompts. Tries each candidate password in turn,
   * and sets `newPassword` when RouterOS insists on a change.
   */
  async login(candidates: string[], newPassword: string): Promise<void> {
    const remaining = [...candidates];
    this.send("\r");
    for (let i = 0; i < 20; i++) {
      const text = await this.waitFor(
        /(Login:|Password:|\[Y\/n\]:|-- press Enter \(q to abort\)|repeat new password>|new password>|\[admin@[^\]]+\] >)\s*$/,
        60_000,
      );
      if (/\[admin@[^\]]+\] >\s*$/.test(text)) return;
      if (/Login:\s*$/.test(text)) {
        if (/incorrect username or password/.test(text) && remaining.length === 0) {
          throw new Error("Serial login failed with every known admin password");
        }
        this.send("admin\r");
      } else if (/Password:\s*$/.test(text)) {
        this.send(`${remaining.shift() ?? ""}\r`);
      } else if (/\[Y\/n\]:\s*$/.test(text)) {
        this.send("n");
      } else if (/press Enter/.test(text)) {
        this.send("q");
      } else {
        this.send(`${newPassword}\r`);
      }
    }
    throw new Error("Serial login did not reach a prompt");
  }

  /** Runs one console statement and returns its output, failing on a RouterOS error. */
  async exec(statement: string, timeoutMs = 60_000): Promise<string> {
    let output = "";
    this.send(`${statement}\r`);
    // Long output opens RouterOS's pager, which would swallow anything typed next: page on with
    // space until the command returns to the prompt. (Its D writes the rest to a file instead.)
    for (;;) {
      const text = await this.waitFor(/(-- \[Q quit\|D dump\|down\]|\] >)\s*$/, timeoutMs);
      output += text;
      if (!/-- \[Q quit\|D dump\|down\]\s*$/.test(text)) break;
      this.send(" ");
    }
    // The prompt can also be a redraw before the command finishes; a marker proves it has.
    const marker = `SIM-DONE-${crypto.randomUUID().slice(0, 8)}`;
    this.send(`:put "${marker}"\r`);
    const rest = await this.waitFor(new RegExp(`\\n${marker}\\n[\\s\\S]*\\] >\\s*$`), timeoutMs);
    output += rest.slice(0, rest.lastIndexOf(`\n${marker}`));
    if (
      /(syntax error|failure:|bad command name|expected end of command|no such item)/i.test(output)
    ) {
      throw new Error(`RouterOS rejected: ${statement.slice(0, 120)}\n${output.trim()}`);
    }
    return output;
  }
}

// Onboarding (docs/runbooks/router-onboarding.md).

/** Step 1: reset to no defaults, as the onboarding procedure requires, then log back in. */
async function resetToNoDefaults(serial: SerialConsole, adminPassword: string): Promise<void> {
  await serial.login([adminPassword, ""], adminPassword);
  serial.send("/system reset-configuration no-defaults=yes skip-backup=yes\r");
  await serial.waitFor(/\[y\/N\]:\s*$/, 30_000);
  serial.send("y");
  await serial.waitFor(/Login:\s*$/, 180_000);
  await serial.login(["", adminPassword], adminPassword);
}

/**
 * Onboards the sim from a script downloaded from a real HashiNet, as an operator would paste it.
 * The script holds the router's credentials and tunnel key, so nothing from it is printed.
 */
async function importScript(): Promise<void> {
  const path = args[0];
  if (!path) throw new Error("Usage: bun run router-sim import <bootstrap .rsc>");
  const statements = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  const adminPassword = routerState(readState()).adminPassword ?? randomPassword(20);
  const serial = await SerialConsole.open();
  await resetToNoDefaults(serial, adminPassword);
  for (const statement of statements) await serial.exec(statement);
  serial.close();
  saveRouter({ adminPassword });
  console.log(`Imported ${statements.length} statements.`);
}

async function bootstrap(): Promise<void> {
  const state = readState();
  const tunnel = args.includes("--tunnel")
    ? { router: generateWireguardKeyPair(), server: state.hubKey ?? generateWireguardKeyPair() }
    : null;
  // Every router dials the same hub, so the hub's key is the sim's, made by the first to need it.
  if (tunnel && state.hubKey === null) writeState({ ...state, hubKey: tunnel.server });
  const adminPassword = routerState(state).adminPassword ?? randomPassword(20);
  const apiPassword = randomPassword(24);
  const serial = await SerialConsole.open();
  await resetToNoDefaults(serial, adminPassword);

  // Step 2: paste the generated bootstrap script, one statement at a time.
  const { script, resolved } = buildBootstrapScript({
    routerName: R.name,
    ipAddress: LAN.routerIp,
    lanPrefix: LAN.prefix,
    gatewayIp: LAN.gatewayIp,
    apiUsername: API_USER,
    apiPassword,
    apiPort: API_PORT,
    tunnel: tunnel && {
      routerPrivateKey: tunnel.router.privateKey,
      routerAddress: `${R.tunnelIp}/${TUNNEL.prefix}`,
      serverPublicKey: tunnel.server.publicKey,
      serverAddress: TUNNEL.serverIp,
      endpointHost: LAN.gatewayIp,
      endpointPort: TUNNEL.port,
    },
  });
  const statements = script
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  for (const statement of statements) {
    const output = await serial.exec(statement);
    // Keep what the statement printed; drop the console's echo and prompt redraws.
    const shown = output
      .split("\n")
      .filter((line) => !line.includes("] >") && !line.includes("SIM-DONE"))
      .join("\n")
      .trim();
    console.log(`✓ ${statement.slice(0, 90)}${statement.length > 90 ? " …" : ""}`);
    if (shown) console.log(`    ${shown.replaceAll("\n", "\n    ")}`);
  }
  serial.close();
  saveRouter({
    adminPassword,
    apiPassword: resolved.apiPassword,
    tunnelKey: tunnel?.router ?? null,
  });
  console.log(
    `Bootstrap applied: ${statements.length} statements, API user "${API_USER}"` +
      `${tunnel ? `, management tunnel to ${LAN.gatewayIp}:${TUNNEL.port}` : ""}.`,
  );
  if (tunnel) console.log("Start or refresh the platform side with `bun run router-sim hub up`.");
}

// Setup and verification through the real provisioning code.

/** Whether the router is managed over the tunnel: its RADIUS and its API go through the hub. */
function tunneled(state: SimState, sim: SimRouter = R): boolean {
  return routerState(state, sim).tunnelKey !== null;
}

/** The management URL the router uses to reach "the API" in this sim. */
function managementUrl(state: SimState, sim: SimRouter = R): string {
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
function delegateToHub(state: SimState, command: string, extra: string[] = []): boolean {
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
      "tooling/router-sim.ts",
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
function ensureSimDatabase(): void {
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

interface SimServices {
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
async function simServices(sim: SimRouter = R): Promise<SimServices> {
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

async function setup(): Promise<void> {
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

async function verify(): Promise<void> {
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

// Guest: a client on the hotspot segment, standing in for a phone. Each router has its own.

const GUEST_ISO = join(SIM, "alpine-virt-3.24.3-x86_64.iso");
const HOTSPOT_GATEWAY = "10.5.50.1";

/** The guest's shell over its serial console. */
class GuestShell {
  private constructor(private readonly serial: SerialConsole) {}

  static async open(sim: SimRouter = R): Promise<GuestShell> {
    const serial = await SerialConsole.open(sim.guest.serial);
    serial.send("\r");
    const text = await serial.waitFor(/(login:|# )\s*$/, 120_000);
    if (/login:\s*$/.test(text)) {
      serial.send("root\r");
      await serial.waitFor(/# \s*$/, 30_000);
    }
    return new GuestShell(serial);
  }

  /** Runs a shell command and returns its output and exit status. */
  async run(command: string, timeoutMs = 60_000): Promise<{ output: string; status: number }> {
    const marker = `SIM-DONE-${crypto.randomUUID().slice(0, 8)}`;
    // printf starts the marker on a fresh line: output cut short (head -c) has no final newline.
    this.serial.send(`${command}; printf '\\n%s %d\\n' ${marker} $?\r`);
    const text = await this.serial.waitFor(new RegExp(`\\n${marker} (\\d+)\\n`), timeoutMs);
    const match = text.match(new RegExp(`\\n${marker} (\\d+)\\n`));
    const body = text.slice(0, match?.index ?? text.length);
    // Drop the echoed command line.
    const output = body.slice(body.indexOf("\n") + 1);
    return { output, status: Number(match?.[1] ?? 1) };
  }

  close(): void {
    this.serial.close();
  }
}

function guest(): void {
  const action = args[0] ?? "up";
  if (action === "down") {
    const pid = livePid(R.guest.pid);
    if (pid !== null) process.kill(pid, "SIGTERM");
    console.log(`Guest ${R.n} stopped.`);
    return;
  }
  if (livePid(R.guest.pid) !== null) {
    console.log(`Guest ${R.n} is already running.`);
    return;
  }
  if (!existsSync(GUEST_ISO)) {
    throw new Error(`Missing ${GUEST_ISO}. See docs/runbooks/router-sim.md (Guest).`);
  }
  run([
    "qemu-system-x86_64",
    "-name",
    `${R.name}-guest`,
    "-enable-kvm",
    "-m",
    "256",
    "-smp",
    "1",
    "-cdrom",
    GUEST_ISO,
    "-boot",
    "d",
    // The other end of the router's ether2 link: a client of the hotspot and nothing else.
    "-netdev",
    `socket,id=guests,udp=127.0.0.1:${R.guestLink.router},localaddr=127.0.0.1:${R.guestLink.guest}`,
    "-device",
    // Its own MAC: two guests are two devices to HashiNet, which knows a device by its MAC.
    `virtio-net-pci,netdev=guests,mac=${R.guest.mac.toLowerCase()}`,
    "-display",
    "none",
    "-serial",
    `unix:${R.guest.serial},server=on,wait=off`,
    "-pidfile",
    R.guest.pid,
    "-daemonize",
  ]);
  console.log(`Guest ${R.n} is booting.`);
}

/**
 * Sells a voucher the way the API will: a package (one device online at a time) and a voucher row
 * at the sim's venue. Nothing goes to a router: RADIUS answers from the voucher (ADR-0015).
 */
async function issueVoucher(db: PrismaClient, venueId: string, minutes: number): Promise<string> {
  const pkg = await db.package.create({
    data: {
      businessId: await simBusinessId(db),
      name: `Sim ${minutes} min`,
      durationMinutes: minutes,
      downloadSpeedMbps: 2,
      uploadSpeedMbps: 1,
      priceTsh: "500",
    },
  });
  const code = `SIM${randomPassword(6).toUpperCase()}`;
  await db.voucher.create({
    data: { code, venueId, packageId: pkg.id, priceTsh: pkg.priceTsh, durationMinutes: minutes },
  });
  return code;
}

/** Prints `VOUCHER=<code>`, a voucher for the sim's venue. */
async function voucher(): Promise<void> {
  ensureSimDatabase();
  if (delegateToHub(readState(), "voucher", args)) return;
  const { db, router } = await simServices();
  try {
    console.log(`VOUCHER=${await issueVoucher(db, router.venueId, Number(args[0] ?? 1))}`);
  } finally {
    await db.$disconnect();
  }
}

/** Runs one shell command on the guest and prints its output. */
async function guestRun(): Promise<void> {
  const shell = await GuestShell.open();
  try {
    const { output, status } = await shell.run(args.join(" "), 60_000);
    console.log(output.trimEnd());
    if (status !== 0) process.exitCode = status;
  } finally {
    shell.close();
  }
}

/**
 * The real API on the sim database. In the hub it reaches every router through the tunnel, as
 * production does, and answers the relay's RADIUS under the sim's sync secret; on the host it
 * reaches router 1 through its port forward.
 */
async function startApi(
  state: SimState,
  stableAuth = false,
  fakeProviders = true,
): Promise<ReturnType<typeof Bun.spawn>> {
  const api = Bun.spawn(["bun", "apps/api/src/entrypoint.ts"], {
    cwd: ROOT,
    stdout: "ignore",
    stderr: "inherit",
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "development",
      PORT: String(BACKEND_PORT),
      FAKE_PROVIDERS: String(fakeProviders),
      DATABASE_URL: simDatabaseUrl(),
      ENCRYPTION_KEY: state.encryptionKey ?? "",
      // Derived like the auth secret, so a PIN given out survives a restart of the demo.
      PIN_KEY: createHash("sha256").update(`pin:${state.encryptionKey}`).digest("hex"),
      // The demo's sign-ins and authenticators outlive a restart.
      BETTER_AUTH_SECRET: stableAuth
        ? createHash("sha256").update(`auth:${state.encryptionKey}`).digest("hex")
        : randomBytes(32).toString("hex"),
      ROUTER_MANAGEMENT_URL: managementUrl(state),
      MIKROTIK_CONNECT_TIMEOUT: "30",
      ...(process.env.PORTAL_ORIGIN ? { PORTAL_ORIGIN: process.env.PORTAL_ORIGIN } : {}),
      ...(IN_HUB
        ? { TUNNEL_SYNC_SECRET: state.syncSecret ?? "" }
        : { MIKROTIK_TARGET_OVERRIDE: `127.0.0.1:${simRouter(1).forward.api}` }),
    },
  });
  for (let i = 0; i < 120; i++) {
    const up = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health`).catch(() => null);
    if (up?.ok) return api;
    await Bun.sleep(500);
  }
  api.kill();
  throw new Error("The API did not start");
}

/** The latest sign-in code the API wrote to the outbox: there is no real email in development. */
function latestCode(): void {
  const outbox = join(ROOT, "data", "email");
  const newest = readdirSync(outbox)
    .map((name) => ({ name, time: statSync(join(outbox, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
    .map(({ name }) => readFileSync(join(outbox, name), "utf8"))
    .find((text) => /\b\d{6}\b/.test(text));
  console.log(newest?.match(/\b\d{6}\b/)?.[0] ?? "No code yet: ask for one on the sign-in page.");
}

/**
 * Everything together, to use in a browser: the router, a guest device, the API and the web. The
 * browser stands in for the guest's phone, naming the guest VM. Runs until stopped.
 */
async function demo(): Promise<void> {
  const state = readState();
  if (tunneled(state)) throw new Error("The demo runs the API on this machine: use LAN mode.");
  if (!routerState(state).apiPassword) {
    throw new Error("Run `reset`, `bootstrap` and `setup` first.");
  }
  if (qemuPid() === null) await up();
  const booting = livePid(R.guest.pid) === null;
  if (booting) guest();
  if (booting) await Bun.sleep(25_000);

  const services = await simServices();
  const email = "admin@example.com";
  await bootstrapPlatform(services.db, { email, name: "Demo Admin" });
  const code = await issueVoucher(services.db, services.router.venueId, 60);

  // Test runs leave a package each; a guest should see what a venue would really sell.
  await services.db.package.updateMany({
    where: { name: { startsWith: "Sim " } },
    data: { isActive: false },
  });
  const packages = [
    { name: "1 Hour", durationMinutes: 60, downloadSpeedMbps: 5, priceTsh: "1000" },
    { name: "1 Day", durationMinutes: 1440, downloadSpeedMbps: 10, priceTsh: "1500" },
    { name: "1 Week", durationMinutes: 10080, downloadSpeedMbps: 10, priceTsh: "8000" },
  ];
  for (const pkg of packages) {
    if (!(await services.db.package.findFirst({ where: { name: pkg.name } }))) {
      await services.db.package.create({
        data: { ...pkg, businessId: await simBusinessId(services.db) },
      });
    }
  }

  // `demo payments` adds the stand-in providers; by default it is what launches: selling at the counter.
  const api = await startApi(state, true, args[0] === "payments");
  const web = Bun.spawn(["bun", "run", "--filter", "@hashinet/web", "dev"], {
    cwd: ROOT,
    stdout: "ignore",
    stderr: "ignore",
  });
  const stop = () => {
    api.kill();
    web.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // The guest link names the device, so its address must not move while the demo runs.
  const creds = services.access.credentials(services.router);
  if (!creds) throw new Error("The sim router has no usable credentials");
  const conn = await connectToRouter(creds);
  // Start signed out: a device already online cannot redeem or buy.
  for (const menu of ["/ip/hotspot/active", "/ip/hotspot/cookie"]) {
    for (const row of toRows(await conn.write(`${menu}/print`))) {
      await conn.write(`${menu}/remove`, [`=.id=${row.get(".id") ?? ""}`]);
    }
  }
  const leases = "/ip/dhcp-server/lease";
  for (const lease of toRows(
    await conn.write(`${leases}/print`, [`?mac-address=${R.guest.mac}`]),
  )) {
    await conn.write(`${leases}/remove`, [`=.id=${lease.get(".id") ?? ""}`]);
  }
  await conn.write(`${leases}/add`, [
    `=mac-address=${R.guest.mac}`,
    `=address=${GUEST_IP}`,
    "=server=wbs-hs-dhcp",
  ]);

  // The router forgets a host idle for 5 minutes, and a real phone is never that quiet.
  const shell = await GuestShell.open();
  await shell.run(
    "ip link set eth0 up; ip addr flush dev eth0; udhcpc -i eth0 -n -q -t 4 -T 2 2>&1 | tail -1",
    30_000,
  );
  await shell.run(
    "kill $(cat /tmp/keepalive 2>/dev/null) 2>/dev/null; " +
      "(while :; do wget -q -T 5 -O /dev/null http://example.com/; sleep 60; done) >/dev/null 2>&1 & " +
      "echo $! > /tmp/keepalive",
  );
  shell.close();
  await Bun.sleep(3_000);
  await closeConnection(conn);

  const fragment = new URLSearchParams({
    router: services.router.id,
    mac: R.guest.mac,
    ip: GUEST_IP,
    "link-orig": "https://example.com/",
  });
  console.log(`
HashiNet is running. Stop with Ctrl-C.

  Admin    http://localhost:3006
           Sign in as ${email}. Get the emailed code with: bun run router-sim code
  Guest    http://localhost:3006/join#${fragment}
           A voucher to try: ${code}
`);
  await new Promise(() => {});
}

/** A page fetched by a guest: the open internet, the portal, or neither. */
interface Page {
  internet: boolean;
  portal: string | null;
  raw: string;
}

/** One guest on one router, as the guest test drives them. */
class GuestAt {
  mac = "";
  ip = "";
  routerId = "";

  constructor(
    readonly sim: SimRouter,
    readonly shell: GuestShell,
    readonly services: SimServices,
    private readonly portalOrigin: string,
  ) {}

  /** Asks for an address, as a phone joining the network does, until it has one. */
  async join(): Promise<string | null> {
    await this.shell.run("ip link set eth0 up");
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.shell.run("udhcpc -i eth0 -n -q -t 4 -T 2 2>&1 | tail -1", 30_000);
      const shown = await this.shell.run("ip -4 -o addr show eth0", 10_000);
      const address = shown.output.match(/inet (10\.5\.50\.\d+)/)?.[1] ?? null;
      if (address) return address;
      await Bun.sleep(3_000);
    }
    return null;
  }

  /** Fetches a page in full and reports what it is. */
  async fetchPage(url = "http://example.com/"): Promise<Page> {
    const result = await this.shell.run(
      `rm -f /tmp/page; wget -q -T 8 -O /tmp/page '${url}' 2>&1 | head -c 300; ` +
        // printf formats keep the result words out of the echoed command line, which the serial
        // console prints back and which would otherwise match.
        "grep -q 'Example Domain' /tmp/page && printf 'PAGE=%s\\n' internet; " +
        "grep -o 'https\\?://[^\"]*/join' /tmp/page | head -1 | sed 's/^/PORTAL /'",
      30_000,
    );
    return {
      internet: result.output.includes("PAGE=internet"),
      portal: result.output.match(/PORTAL (https?:\/\/\S+)/)?.[1] ?? null,
      raw: result.output.trim(),
    };
  }

  /** Reads the router, the MAC and the address the router's redirect named, as the portal does. */
  async readRedirect(): Promise<void> {
    const redirect = (
      await this.shell.run("grep -oE '(router=|&mac=|&ip=)[^\"&]*' /tmp/page", 15_000)
    ).output;
    const named = (pattern: RegExp) => redirect.match(pattern)?.[1] ?? "";
    this.routerId = named(/router=([0-9a-f-]{36})/);
    this.mac = named(/&mac=([0-9A-F:]{17})/);
    this.ip = named(/&ip=(\d+\.\d+\.\d+\.\d+)/);
  }

  /**
   * Posts JSON to the API through the walled garden, as the portal page does, over plain HTTP with
   * nc: BusyBox wget prints no body on an error, and the error's code is what the test reads.
   * BusyBox nc hangs up when its input ends, before any reply, so its input stays open until the
   * reply is in.
   */
  async post(path: string, body: object): Promise<{ status: number; code: string; text: string }> {
    const url = new URL(this.portalOrigin);
    const json = JSON.stringify(body);
    const result = await this.shell.run(
      `rm -f /tmp/reply; (printf 'POST ${path} HTTP/1.0\\r\\nHost: ${url.host}\\r\\n` +
        `Content-Type: application/json\\r\\nContent-Length: ${Buffer.byteLength(json)}\\r\\n\\r\\n%s' '${json}'; ` +
        "i=0; while [ $i -lt 60 ] && ! grep -q '^HTTP/' /tmp/reply 2>/dev/null; do sleep 1; i=$((i+1)); done; sleep 1) | " +
        `nc -w 60 ${url.hostname} ${url.port || "80"} > /tmp/reply; head -c 1200 /tmp/reply`,
      90_000,
    );
    const status = result.output.match(/HTTP\/1\.[01] (\d{3})/);
    const text = status ? result.output.slice((status.index ?? 0) + status[0].length) : "";
    const reply = text.slice(text.indexOf("\n\n") + 2).trim();
    return {
      status: Number(status?.[1] ?? 0),
      code: reply.match(/"code":"([A-Z_]+)"/)?.[1] ?? "",
      text: reply,
    };
  }

  redeem(code: string, pin: string | null = null, device = { mac: this.mac, ip: this.ip }) {
    return this.post("/api/guest/redeem", { router: this.routerId, ...device, code, pin });
  }

  async onRouter<T>(work: (conn: MikroTikConn) => Promise<T>): Promise<T> {
    const creds = this.services.access.credentials(this.services.router);
    if (!creds) throw new Error(`Router ${this.sim.n} has no usable credentials`);
    const conn = await connectToRouter(creds);
    try {
      return await work(conn);
    } finally {
      await closeConnection(conn);
    }
  }

  /** The router's hotspot session for this guest, or null when it has none. */
  active(): Promise<{ user: string; loginBy: string } | null> {
    return this.onRouter(async (conn) => {
      const [row] = toRows(
        await conn.write("/ip/hotspot/active/print", [`?mac-address=${this.mac}`]),
      );
      return row ? { user: row.get("user") ?? "", loginBy: row.get("login-by") ?? "" } : null;
    });
  }

  /** What the router's RADIUS client has seen of HashiNet: its requests and their answers. */
  radius(): Promise<{ requests: number; accepts: number; rejects: number; timeouts: number }> {
    return this.onRouter(async (conn) => {
      const [entry] = toRows(await conn.write("/radius/print"));
      const [m] = toRows(
        await conn.write("/radius/monitor", [`=numbers=${entry?.get(".id") ?? ""}`, "=once="]),
      );
      const count = (key: string) => Number(m?.get(key) ?? 0);
      return {
        requests: count("requests"),
        accepts: count("accepts"),
        rejects: count("rejects"),
        timeouts: count("timeouts"),
      };
    });
  }

  /** Signs every device off the router and forgets them, so a run starts from nobody online. */
  clear(): Promise<void> {
    return this.onRouter(async (conn) => {
      for (const menu of ["/ip/hotspot/active", "/ip/hotspot/cookie", "/ip/hotspot/host"]) {
        for (const row of toRows(await conn.write(`${menu}/print`))) {
          await conn.write(`${menu}/remove`, [`=.id=${row.get(".id") ?? ""}`]).catch(() => null);
        }
      }
    });
  }

  /** Keeps the guest busy, as a phone is: the router hears from it every second. */
  async chatter(on: boolean): Promise<void> {
    await this.shell.run(
      on
        ? "(while :; do wget -q -T 2 -O /dev/null http://example.com/ 2>/dev/null; sleep 1; done) " +
            ">/dev/null 2>&1 & echo $! > /tmp/chatter"
        : "kill $(cat /tmp/chatter 2>/dev/null) 2>/dev/null; true",
    );
  }
}

const describe = (page: Page) =>
  page.internet
    ? "the open internet"
    : page.portal
      ? `the portal (${page.portal})`
      : `neither: ${page.raw.slice(-160)}`;

/** Asks until there is an answer or the time is up, and returns the answer or null. */
async function pollFor<T>(ask: () => Promise<T | null>, seconds: number): Promise<T | null> {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const answer = await ask();
    if (answer !== null || Date.now() > deadline) return answer;
    await Bun.sleep(2_000);
  }
}

/** Waits until `ok` holds or the time is up, and returns whether it held. */
async function waitUntil(ok: () => Promise<boolean>, seconds: number, everyMs = 2_000) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await ok()) return true;
    await Bun.sleep(everyMs);
  }
  return ok();
}

/**
 * A voucher across a venue's two routers, through RADIUS (ADR-0015), on the real routers and the
 * real API: a sign-in on router 1 and its switch PIN; its session from the router's accounting;
 * the same code on router 2 refused without the PIN and with a wrong one, and moved with the right
 * one; a release at the counter; a device back by its MAC without the portal; and the cut-off at
 * expiry. Runs in the hub, where the API reaches both routers and the relay answers their RADIUS.
 */
async function guestTest(): Promise<void> {
  const sims = [simRouter(1), simRouter(2)] as const;
  if (process.env.PORTAL_ORIGIN) {
    throw new Error("The guest test posts to the sim's API over the tunnel: unset PORTAL_ORIGIN.");
  }
  if (!IN_HUB) {
    const state = readState();
    for (const sim of sims) {
      const how = `bun run router-sim reset --router ${sim.n}, bootstrap --tunnel --router ${sim.n}`;
      if (!tunneled(state, sim)) throw new Error(`Router ${sim.n} needs the tunnel: ${how}.`);
      if (qemuPid(sim) === null) throw new Error(`Router ${sim.n} is not running: ${how}.`);
      if (livePid(sim.guest.pid) === null) {
        throw new Error(
          `Guest ${sim.n} is not running: bun run router-sim guest --router ${sim.n}.`,
        );
      }
    }
    ensureSimDatabase();
    delegateToHub(state, "guest-test");
    return;
  }

  const one = await simServices(sims[0]);
  const two = await simServices(sims[1]);
  const db = one.db;
  const state = readState();
  const portalOrigin = portalOriginFor(managementUrl(state), null);
  const g1 = new GuestAt(sims[0], await GuestShell.open(sims[0]), one, portalOrigin);
  const g2 = new GuestAt(sims[1], await GuestShell.open(sims[1]), two, portalOrigin);
  const results: { step: string; ok: boolean; detail: string }[] = [];
  const started = Date.now();
  const record = (step: string, ok: boolean, detail: string) => {
    results.push({ step, ok, detail });
    const at = `${Math.round((Date.now() - started) / 1000)}s`.padStart(5);
    console.log(`${ok ? "✓" : "✗"} ${at} ${step}${detail ? ` — ${detail}` : ""}`);
  };
  let api: ReturnType<typeof Bun.spawn> | null = null;

  try {
    // A voucher an earlier run left in use would let a guest back in by its MAC, with nothing
    // to test: every one at the venue ends, as does everyone online.
    const now = new Date();
    await db.voucher.updateMany({
      where: { venueId: one.router.venueId, status: { in: ["active", "pending_activation"] } },
      data: { status: "expired", expiresAt: now },
    });
    await db.wifiSession.updateMany({
      where: { venueId: one.router.venueId, status: "connected" },
      data: { status: "disconnected", endedAt: now, terminationReason: "sim_reset" },
    });
    await g1.clear();
    await g2.clear();
    api = await startApi(state);

    // Router 1: a guest joins, is sent to the portal, and signs in with a voucher.
    const address = await g1.join();
    record("Guest 1 gets an address from router 1's hotspot", address !== null, address ?? "none");
    const intercepted = await g1.fetchPage();
    record(
      "An unauthenticated page request gets the portal",
      !intercepted.internet && intercepted.portal === `${portalOrigin}/join`,
      describe(intercepted),
    );
    await g1.readRedirect();
    record(
      "Router 1's redirect names it and the device",
      g1.routerId === one.router.id && g1.mac === sims[0].guest.mac && g1.ip !== "",
      `${g1.routerId} ${g1.mac} ${g1.ip}`,
    );
    const httpsOut = await g1.shell.run(
      "wget -q -T 8 -S -O /dev/null 'https://example.com/' 2>&1 | grep -qE 'HTTP/[0-9.]+ [0-9]+' && printf 'TLS=%s\\n' ok",
      30_000,
    );
    record("Before login other HTTPS sites are blocked", !httpsOut.output.includes("TLS=ok"), "");

    const code = await issueVoucher(db, one.router.venueId, 30);
    const voucherRow = () => db.voucher.findUniqueOrThrow({ where: { code } });
    const voucherId = (await voucherRow()).id;
    /** The wrong PINs counted against guest 2's device on the voucher. */
    const wrongTries = async () =>
      (
        await db.pinAttempt.findFirst({
          where: { voucherId, device: { macAddress: simRouter(2).guest.mac } },
        })
      )?.wrongTries ?? 0;
    const direct = await g1.shell.run(
      `wget -q -T 8 -O /dev/null --post-data 'username=${code}&password=${code}&dst=' 'http://${HOTSPOT_GATEWAY}/login' 2>&1 | head -c 200`,
      30_000,
    );
    const stillOut = await g1.fetchPage();
    record(
      "The router itself accepts no code, even a right one",
      !stillOut.internet,
      `${describe(stillOut)}; ${direct.output.trim().slice(-80)}`,
    );

    const absent = await g1.redeem(code, null, { mac: "02:00:00:00:00:99", ip: g1.ip });
    const unstarted = await voucherRow();
    record(
      "A device the router cannot see is refused, and the voucher's clock does not start",
      absent.code === "DEVICE_NOT_ON_NETWORK" && unstarted.status === "unused",
      `${absent.status} ${absent.code}; ${unstarted.status}`,
    );

    const radius1 = await g1.radius();
    const signInAt = Date.now();
    const first = await g1.redeem(code);
    const signInMs = Date.now() - signInAt;
    const pin = first.text.match(/"switchPin":"(\d{4})"/)?.[1] ?? null;
    const afterSignIn = await g1.radius();
    const active1 = await g1.active();
    record(
      "Guest 1 redeems on router 1: the router asks RADIUS, HashiNet accepts, and a 4-digit switch PIN comes back once",
      first.status === 200 &&
        pin !== null &&
        (await voucherRow()).status === "active" &&
        afterSignIn.accepts > radius1.accepts &&
        active1?.user === code,
      `${first.status} in ${signInMs} ms; PIN ${pin ? "given" : "none"}; router 1 RADIUS requests ` +
        `${radius1.requests}→${afterSignIn.requests}, accepts ${radius1.accepts}→${afterSignIn.accepts}; ` +
        `it shows user ${active1?.user === code ? "the code" : (active1?.user ?? "none")}, login-by ${active1?.loginBy ?? "none"}`,
    );
    const users = await g1.onRouter(async (conn) =>
      toRows(await conn.write("/ip/hotspot/user/print")),
    );
    record(
      "No voucher lives on the router",
      users.every((u) => u.get("name") === "default-trial" || u.get("default") === "true"),
      `${users.length} local user(s): ${users.map((u) => u.get("name")).join(", ") || "none"}`,
    );
    const online1 = await g1.fetchPage();
    record("Guest 1 is online", online1.internet, describe(online1));

    const s1Row = await pollFor(
      () =>
        db.wifiSession.findFirst({
          where: { voucherId, routerId: one.router.id, macAddress: g1.mac, status: "connected" },
        }),
      20,
    );
    record(
      "Router 1's accounting Start opens the session in wifi_sessions",
      s1Row !== null && s1Row.acctSessionId !== null,
      s1Row ? `acct-session-id ${s1Row.acctSessionId}, ${s1Row.ipAddress}` : "no session",
    );

    // Router 2, the same venue: the same code is in use, so it moves only with the switch PIN.
    await g1.chatter(true);
    const address2 = await g2.join();
    record(
      "Guest 2 gets an address from router 2's hotspot",
      address2 !== null,
      address2 ?? "none",
    );
    const intercepted2 = await g2.fetchPage();
    await g2.readRedirect();
    record(
      "Router 2 sends guest 2 to the portal, naming itself",
      intercepted2.portal === `${portalOrigin}/join` &&
        g2.routerId === two.router.id &&
        g2.mac === sims[1].guest.mac,
      `${describe(intercepted2)}; ${g2.routerId} ${g2.mac} ${g2.ip}`,
    );
    const noPin = await g2.redeem(code);
    const noPinPage = await g2.fetchPage();
    record(
      "The same code on router 2 without the PIN is refused: PIN_REQUIRED",
      noPin.status === 409 && noPin.code === "PIN_REQUIRED" && !noPinPage.internet,
      `${noPin.status} ${noPin.code}; guest 2 sees ${describe(noPinPage)}`,
    );
    const wrong = String((Number(pin ?? "0") + 1) % 10_000).padStart(4, "0");
    const wrongTry = await g2.redeem(code, wrong);
    const tries = await wrongTries();
    record(
      "A wrong PIN is refused and counted: PIN_WRONG",
      wrongTry.status === 400 && wrongTry.code === "PIN_WRONG" && tries === 1,
      `${wrongTry.status} ${wrongTry.code}; wrong tries ${tries}`,
    );

    const moveAt = Date.now();
    const moved = await g2.redeem(code, pin);
    const moveMs = Date.now() - moveAt;
    const online2 = await g2.fetchPage();
    record(
      "The right PIN moves it to guest 2 on router 2, which signs in through RADIUS",
      moved.status === 200 && online2.internet && /"switchPin":null/.test(moved.text),
      `${moved.status} in ${moveMs} ms, no new PIN; guest 2 sees ${describe(online2)}; wrong tries ${await wrongTries()}`,
    );
    const s2Row = await pollFor(
      () =>
        db.wifiSession.findFirst({
          where: { voucherId, routerId: two.router.id, macAddress: g2.mac, status: "connected" },
        }),
      20,
    );
    record(
      "Router 2's accounting opens guest 2's session",
      s2Row !== null && s2Row.acctSessionId !== null,
      s2Row ? `acct-session-id ${s2Row.acctSessionId}` : "no session",
    );

    // Guest 1 kept asking (a phone is never quiet): it must stay off, its place taken.
    await Bun.sleep(10_000);
    const gone1 = await g1.fetchPage();
    const active1After = await g1.active();
    const ended1 = s1Row ? await db.wifiSession.findUnique({ where: { id: s1Row.id } }) : null;
    record(
      "Router 1's session ends, and guest 1 stays off while it keeps asking",
      !gone1.internet &&
        active1After === null &&
        ended1?.status === "terminated" &&
        ended1.terminationReason === "moved_to_another_device",
      `guest 1 sees ${describe(gone1)}; router 1 ${active1After ? `still shows ${active1After.loginBy}` : "has no session"}; ` +
        `row ${ended1?.status ?? "missing"} (${ended1?.terminationReason ?? "no reason"}), ${ended1?.downloadBytes ?? 0n} bytes down by its Stop`,
    );
    await g1.chatter(false);

    // Gone from router 1 and back, while guest 2 holds the place: RADIUS refuses its MAC.
    await g1.clear();
    const radiusAway = await g1.radius();
    const refusedBack = await g1.fetchPage();
    await Bun.sleep(3_000);
    const radiusAwayAfter = await g1.radius();
    record(
      "Guest 1 back on router 1 by its MAC while guest 2 holds the place is refused by RADIUS",
      !refusedBack.internet &&
        refusedBack.portal !== null &&
        radiusAwayAfter.rejects > radiusAway.rejects,
      `guest 1 sees ${describe(refusedBack)}; router 1 RADIUS requests ${radiusAway.requests}→${radiusAwayAfter.requests}, ` +
        `rejects ${radiusAway.rejects}→${radiusAwayAfter.rejects}`,
    );

    // At the counter: staff release the voucher, and the next device signs in with the code alone.
    const owner = await db.membership.findFirstOrThrow({
      where: { business: { venues: { some: { id: one.router.venueId } } }, role: "owner" },
      include: { user: true },
    });
    const staff: Principal = {
      sessionId: "router-sim",
      userId: owner.userId,
      email: owner.user.email,
      name: owner.user.name,
      membershipId: owner.id,
      scope: "business",
      businessId: owner.businessId,
      role: "owner",
      venueIds: null,
      access: "full",
      pause: null,
    };
    // As the API's release route calls it: the sim has no staff sign-in to post with.
    const prisma = db as unknown as PrismaService;
    const audit = new AuditLog(db);
    const vouchers = new VouchersService(
      prisma,
      audit,
      new SessionsService(prisma, audit, two.sync),
    );
    const released = await vouchers.release(staff, voucherId);
    const off2 = await waitUntil(async () => (await g2.active()) === null, 20);
    const page2 = await g2.fetchPage();
    const afterRelease = await voucherRow();
    const devices = await db.voucherDevice.count({ where: { voucherId } });
    const ended2 = s2Row ? await db.wifiSession.findUnique({ where: { id: s2Row.id } }) : null;
    record(
      "A release at the counter ends guest 2's session and clears the devices and the PIN",
      off2 &&
        !page2.internet &&
        afterRelease.pinHmac === null &&
        devices === 0 &&
        ended2?.terminationReason === "voucher_released",
      `voucher ${released.status}; guest 2 sees ${describe(page2)}; its row ${ended2?.status ?? "missing"} ` +
        `(${ended2?.terminationReason ?? "no reason"}); devices ${devices}; PIN ${afterRelease.pinHmac === null ? "cleared" : "kept"}`,
    );
    const again = await g1.redeem(code);
    const newPin = again.text.match(/"switchPin":"(\d{4})"/)?.[1] ?? null;
    const back1 = await g1.fetchPage();
    record(
      "Then guest 1 signs in with the code alone and gets a new switch PIN",
      again.status === 200 && newPin !== null && back1.internet,
      `${again.status}; PIN ${newPin ? "given" : "none"}; guest 1 sees ${describe(back1)}`,
    );

    // A device coming back: gone from the router (session, cookie and host), it returns by its MAC.
    await waitUntil(
      async () =>
        (await db.wifiSession.count({
          where: { voucherId, routerId: one.router.id, macAddress: g1.mac, status: "connected" },
        })) > 0,
      20,
    );
    await g1.clear();
    await waitUntil(
      async () =>
        (await db.wifiSession.count({
          where: { voucherId, routerId: one.router.id, macAddress: g1.mac, status: "connected" },
        })) === 0,
      20,
    );
    const radiusBack = await g1.radius();
    let returned = await g1.fetchPage();
    const backAt = Date.now();
    while (!returned.internet && Date.now() - backAt < 30_000) {
      await Bun.sleep(2_000);
      returned = await g1.fetchPage();
    }
    const byMac = await g1.active();
    const radiusBackAfter = await g1.radius();
    const reopened = await db.wifiSession.findFirst({
      where: { voucherId, routerId: one.router.id, macAddress: g1.mac, status: "connected" },
    });
    record(
      "A device back by its MAC is signed in by the router through RADIUS, without the portal",
      returned.internet && byMac?.loginBy === "mac" && radiusBackAfter.accepts > radiusBack.accepts,
      `after ${Math.round((Date.now() - backAt) / 1000)} s, guest 1 sees ${describe(returned)}; login-by ${byMac?.loginBy ?? "none"}, ` +
        `user ${byMac?.user === g1.mac ? "its MAC" : (byMac?.user ?? "none")}; RADIUS accepts ${radiusBack.accepts}→${radiusBackAfter.accepts}; ` +
        `session ${reopened?.acctSessionId ?? "none"}`,
    );

    // A short voucher on router 2: its Session-Timeout cuts the guest off at expiry.
    const shortCode = await issueVoucher(db, one.router.venueId, 1);
    const short = await g2.redeem(shortCode);
    const shortOn = await g2.fetchPage();
    console.log("        waiting 75 s for a 1-minute voucher to run out…");
    await Bun.sleep(75_000);
    const expired = await g2.fetchPage();
    const shortSession = await db.wifiSession.findFirst({
      where: { voucher: { code: shortCode } },
      orderBy: { startedAt: "desc" },
    });
    record(
      "At expiry router 2 cuts the guest off, and the session ends for its timeout",
      short.status === 200 && shortOn.internet && !expired.internet && expired.portal !== null,
      `signed in ${short.status}, ${describe(shortOn)}; then ${describe(expired)}; session ` +
        `${shortSession?.status ?? "none"} (${shortSession?.terminationReason ?? "no reason"})`,
    );
  } finally {
    g1.shell.close();
    g2.shell.close();
    api?.kill();
    await one.db.$disconnect();
    await two.db.$disconnect();
    const failed = results.filter((r) => !r.ok).length;
    console.log(
      `\nGuest test: ${results.length - failed} passed, ${failed} failed, in ${Math.round((Date.now() - started) / 1000)} s.`,
    );
    if (failed > 0) process.exitCode = 1;
  }
}

/**
 * The tunnel service's RADIUS relay (apps/tunnel), run in the hub on the platform's tunnel address,
 * relaying each router's packets to the sim API with the router's tunnel address as it arrived.
 */
async function relay(): Promise<void> {
  if (!IN_HUB) throw new Error("The relay runs in the hub: `bun run router-sim hub up` starts it.");
  const { syncSecret } = readState();
  if (!syncSecret) throw new Error("No sync secret: run `bun run router-sim hub up`.");
  await serveRadius(TUNNEL.serverIp, `http://127.0.0.1:${BACKEND_PORT}`, syncSecret);
  console.log(`RADIUS relay on ${TUNNEL.serverIp}:1812-1813 to the sim API.`);
  await new Promise(() => {});
}

// Hub: the platform side of the management tunnel.

function docker(cmd: string[], input: string | null = null): string {
  const result = Bun.spawnSync(["docker", ...cmd], {
    stdin: input === null ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`docker ${cmd[0]} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

function hub(): void {
  const action = args[0] ?? "up";
  if (action === "down") {
    Bun.spawnSync(["docker", "rm", "-f", HUB.container], { stdout: "ignore", stderr: "ignore" });
    console.log("Hub stopped.");
    return;
  }
  let state = readState();
  const peers = Object.keys(state.routers)
    .map((key) => simRouter(Number(key)))
    .filter((sim) => tunneled(state, sim));
  const hubKey = state.hubKey;
  if (hubKey === null || peers.length === 0) {
    throw new Error("No tunnel: run `bun run router-sim bootstrap --tunnel` first.");
  }
  if (state.syncSecret === null) {
    state = { ...state, syncSecret: randomBytes(32).toString("hex") };
    writeState(state);
  }
  if (action === "restart") {
    // A restart drops the hub's WireGuard state and its relay, as a platform restart would: the
    // routers must re-establish the tunnel on their own.
    docker(["restart", HUB.container]);
  } else {
    Bun.spawnSync(["docker", "rm", "-f", HUB.container], { stdout: "ignore", stderr: "ignore" });
    docker([
      "run",
      "-d",
      "--name",
      HUB.container,
      "--cap-add",
      "NET_ADMIN",
      // PostgreSQL is reachable from the hub only on the compose network.
      "--network",
      COMPOSE_NETWORK,
      "-p",
      `127.0.0.1:${TUNNEL.port}:${TUNNEL.port}/udp`,
      "-v",
      `${ROOT}:${ROOT}`,
      "-w",
      ROOT,
      HUB.image,
      "sleep",
      "infinity",
    ]);
  }
  docker(
    [
      "exec",
      "-i",
      "-u",
      "0",
      HUB.container,
      "sh",
      "-c",
      [
        "set -e",
        "umask 077",
        "cat > /run/wg.key",
        "ip link add wg0 type wireguard",
        `wg set wg0 private-key /run/wg.key listen-port ${TUNNEL.port}`,
        `ip address add ${TUNNEL.serverIp}/${TUNNEL.prefix} dev wg0`,
        "ip link set wg0 up",
      ].join("; "),
    ],
    hubKey.privateKey,
  );
  for (const sim of peers) {
    const key = routerState(state, sim).tunnelKey?.publicKey ?? "";
    docker([
      "exec",
      "-u",
      "0",
      HUB.container,
      "wg",
      "set",
      "wg0",
      "peer",
      key,
      "allowed-ips",
      `${sim.tunnelIp}/32`,
    ]);
  }
  // The relay reads the sync secret from the sim state itself, so it never shows in a process list.
  docker([
    "exec",
    "-d",
    "-u",
    `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    "-e",
    "SIM_IN_HUB=1",
    HUB.container,
    "sh",
    "-c",
    `exec bun tooling/router-sim.ts relay >> ${join(SIM, "relay.log")} 2>&1`,
  ]);
  console.log(
    `Hub ${action === "restart" ? "restarted" : "up"}: ${TUNNEL.serverIp}/${TUNNEL.prefix}, listening on ` +
      `127.0.0.1:${TUNNEL.port}/udp, peers ${peers.map((sim) => sim.tunnelIp).join(", ")}, RADIUS relay on 1812-1813.`,
  );
}

function tunnelStatus(): void {
  console.log(docker(["exec", "-u", "0", HUB.container, "wg", "show", "wg0"]));
}

async function consoleCommand(statement: string): Promise<void> {
  const adminPassword = routerState(readState()).adminPassword ?? randomPassword(20);
  const serial = await SerialConsole.open();
  await serial.login([adminPassword, ""], adminPassword);
  saveRouter({ adminPassword });
  console.log((await serial.exec(statement)).trim().split("\n").slice(1).join("\n"));
  serial.close();
}

const [command = "status", ...args] = ARGV;
const commands: Record<string, () => Promise<void> | void> = {
  up,
  down,
  reset,
  status: () =>
    console.log(`Router sim ${R.n} is ${qemuPid() === null ? "not running" : "running"}.`),
  console: () => consoleCommand(args.join(" ")),
  demo,
  code: latestCode,
  hub,
  "tunnel-status": tunnelStatus,
  guest,
  voucher,
  "guest-test": guestTest,
  "guest-run": guestRun,
  relay,
  bootstrap,
  import: importScript,
  setup,
  verify,
};
const action = commands[command];
if (!action) {
  console.error(`Unknown command "${command}". Commands: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
await action();

/** The business the router sim's venue and packages belong to, created on first use. */
/**
 * The sim's business, with a protected owner: a venue serves guests only once its owner has
 * protected their sign-in (ADR-0011, 9), so without one every redeem is refused as not open.
 */
async function simBusinessId(db: PrismaClient): Promise<string> {
  const business =
    (await db.business.findFirst({ where: { name: "Router sim business" } })) ??
    (await db.business.create({
      data: { name: "Router sim business", region: "Dar es Salaam", area: "Sim" },
    }));
  const owner = await db.membership.findFirst({
    where: { businessId: business.id, role: "owner", status: "active" },
  });
  const userId =
    owner?.userId ??
    (
      await db.membership.create({
        data: {
          scope: "business",
          role: "owner",
          business: { connect: { id: business.id } },
          user: {
            create: {
              id: Bun.randomUUIDv7(),
              email: "sim-owner@example.com",
              name: "Sim owner",
              emailVerified: true,
            },
          },
        },
      })
    ).userId;
  await db.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  return business.id;
}
