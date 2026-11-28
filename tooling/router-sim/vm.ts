import { existsSync, mkdirSync, rmSync } from "node:fs";
import {
  BASE_IMAGE,
  IN_HUB,
  LAN,
  NO_ROUTER,
  qemuPid,
  R,
  ROS_VERSION,
  readState,
  SIM,
  SIM_DATABASE,
  writeState,
} from "./sim.ts";

export async function up(): Promise<void> {
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

export function down(): void {
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
export async function reset(): Promise<void> {
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

export function run(cmd: string[]): void {
  const result = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${cmd[0]} failed: ${result.stderr.toString().trim()}`);
  }
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips the terminal's ANSI escape sequences
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b[=>]|\r/g;

/** The router's serial console, driven the way an operator would type into a terminal. */
export class SerialConsole {
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
