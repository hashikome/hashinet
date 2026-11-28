import type { Principal } from "../../apps/api/src/core/access/principal.js";
import { AuditLog } from "../../apps/api/src/core/audit/audit-log.js";
import type { PrismaService } from "../../apps/api/src/core/database/prisma.service.js";
import {
  closeConnection,
  connectToRouter,
  type MikroTikConn,
} from "../../apps/api/src/network/mikrotik/mikrotik.js";
import { portalOriginFor } from "../../apps/api/src/network/provisioning/context.js";
import { toRows } from "../../apps/api/src/network/provisioning/ros-client.js";
import { SessionsService } from "../../apps/api/src/sales/sessions/sessions.service.js";
import { VouchersService } from "../../apps/api/src/sales/vouchers/vouchers.service.js";
import { GuestShell, HOTSPOT_GATEWAY, issueVoucher, startApi } from "./guest.ts";
import {
  delegateToHub,
  ensureSimDatabase,
  managementUrl,
  type SimServices,
  simServices,
  tunneled,
} from "./setup.ts";
import { IN_HUB, livePid, qemuPid, readState, type SimRouter, simRouter } from "./sim.ts";

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
async function waitUntil(ok: () => Promise<boolean>, seconds: number): Promise<boolean> {
  return (await pollFor(async () => ((await ok()) ? true : null), seconds)) !== null;
}

/**
 * A voucher across a venue's two routers, through RADIUS (ADR-0015), on the real routers and the
 * real API: a sign-in on router 1 and its switch PIN; its session from the router's accounting;
 * the same code on router 2 refused without the PIN and with a wrong one, and moved with the right
 * one; a release at the counter; a device back by its MAC without the portal; and the cut-off at
 * expiry. Runs in the hub, where the API reaches both routers and the relay answers their RADIUS.
 */
export async function guestTest(): Promise<void> {
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
