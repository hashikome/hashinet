/**
 * The hotspot HTML pages (login.html, status.html) that live in
 * `backend/mikrotik-files/`,
 * with the backend address templated in at push time.
 *
 * Those files ship with a hardcoded `http://192.168.0.15:4006`. Rather than requiring
 * anyone to hand-edit them when the backend moves (§3.1, §10), we rewrite the base URL
 * on the way to the router.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/services/router-provision → backend/mikrotik-files */
const FILES_DIR = join(HERE, "..", "..", "..", "mikrotik-files");

/**
 * Every page pushed to a router. Adding a name here is all it takes: the `portal-files` step
 * uploads and byte-verifies each one, `verify.ts` checks each is present at the expected length,
 * and `/portal/hotspot-files/:routerId/:name` will serve it.
 *
 * `status.html` replaces the stock RouterOS page — a bare four-row table with a popup logout that
 * mobile browsers block. `alogin.html` is not pushed: the API signs devices in, so no browser
 * ever posts a login and the router has no after-login page to show.
 */
export const PORTAL_FILES = ["login.html", "status.html"] as const;
export type PortalFileName = (typeof PORTAL_FILES)[number];

/** Any `http://<ipv4>:<port>` in the templates is the backend base URL. */
const BACKEND_URL_PATTERN = /https?:\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/g;

/**
 * A page as this router serves it: the portal's address, and the router's id, because a hotspot
 * gateway address does not identify a router (every default network shares 10.5.50.1).
 */
export async function renderPortalFile(
  name: PortalFileName,
  portalOrigin: string,
  routerId: string,
): Promise<string> {
  const raw = await readFile(join(FILES_DIR, name), "utf8");
  return raw
    .replace(BACKEND_URL_PATTERN, portalOrigin.replace(/\/+$/, ""))
    .replaceAll("__ROUTER_ID__", routerId);
}

/** Path on the router — RouterOS serves the hotspot pages from `hotspot/`. */
export function routerPathFor(name: PortalFileName): string {
  return `hotspot/${name}`;
}

/** Every page set's mark starts so; an older install's mark is replaced. */
export const PORTAL_MARK_PREFIX = "hotspot/hashinet-pages-";

/**
 * The mark Set up leaves beside the pages: a file named by a hash of exactly what was installed,
 * the router's id and the portal's address included. RouterOS's API returns no contents for a
 * file this large, and a page installed for another router has the same size, so the mark is how
 * a check tells this router's pages from a stale copy.
 */
export async function portalMark(portalOrigin: string, routerId: string): Promise<string> {
  const pages = await Promise.all(
    PORTAL_FILES.map((name) => renderPortalFile(name, portalOrigin, routerId)),
  );
  const hash = createHash("sha256").update(pages.join("\0")).digest("hex").slice(0, 16);
  return `${PORTAL_MARK_PREFIX}${hash}.txt`;
}
