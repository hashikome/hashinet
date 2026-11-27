/**
 * Post-provision proof: "is this hotspot actually serving customers?"
 *
 * Every provisioning step verifies its own write, so a green run only proves the configuration
 * reads back as asked, not that a device can associate, get an address, and be let online.
 *
 * Most of that is machine-checkable, and this checks it, without writing anything. What is left
 * needs a real radio and a real browser, so it is returned as `manual` rather than quietly omitted.
 */

import {
  closeConnection,
  connectToRouter,
  type MikroTikConn,
  type RouterCredentials,
} from "../mikrotik.js";
import type { RouterLogger } from "../router-log.js";
import type { BackendEndpoints, HotspotPlan } from "./context.js";
import type { Dialect } from "./dialect.js";
import { PORTAL_FILES, portalMark, renderPortalFile, routerPathFor } from "./portal-files.js";
// Same check/report shape as readiness.ts on purpose: one frontend component renders both.
import type { ReadinessCheck, ReadinessStatus } from "./readiness.js";
import { RosClient, rowId } from "./ros-client.js";
import { RADIUS_LOGIN_BY, RADIUS_STEP, radioIsOpen } from "./steps.js";

export interface VerifyReport {
  /** False when something proves the hotspot is not serving. */
  ok: boolean;
  checks: ReadinessCheck[];
  /** What a machine cannot prove — still needs a phone. */
  manual: string[];
  summary: { pass: number; warn: number; fail: number; skipped: number };
}

export interface VerifyInput {
  routerId: string;
  dialect: Dialect;
  plan: HotspotPlan;
  endpoints: BackendEndpoints;
}

const yes = (v: string | null) => v === "true" || v === "yes";

const MANUAL_CHECKS = [
  "Connect a phone to the SSID and confirm it gets an address in the hotspot range.",
  "Confirm the captive portal appears and shows your branded page.",
  "Redeem a real voucher on a phone and confirm the portal says you are online and the phone can browse.",
  "Confirm the countdown and data-remaining display tick down.",
];

async function hotspotServerCheck(ros: RosClient, plan: HotspotPlan): Promise<ReadinessCheck> {
  const base = { id: "hotspot-server-running", title: "Hotspot server is running" };
  const row = await ros.findByName("/ip/hotspot", plan.serverName);

  if (!row) {
    return {
      ...base,
      status: "fail",
      detail: `No hotspot server named "${plan.serverName}" exists.`,
      fix: "Run Set up again — the hotspot-server step did not take effect.",
    };
  }
  if (yes(row.get("disabled"))) {
    return {
      ...base,
      status: "fail",
      detail: `"${plan.serverName}" exists but is disabled.`,
      fix: `/ip hotspot enable [find name=${plan.serverName}]`,
    };
  }
  // RouterOS flags a server whose profile, pool or interface does not resolve. It looks
  // configured and serves nobody.
  if (yes(row.get("invalid"))) {
    return {
      ...base,
      status: "fail",
      detail: `"${plan.serverName}" is marked invalid by RouterOS — its profile, pool or interface does not resolve.`,
      fix: "Check /ip hotspot print detail for the reason, then run Set up again.",
    };
  }
  return {
    ...base,
    status: "pass",
    detail: `"${plan.serverName}" is enabled on ${row.get("interface") ?? plan.interface}.`,
  };
}

/**
 * `invalid=yes` on a DHCP server is NOT on its own proof that clients get no address.
 *
 * On `/interface wireless` in AP mode, the interface's `running` property tracks *associated
 * clients*, not whether the radio is transmitting — an idle AP that is beaconing perfectly well
 * reports `running=false`. RouterOS's DHCP server consults that same property and marks itself
 * `invalid` with `.about="Interface not running"`. So a freshly provisioned hotspot that nobody
 * has connected to yet always looks broken, and the moment a phone associates it validates
 * itself. Measured on an hAP lite (7.23.2): `/interface wireless monitor` said `status=running-ap,
 * channel=2412/20/gn(18dBm)` while the interface row said `running=false` and this check said the
 * hotspot would not serve. A phone then associated, got a lease and loaded the portal.
 *
 * This is the same trap that produced a false positive in `radioBroadcastingCheck` — which is why
 * that one asserts `mode`, not `running`. Here the reason must come from RouterOS itself
 * (`.about`) plus the radio's real state, because the flag alone cannot tell "broken" from "idle".
 *
 * `hotspot-radio-running-check` in `steps.ts` sets `disable-running-check=yes` so the flag stops
 * lying in the first place; this branch stays for boards provisioned before that step existed.
 */
async function dhcpServerCheck(
  ros: RosClient,
  dialect: Dialect,
  plan: HotspotPlan,
): Promise<ReadinessCheck> {
  const base = { id: "dhcp-server-running", title: "Clients can be given an address" };
  const row = await ros.findByName("/ip/dhcp-server", "wbs-hs-dhcp");

  if (!row) {
    return {
      ...base,
      status: "fail",
      detail: "The hotspot DHCP server is missing.",
      fix: "Run Set up again — the dhcp-server step did not take effect.",
    };
  }
  if (yes(row.get("disabled"))) {
    return {
      ...base,
      status: "fail",
      detail: "The hotspot DHCP server is disabled.",
      fix: "Without it a phone associates to the SSID and never gets an address. Run Set up again.",
    };
  }
  if (yes(row.get("invalid"))) {
    const about = row.get(".about") ?? "";
    const idleRadio =
      /not running/i.test(about) &&
      plan.interfaceIsRadio &&
      (await radioIsOnAir(ros, dialect, plan));

    if (idleRadio) {
      return {
        ...base,
        status: "warn",
        detail:
          `RouterOS marks the DHCP server invalid ("${about}"), but the radio is on the air and ` +
          `simply has no clients yet.`,
        fix:
          `On a wireless AP the interface reports running=false until a device associates, and the ` +
          `DHCP server copies that flag. It validates itself as soon as a phone connects — confirm ` +
          `by connecting one. Run Set up to apply disable-running-check=yes and stop the flag lying.`,
      };
    }
    return {
      ...base,
      status: "fail",
      detail: `The hotspot DHCP server is marked invalid${about ? ` ("${about}")` : ""}.`,
      fix: "Without it a phone associates to the SSID and never gets an address. Run Set up again.",
    };
  }
  return { ...base, status: "pass", detail: "Hotspot DHCP server is enabled and valid." };
}

/**
 * Is the radio actually transmitting? `monitor` reports the true state (`running-ap` on a legacy
 * AP), unlike the interface row's `running`. Any failure here answers "cannot tell", so a monitor
 * that is unavailable never converts a real DHCP problem into a warning.
 */
async function radioIsOnAir(ros: RosClient, dialect: Dialect, plan: HotspotPlan): Promise<boolean> {
  if (!dialect.radio) return false;
  const rows = await ros.tryExec(`${dialect.radio.menu}/monitor`, [
    `=numbers=${plan.interface}`,
    "=once=",
  ]);
  return rows?.some((r) => /running/i.test(r.get("status") ?? "")) ?? false;
}

async function radioBroadcastingCheck(
  ros: RosClient,
  dialect: Dialect,
  plan: HotspotPlan,
): Promise<ReadinessCheck> {
  const base = { id: "radio-broadcasting", title: "SSID is on the air" };

  if (!plan.interfaceIsRadio || !dialect.radio) {
    return {
      ...base,
      status: "skipped",
      detail: `The hotspot runs on "${plan.interface}", which is not a radio — clients arrive over the wire or via a separate AP.`,
    };
  }

  const row = await ros.findByName(dialect.radio.menu, plan.interface);
  if (!row) {
    return {
      ...base,
      status: "skipped",
      detail: `"${plan.interface}" not listed in ${dialect.radio.menu}.`,
    };
  }
  if (yes(row.get("disabled"))) {
    return {
      ...base,
      status: "fail",
      detail: `"${plan.interface}" is disabled, so no device can see the network.`,
      fix: "Run Set up again — the hotspot-radio-enabled step did not take effect.",
    };
  }

  // Deliberately NOT checking `running`. On a MikroTik AP that flag tracks whether a client is
  // currently associated, not whether the radio is transmitting — an idle hotspot with nobody
  // connected reports running=false, which is normal. Verified on an hAP lite in ap-bridge mode
  // with 0 clients. Treating it as a fault would warn on every quiet router.
  const ssid = row.get(dialect.radio.ssidField) ?? row.get("ssid");
  const mode = row.get(dialect.radio.modeField) ?? row.get("mode");
  const associated = await ros.tryPrint(`${dialect.radio.menu}/registration-table`);

  const wrongMode = mode !== null && mode !== dialect.radio.modeValue;
  if (wrongMode) {
    return {
      ...base,
      status: "fail",
      detail: `"${plan.interface}" is in "${mode}" mode, not "${dialect.radio.modeValue}".`,
      fix: "A radio that is not an access point cannot accept clients. Run Set up again.",
    };
  }

  return {
    ...base,
    status: "pass",
    detail:
      `"${plan.interface}" is enabled in ${mode ?? dialect.radio.modeValue} mode` +
      `${ssid ? `, broadcasting "${ssid}"` : ""}` +
      `${associated ? `, ${associated.length} device(s) associated` : ""}.`,
  };
}

/** A guest WiFi that still asks for a password can't be joined from a voucher's QR code. */
async function guestWifiOpenCheck(
  ros: RosClient,
  dialect: Dialect,
  plan: HotspotPlan,
): Promise<ReadinessCheck> {
  const base = { id: "guest-wifi-open", title: "The guest WiFi asks for no password" };
  if (!plan.interfaceIsRadio || !dialect.radio) {
    return { ...base, status: "skipped", detail: "The hotspot does not run on a radio." };
  }
  if (await radioIsOpen(ros, dialect.radio, plan.interface)) {
    return { ...base, status: "pass", detail: `"${plan.interface}" is open.` };
  }
  return {
    ...base,
    status: "warn",
    detail: `"${plan.interface}" may still ask for a password.`,
    fix:
      "Guests can't join from a voucher's QR code, which says the WiFi has none. Run Set up " +
      "again; if this stays, the board reports its security in a way setup doesn't read yet.",
  };
}

async function loginModeCheck(ros: RosClient, plan: HotspotPlan): Promise<ReadinessCheck> {
  const base = { id: "login-mode", title: "Only HashiNet signs devices in" };
  const row = await ros.findByName("/ip/hotspot/profile", plan.profileName);

  if (!row) {
    return { ...base, status: "fail", detail: `Hotspot profile "${plan.profileName}" is missing.` };
  }
  const loginBy = row.get("login-by") ?? "";
  const radius = yes(row.get("use-radius"));
  if (loginBy !== RADIUS_LOGIN_BY || !radius) {
    return {
      ...base,
      status: "fail",
      detail: `login-by is "${loginBy}"${radius ? "" : " without RADIUS"}, not ${RADIUS_LOGIN_BY} through RADIUS.`,
      fix:
        "Any http method lets the network post and guess voucher codes at the router; without " +
        "RADIUS HashiNet can't count a voucher's devices across the venue, and without mac and " +
        "mac-cookie a device can't come back. Run Set up again.",
    };
  }
  return { ...base, status: "pass", detail: `login-by is "${loginBy}", answered by HashiNet.` };
}

async function portalFilesCheck(
  ros: RosClient,
  portalOrigin: string,
  routerId: string,
): Promise<ReadinessCheck> {
  const base = { id: "portal-files", title: "Portal pages are on the router, complete" };
  const wrong: string[] = [];

  for (const name of PORTAL_FILES) {
    const path = routerPathFor(name);
    const [row] = await ros.print("/file", [`?name=${path}`]);
    if (!row) {
      wrong.push(`${name} is missing`);
      continue;
    }
    const expected = Buffer.byteLength(
      await renderPortalFile(name, portalOrigin, routerId),
      "utf8",
    );
    const actual = Number(row.get("size") ?? 0);
    if (actual !== expected) wrong.push(`${name} is ${actual} bytes, expected ${expected}`);
  }
  if (wrong.length === 0) {
    const mark = await portalMark(portalOrigin, routerId);
    if ((await ros.print("/file", [`?name=${mark}`])).length === 0) {
      wrong.push("the pages are not this router's own install (no mark for this router)");
    }
  }

  if (wrong.length > 0) {
    return {
      ...base,
      status: "fail",
      detail: `${wrong.join("; ")}.`,
      fix:
        "Usually an older copy of the page left over from a previous install — customers would " +
        "see the stale portal. It can also mean truncation in transit, which is what RouterOS's " +
        "/file add contents= does to multi-byte UTF-8 (provisioning uses /tool fetch to avoid " +
        "that). Either way: run Set up again with the backend reachable from the router.",
    };
  }
  return {
    ...base,
    status: "pass",
    detail: `${PORTAL_FILES.length} pages present, installed for this router.`,
  };
}

async function walledGardenCheck(
  ros: RosClient,
  portal: BackendEndpoints["portal"],
): Promise<ReadinessCheck> {
  const base = { id: "walled-garden", title: "Portal reachable before login" };
  const field = portal.hostIsIp ? "dst-address" : "dst-host";
  const rows = await ros.print("/ip/hotspot/walled-garden/ip", [`?${field}=${portal.host}`]);
  // RouterOS marks a host-name entry invalid when the name does not resolve.
  const accepting = rows.filter(
    (r) => r.get("action") === "accept" && !yes(r.get("disabled")) && !yes(r.get("invalid")),
  );

  if (accepting.length === 0) {
    return {
      ...base,
      status: "fail",
      detail: `Nothing lets an unauthenticated client reach ${portal.host}.`,
      fix:
        "The portal page itself is served from the backend, so without this the captive " +
        "portal never loads (§4). Run Set up again.",
    };
  }
  return { ...base, status: "pass", detail: `${portal.host} is allowed before login.` };
}

/** Informational: nobody has connected yet on a fresh install, and that is not a fault. */
async function activityCheck(ros: RosClient): Promise<ReadinessCheck> {
  const base = { id: "activity", title: "Client activity" };
  const leases = await ros.tryPrint("/ip/dhcp-server/lease");
  const active = await ros.tryPrint("/ip/hotspot/active");

  if (leases === null && active === null) {
    return { ...base, status: "skipped", detail: "Could not read leases or active users." };
  }
  const leaseCount = leases?.length ?? 0;
  const activeCount = active?.length ?? 0;

  if (leaseCount === 0 && activeCount === 0) {
    return {
      ...base,
      status: "warn",
      detail: "No DHCP leases and no logged-in users yet.",
      fix: "Expected on a router nobody has connected to. Connect a phone to confirm end to end.",
    };
  }
  return {
    ...base,
    status: "pass",
    detail: `${leaseCount} DHCP lease(s), ${activeCount} logged-in user(s).`,
  };
}

/**
 * Every login is answered by HashiNet over RADIUS (ADR-0015), so the router must name HashiNet as
 * its hotspot RADIUS server. Read-only: the first guest's sign-in is what proves the round trip, and
 * `/radius/monitor` says how the server has answered so far.
 */
async function radiusCheck(ros: RosClient, endpoints: BackendEndpoints): Promise<ReadinessCheck> {
  const base = { id: "radius", title: "HashiNet answers this router's logins" };
  const row = await ros.findByTag("/radius", RADIUS_STEP);
  const address = endpoints.management.ip;
  if (!row || row.get("address") !== address || row.get("service") !== "hotspot") {
    return {
      ...base,
      status: "fail",
      detail: row
        ? `The RADIUS entry points at ${row.get("address") ?? "nothing"}, not ${address}.`
        : "The router has no RADIUS entry for HashiNet.",
      fix: "Without it no guest can sign in. Run Set up again.",
    };
  }
  const monitor = await ros
    .tryExec("/radius/monitor", [`=numbers=${rowId(row)}`, "=once="])
    .catch(() => null);
  const counters = monitor?.[0];
  const detail = counters
    ? `Asks ${address}: ${counters.get("requests") ?? "0"} requests, ${counters.get("accepts") ?? "0"} accepted, ${counters.get("timeouts") ?? "0"} unanswered.`
    : `Asks ${address}.`;
  return { ...base, status: "pass", detail };
}

export async function verifyRouter(ros: RosClient, input: VerifyInput): Promise<VerifyReport> {
  const { routerId, dialect, plan, endpoints } = input;

  const checks: ReadinessCheck[] = [];

  // Sequential — one API connection, and a 32 MB board is no place for concurrency.
  checks.push(await hotspotServerCheck(ros, plan));
  checks.push(await dhcpServerCheck(ros, dialect, plan));
  checks.push(await radioBroadcastingCheck(ros, dialect, plan));
  checks.push(await guestWifiOpenCheck(ros, dialect, plan));
  checks.push(await loginModeCheck(ros, plan));
  checks.push(await radiusCheck(ros, endpoints));
  checks.push(await portalFilesCheck(ros, endpoints.portal.origin, routerId));
  checks.push(await walledGardenCheck(ros, endpoints.portal));
  checks.push(await activityCheck(ros));

  const count = (s: ReadinessStatus) => checks.filter((c) => c.status === s).length;
  const summary = {
    pass: count("pass"),
    warn: count("warn"),
    fail: count("fail"),
    skipped: count("skipped"),
  };

  return { ok: summary.fail === 0, checks, manual: MANUAL_CHECKS, summary };
}

/** Connect, verify, disconnect — for callers that don't already hold a `RosClient`. */
export async function probeVerify(
  creds: RouterCredentials,
  logger: RouterLogger,
  input: VerifyInput,
): Promise<VerifyReport> {
  let conn: MikroTikConn | null = null;
  try {
    conn = await logger.connect(creds.host, () => connectToRouter(creds));
    return await verifyRouter(new RosClient(conn, logger, creds.host), input);
  } finally {
    if (conn) await closeConnection(conn);
  }
}
