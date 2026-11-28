import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { serveRadius } from "../../apps/tunnel/src/radius-relay.js";
import { tunneled } from "./setup.ts";
import {
  args,
  BACKEND_PORT,
  COMPOSE_NETWORK,
  HUB,
  IN_HUB,
  ROOT,
  readState,
  routerState,
  SIM,
  simRouter,
  TUNNEL,
  writeState,
} from "./sim.ts";

/**
 * The tunnel service's RADIUS relay (apps/tunnel), run in the hub on the platform's tunnel address,
 * relaying each router's packets to the sim API with the router's tunnel address as it arrived.
 */
export async function relay(): Promise<void> {
  if (!IN_HUB) throw new Error("The relay runs in the hub: `bun run router-sim hub up` starts it.");
  const { syncSecret } = readState();
  if (!syncSecret) throw new Error("No sync secret: run `bun run router-sim hub up`.");
  await serveRadius(TUNNEL.serverIp, `http://127.0.0.1:${BACKEND_PORT}`, syncSecret);
  console.log(`RADIUS relay on ${TUNNEL.serverIp}:1812-1813 to the sim API.`);
  await new Promise(() => {});
}

// Hub: the platform side of the management tunnel.

export function docker(cmd: string[], input: string | null = null): string {
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

export function hub(): void {
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
    `exec bun tooling/router-sim/main.ts relay >> ${join(SIM, "relay.log")} 2>&1`,
  ]);
  console.log(
    `Hub ${action === "restart" ? "restarted" : "up"}: ${TUNNEL.serverIp}/${TUNNEL.prefix}, listening on ` +
      `127.0.0.1:${TUNNEL.port}/udp, peers ${peers.map((sim) => sim.tunnelIp).join(", ")}, RADIUS relay on 1812-1813.`,
  );
}

export function tunnelStatus(): void {
  console.log(docker(["exec", "-u", "0", HUB.container, "wg", "show", "wg0"]));
}
