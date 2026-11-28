import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "../../apps/api/src/core/database/client.js";
import { closeConnection, connectToRouter } from "../../apps/api/src/network/mikrotik/mikrotik.js";
import { toRows } from "../../apps/api/src/network/provisioning/ros-client.js";
import { bootstrapPlatform } from "../../apps/api/src/platform/bootstrap/bootstrap.js";
import { generateCode } from "../../apps/api/src/sales/vouchers/voucher-codes.js";
import { delegateToHub, ensureSimDatabase, managementUrl, simServices, tunneled } from "./setup.ts";
import {
  args,
  BACKEND_PORT,
  GUEST_IP,
  IN_HUB,
  livePid,
  qemuPid,
  R,
  ROOT,
  readState,
  routerState,
  SIM,
  type SimRouter,
  type SimState,
  simBusinessId,
  simDatabaseUrl,
  simRouter,
} from "./sim.ts";
import { run, SerialConsole, up } from "./vm.ts";

// Guest: a client on the hotspot segment, standing in for a phone. Each router has its own.

const GUEST_ISO = join(SIM, "alpine-virt-3.24.3-x86_64.iso");
export const HOTSPOT_GATEWAY = "10.5.50.1";

/** The guest's shell over its serial console. */
export class GuestShell {
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

export function guest(): void {
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
export async function issueVoucher(
  db: PrismaClient,
  venueId: string,
  minutes: number,
): Promise<string> {
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
  // A real code, so the sim signs in as a guest's card would.
  const code = generateCode();
  await db.voucher.create({
    data: { code, venueId, packageId: pkg.id, priceTsh: pkg.priceTsh, durationMinutes: minutes },
  });
  return code;
}

/** Prints `VOUCHER=<code>`, a voucher for the sim's venue. */
export async function voucher(): Promise<void> {
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
export async function guestRun(): Promise<void> {
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
export async function startApi(
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
export function latestCode(): void {
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
export async function demo(): Promise<void> {
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
