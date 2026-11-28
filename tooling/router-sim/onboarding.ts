import { readFileSync } from "node:fs";
import { buildBootstrapScript } from "../../apps/api/src/network/provisioning/bootstrap.js";
import { generateWireguardKeyPair } from "../../apps/api/src/network/provisioning/tunnel.js";
import {
  API_PORT,
  API_USER,
  args,
  LAN,
  R,
  randomPassword,
  readState,
  routerState,
  saveRouter,
  TUNNEL,
  writeState,
} from "./sim.ts";
import { SerialConsole } from "./vm.ts";

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
export async function importScript(): Promise<void> {
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

export async function bootstrap(): Promise<void> {
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
