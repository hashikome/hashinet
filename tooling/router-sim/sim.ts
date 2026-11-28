import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PrismaClient } from "../../apps/api/src/core/database/client.js";
import type { WireguardKeyPair } from "../../apps/api/src/network/provisioning/tunnel.js";

export const ROOT = resolve(import.meta.dir, "../..");
export const SIM = join(ROOT, "data", "router-sim");
export const ROS_VERSION = "7.25";
export const BASE_IMAGE = join(SIM, `chr-${ROS_VERSION}.img`);
const STATE_FILE = join(SIM, "state.json");

/** The sim venue LAN is QEMU's user network: the host is the "ISP router" at 10.0.2.2. */
export const LAN = { routerIp: "10.0.2.15", prefix: 24, gatewayIp: "10.0.2.2" } as const;
/** The host side of 10.0.2.2:4006, where the router fetches its portal pages. */
export const BACKEND_PORT = 4006;
export const BACKEND_URL = `http://${LAN.gatewayIp}:${BACKEND_PORT}`;
export const API_USER = "hashinet";
/**
 * The sim's own database on the compose.yml PostgreSQL, migrated by the real migrations. From
 * inside the hub container the host's loopback is not reachable, so the hub joins the compose
 * network and reaches PostgreSQL by its container name.
 */
export const SIM_DATABASE = "hashinet_sim";
export const COMPOSE_NETWORK = "hashinet_default";
export function simDatabaseUrl(): string {
  return IN_HUB
    ? `postgresql://hashinet:hashinet@hashinet-postgres:5432/${SIM_DATABASE}`
    : `postgresql://hashinet:hashinet@127.0.0.1:5438/${SIM_DATABASE}`;
}
export const API_PORT = 8728;
/** The guest VM's address, fixed by a static lease while the demo runs. */
export const GUEST_IP = "10.5.50.254";

/**
 * The management tunnel. The hub container stands in for the platform: each router dials it at
 * 10.0.2.2:51820 (QEMU's user network, outbound only, like carrier-grade NAT), and the sim
 * reaches the routers through the tunnel alone. RADIUS comes back through it too, so the relay
 * tells the routers apart by their tunnel addresses.
 */
export const TUNNEL = { serverIp: "10.88.0.1", prefix: 24, port: 51820 } as const;
export const HUB = {
  container: "hashinet-router-sim-hub",
  image: "hashinet-router-sim-hub:1",
} as const;
/** Set when this process runs inside the hub container, on the platform side of the tunnel. */
export const IN_HUB = process.env.SIM_IN_HUB === "1";

/**
 * One router of the sim's venue, with its guest VM. Router 1 keeps the names and ports the sim had
 * with a single router; each further router has its own overlay, sockets, forwarded ports, guest
 * link, MAC addresses and tunnel address, so two run side by side.
 */
export interface SimRouter {
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

export function simRouter(n: number): SimRouter {
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
export const ARGV = process.argv.slice(2);
const ROUTER_FLAG = ARGV.indexOf("--router");
const ROUTER_N = ROUTER_FLAG === -1 ? 1 : Number(ARGV[ROUTER_FLAG + 1]);
if (!Number.isInteger(ROUTER_N) || ROUTER_N < 1 || ROUTER_N > 9) {
  throw new Error("--router takes a router number from 1 to 9");
}
if (ROUTER_FLAG !== -1) ARGV.splice(ROUTER_FLAG, 2);
export const R = simRouter(ROUTER_N);
export const [command = "status", ...args] = ARGV;

interface RouterState {
  adminPassword: string | null;
  apiPassword: string | null;
  /** Its WireGuard keys, when it was bootstrapped with the management tunnel. */
  tunnelKey: WireguardKeyPair | null;
  /** Its row in the sim database. */
  routerId: string | null;
}

/** What the sim's routers share, and each router's own, in one file. */
export interface SimState {
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

export const NO_ROUTER: RouterState = {
  adminPassword: null,
  apiPassword: null,
  tunnelKey: null,
  routerId: null,
};

export function readState(): SimState {
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

export function writeState(state: SimState): void {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export function routerState(state: SimState, sim: SimRouter = R): RouterState {
  return { ...NO_ROUTER, ...state.routers[String(sim.n)] };
}

/** Saves a change to one router's state, keeping the rest of the file as it now stands. */
export function saveRouter(change: Partial<RouterState>, sim: SimRouter = R): void {
  const state = readState();
  writeState({
    ...state,
    routers: { ...state.routers, [String(sim.n)]: { ...routerState(state, sim), ...change } },
  });
}

export function randomPassword(length: number): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function livePid(file: string): number | null {
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, "utf8").trim());
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export function qemuPid(sim: SimRouter = R): number | null {
  return livePid(sim.pidFile);
}

/** The business the router sim's venue and packages belong to, created on first use. */
/**
 * The sim's business, with a protected owner: a venue serves guests only once its owner has
 * protected their sign-in (ADR-0011, 9), so without one every redeem is refused as not open.
 */
export async function simBusinessId(db: PrismaClient): Promise<string> {
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
