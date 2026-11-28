import { RouterOSAPI } from "routeros";
import { pingTotals, toRows } from "../provisioning/ros-client.js";

export type MikroTikConn = RouterOSAPI;

/**
 * How this API reaches a router's RouterOS API: the management target, which is not
 * necessarily the router's address on its venue LAN (`routers.ipAddress`).
 */
export interface RouterCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  /** How long to wait for the router to answer a connection (`MIKROTIK_CONNECT_TIMEOUT`). */
  timeoutSeconds: number;
}

/** RouterOS `rate-limit` for a package, or null when it has no speed cap. */
export function rateLimitFor(pkg: {
  downloadSpeedMbps: number;
  uploadSpeedMbps: number | null;
}): string | null {
  if (!pkg.downloadSpeedMbps || pkg.downloadSpeedMbps <= 0) return null;
  const up = pkg.uploadSpeedMbps ?? pkg.downloadSpeedMbps;
  return `${up}M/${pkg.downloadSpeedMbps}M`;
}

/** A package is throttleable only if it says what to throttle *to*. */
export function packageCanThrottle(pkg: { throttledDownloadMbps: number | null }): boolean {
  return pkg.throttledDownloadMbps !== null && pkg.throttledDownloadMbps > 0;
}

/**
 * RouterOS `rate-limit` for a package's throttled state, or null when it has none configured.
 *
 * Mirrors the upload fallback of `rateLimitFor`: an unset throttled upload means "throttle upload
 * to the same figure as download", not "leave upload uncapped".
 */
export function throttledRateLimitFor(pkg: {
  throttledDownloadMbps: number | null;
  throttledUploadMbps: number | null;
}): string | null {
  if (!packageCanThrottle(pkg)) return null;
  const down = pkg.throttledDownloadMbps as number;
  const up = pkg.throttledUploadMbps ?? down;
  return `${up}M/${down}M`;
}

export interface MikroTikActiveClient {
  id: string;
  user: string;
  mac: string;
  ip: string;
  uptime: string;
  idleTime: string;
  bytesIn: number;
  bytesOut: number;
}

export async function connectToRouter(creds: RouterCredentials): Promise<MikroTikConn> {
  const conn = new RouterOSAPI({
    host: creds.host,
    user: creds.username,
    password: creds.password,
    port: creds.port,
    timeout: creds.timeoutSeconds,
    keepalive: false,
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      conn.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Connection to ${creds.host}:${creds.port} timed out after ${creds.timeoutSeconds}s`,
              ),
            ),
          creds.timeoutSeconds * 1000,
        );
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }

  return conn;
}

export async function closeConnection(conn: MikroTikConn): Promise<void> {
  try {
    await conn.close();
  } catch {
    // ignore close errors — connection may already be gone
  }
}

/**
 * Signs a client in from the API: the only way in with a code, since the hotspot accepts no login
 * over the network (ADR-0008), so a voucher code never crosses the WiFi to the router. The router
 * asks RADIUS, which takes the sign-in's admission. Rejects if the router refuses.
 */
export async function loginHotspotClient(
  conn: MikroTikConn,
  client: { user: string; ip: string; mac: string },
): Promise<void> {
  await conn.write("/ip/hotspot/active/login", [
    `=user=${client.user}`,
    `=password=${client.user}`,
    `=ip=${client.ip}`,
    `=mac-address=${client.mac}`,
  ]);
}

/** The address the router sees a device at, or null if the device is not on this hotspot. */
export async function hotspotClientAddress(
  conn: MikroTikConn,
  mac: string,
): Promise<string | null> {
  const rows = await conn.write("/ip/hotspot/host/print", [`?mac-address=${mac}`]);
  return toRows(rows)[0]?.get("address") ?? null;
}

/** The voucher a device is online on, as the router reports it. */
export async function hotspotSessionUser(conn: MikroTikConn, mac: string): Promise<string | null> {
  const rows = await conn.write("/ip/hotspot/active/print", [`?mac-address=${mac}`]);
  return toRows(rows)[0]?.get("user") ?? null;
}

/**
 * Whether a device still answers on the hotspot: an ARP ping, which a device answers while it is
 * there even when it ignores an ordinary ping (ADR-0015, 5). A refused or failed ping is no answer.
 */
export async function answersArp(conn: MikroTikConn, ip: string, iface: string): Promise<boolean> {
  const rows = await conn
    .write("/ping", [`=address=${ip}`, "=arp-ping=yes", `=interface=${iface}`, "=count=1"])
    .then(toRows)
    .catch(() => []);
  return pingTotals(rows).received > 0;
}

/**
 * Ends a device's session and forgets its cookie, whatever its user shows (the code at a sign-in,
 * the device's own address when it came back by it).
 */
export async function endHotspotSession(conn: MikroTikConn, mac: string): Promise<void> {
  for (const menu of ["/ip/hotspot/active", "/ip/hotspot/cookie"]) {
    const rows = await conn.write(`${menu}/print`, [`?mac-address=${mac}`]);
    for (const row of toRows(rows)) {
      const id = row.get(".id");
      if (id !== null) await conn.write(`${menu}/remove`, [`=.id=${id}`]);
    }
  }
}

/** The comment that marks a block as HashiNet's, so hand-made bindings are never touched. */
const BLOCK_COMMENT = "wbs:device-block";

/** Refuses a device at the router: no login of any kind works while the binding exists. */
export async function setDeviceBlocked(
  conn: MikroTikConn,
  mac: string,
  blocked: boolean,
): Promise<void> {
  const rows = toRows(
    await conn.write("/ip/hotspot/ip-binding/print", [
      `?mac-address=${mac}`,
      `?comment=${BLOCK_COMMENT}`,
    ]),
  );
  if (blocked && rows.length === 0) {
    await conn.write("/ip/hotspot/ip-binding/add", [
      `=mac-address=${mac}`,
      "=type=blocked",
      `=comment=${BLOCK_COMMENT}`,
    ]);
  }
  if (!blocked) {
    for (const row of rows) {
      const id = row.get(".id");
      if (id !== null) await conn.write("/ip/hotspot/ip-binding/remove", [`=.id=${id}`]);
    }
  }
}

/**
 * Whether the router itself reaches the internet: a reply from either of two addresses run by
 * different companies, so one of them being down isn't read as the line being down. A router that
 * refuses the ping counts as no reply.
 */
export async function reachesInternet(conn: MikroTikConn): Promise<boolean> {
  for (const address of ["8.8.8.8", "1.1.1.1"]) {
    const rows = await conn
      .write("/ping", [`=address=${address}`, "=count=2"])
      .then(toRows)
      .catch(() => []);
    if (pingTotals(rows).received > 0) return true;
  }
  return false;
}

export async function getSystemUptimeSeconds(conn: MikroTikConn): Promise<number> {
  const [row] = toRows(await conn.write("/system/resource/print"));
  const raw = row?.get("uptime") ?? "";
  if (!raw) return 0;
  let s = 0;
  const w = raw.match(/(\d+)w/);
  if (w) s += parseInt(w[1], 10) * 604800;
  const d = raw.match(/(\d+)d/);
  if (d) s += parseInt(d[1], 10) * 86400;
  const h = raw.match(/(\d+)h/);
  if (h) s += parseInt(h[1], 10) * 3600;
  const m = raw.match(/(\d+)m/);
  if (m) s += parseInt(m[1], 10) * 60;
  const sec = raw.match(/(\d+)s/);
  if (sec) s += parseInt(sec[1], 10);
  return s;
}

export async function getActiveClients(conn: MikroTikConn): Promise<MikroTikActiveClient[]> {
  return toRows(await conn.write("/ip/hotspot/active/print")).map((r) => ({
    id: r.get(".id") ?? "",
    user: r.get("user") ?? "",
    mac: r.get("mac-address") ?? "",
    ip: r.get("address") ?? "",
    uptime: r.get("uptime") ?? "0s",
    idleTime: r.get("idle-time") ?? "0s",
    bytesIn: Number(r.get("bytes-in") ?? 0),
    bytesOut: Number(r.get("bytes-out") ?? 0),
  }));
}
