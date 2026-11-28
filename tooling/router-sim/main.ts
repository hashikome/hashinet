// The router sim: a MikroTik Cloud Hosted Router (CHR) in QEMU, standing in for a venue's router
// so onboarding, provisioning and verification run against real RouterOS without hardware.
// Procedure and topology: docs/runbooks/router-sim.md.
//
// bun run router-sim <up|down|reset|status|console|hub|bootstrap|setup|verify|voucher|guest|guest-test> [--router <n>]

import { demo, guest, guestRun, latestCode, voucher } from "./guest.ts";
import { guestTest } from "./guest-test.ts";
import { hub, relay, tunnelStatus } from "./hub.ts";
import { bootstrap, importScript } from "./onboarding.ts";
import { setup, verify } from "./setup.ts";
import {
  args,
  command,
  qemuPid,
  R,
  randomPassword,
  readState,
  routerState,
  saveRouter,
} from "./sim.ts";
import { down, reset, SerialConsole, up } from "./vm.ts";

async function consoleCommand(statement: string): Promise<void> {
  const adminPassword = routerState(readState()).adminPassword ?? randomPassword(20);
  const serial = await SerialConsole.open();
  await serial.login([adminPassword, ""], adminPassword);
  saveRouter({ adminPassword });
  console.log((await serial.exec(statement)).trim().split("\n").slice(1).join("\n"));
  serial.close();
}

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
export const action = commands[command];
if (!action) {
  console.error(`Unknown command "${command}". Commands: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
await action();
