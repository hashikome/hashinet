import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GuestContext, PortalEditor, PortalLook } from "@hashinet/types";
import sharp from "sharp";
import { Logos } from "../../src/brand/logos.js";
import { HASHINET_COLOURS, HASHINET_PORTAL } from "../../src/portal/portal-input.js";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, sellingVenue, testBusinessId } from "./people.js";

const t = useTestDatabase();
const BRAND_DIR = join(tmpdir(), `hashinet-brand-${Date.now()}`);
const api = useApi({ BRAND_STORE_DIR: BRAND_DIR });

const LOOK: PortalLook = { ...HASHINET_PORTAL, ...HASHINET_COLOURS };

/** The test business's owner, signed in with an authenticator app. */
async function owner(): Promise<Client> {
  await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, "owner@example.com");
  return c;
}

/** A venue added in the app, as the owner adds one. */
async function addVenue(c: Client, name: string): Promise<string> {
  const reply = await c.request("POST", "/api/venues", {
    name,
    region: "Dar es Salaam",
    area: "Mbweni",
  });
  return String((reply.body as { venue: { id: string } }).venue.id);
}

/** A PNG with transparency, and metadata that must not survive. */
const png = async (width = 600, alpha = 0) =>
  new Uint8Array(
    await sharp({
      create: { width, height: width, channels: 4, background: { r: 200, g: 0, b: 0, alpha } },
    })
      .withExif({ IFD0: { Copyright: "secret-location" } })
      .png()
      .toBuffer(),
  );

function upload(c: Client, id: string, body: Uint8Array<ArrayBuffer>) {
  return c.requestWith("PUT", `/api/venues/${id}/portal/logo`, body, {
    Origin: "http://localhost:3006",
    "Content-Type": "application/octet-stream",
  });
}

const editor = (reply: { body: unknown }) => reply.body as PortalEditor;

async function context(routerId: string): Promise<GuestContext> {
  const reply = await fetch(`${api.url}/api/guest/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ router: routerId, mac: "02:00:00:00:00:01", ip: "10.5.50.20" }),
  });
  return (await reply.json()) as GuestContext;
}

describe("a business's and its venues' portals", () => {
  test("a new venue copies what new venues start with; later changes reach only later venues", async () => {
    const c = await owner();
    await c.request("PUT", "/api/portal/business", { ...LOOK, welcome: "Karibu", opensOn: "buy" });
    const first = await addVenue(c, "First");
    await addVenue(c, "Second");
    await c.request("PUT", "/api/portal/business", { ...LOOK, welcome: "Hujambo" });
    const third = await addVenue(c, "Third");

    const one = editor(await c.request("GET", `/api/venues/${first}/portal`));
    expect(one.look).toMatchObject({ welcome: "Karibu", opensOn: "buy" });
    const later = editor(await c.request("GET", `/api/venues/${third}/portal`));
    expect(later.look).toMatchObject({ welcome: "Hujambo", opensOn: "voucher" });

    // A venue's own change stays its own; restoring takes the template as it is now.
    await c.request("PUT", `/api/venues/${first}/portal`, {
      ...one.look,
      pageColor: "#7a1f2b",
    });
    const own = editor(await c.request("GET", `/api/venues/${first}/portal`));
    expect(own.look.pageColor).toBe("#7A1F2B");
    expect(editor(await c.request("GET", "/api/portal/business")).look.welcome).toBe("Hujambo");
    const restored = editor(await c.request("DELETE", `/api/venues/${first}/portal`));
    expect(restored.look).toMatchObject({ welcome: "Hujambo", pageColor: "#0D1B2A" });

    const back = editor(await c.request("DELETE", "/api/portal/business"));
    expect(back.look).toEqual(LOOK);
    const actions = (await t.db.auditLog.findMany()).map((a) => a.action);
    expect(actions.filter((a) => a.startsWith("portal.") || a.startsWith("brand."))).toEqual([
      "portal.business.update",
      "portal.business.update",
      "brand.update",
      "brand.reset",
      "portal.business.reset",
    ]);
  });

  test("a business's second venue starts as its first looks; restoring still restores", async () => {
    const c = await owner();
    const only = await addVenue(c, "Only");
    await c.request("PUT", `/api/venues/${only}/portal`, { ...LOOK, welcome: "Pull up a seat" });
    // With one venue, Restore defaults gives back what new venues start with, not its own look.
    const restored = editor(await c.request("DELETE", `/api/venues/${only}/portal`));
    expect(restored.look.welcome).toBe(LOOK.welcome);
    await c.request("PUT", `/api/venues/${only}/portal`, { ...LOOK, welcome: "Pull up a seat" });
    const next = await addVenue(c, "Next");
    expect(editor(await c.request("GET", `/api/venues/${next}/portal`)).look.welcome).toBe(
      "Pull up a seat",
    );
    // A third starts from what new venues start with.
    const third = await addVenue(c, "Third");
    expect(editor(await c.request("GET", `/api/venues/${third}/portal`)).look.welcome).toBe(
      LOOK.welcome,
    );
  });

  test("where to buy, and a number to call that is a mobile number or nothing", async () => {
    const c = await owner();
    const cafe = await addVenue(c, "Cafe");
    const save = (contactPhone: string | null) =>
      c.request("PUT", `/api/venues/${cafe}/portal`, {
        ...LOOK,
        whereToBuy: "At the reception desk, 8:00 to 22:00.",
        contactPhone,
      });
    expect(editor(await save("0754 210 388")).look).toMatchObject({
      whereToBuy: "At the reception desk, 8:00 to 22:00.",
      contactPhone: "+255754210388",
    });
    expect(editor(await save("")).look.contactPhone).toBeNull();
    expect((await save("12345")).status).toBe(400);
  });

  test("a logo is re-encoded, keeps its transparency, loses its metadata, and is served", async () => {
    const c = await owner();
    const cafe = await addVenue(c, "Cafe");
    const reply = await upload(c, cafe, await png());
    expect(reply.status).toBe(200);
    const { url, own } = editor(reply).logo;
    expect(own).toBe(true);
    expect(url).toMatch(new RegExp(`^/api/guest/brand/${cafe}/logo-[0-9a-f]{16}\\.webp$`));

    const served = await fetch(`${api.url}${url}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("cache-control")).toContain("immutable");
    const bytes = Buffer.from(await served.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 256, height: 256, hasAlpha: true });
    expect(meta.exif).toBeUndefined();
    expect(bytes.includes("secret-location")).toBe(false);
  });

  test("replacing a logo gives it a new address and removes the old file; removing it too", async () => {
    const c = await owner();
    const cafe = await addVenue(c, "Cafe");
    const url = editor(await upload(c, cafe, await png())).logo.url;
    const next = editor(await upload(c, cafe, await png(400, 1))).logo.url;
    expect(next).not.toBe(url);
    await Bun.sleep(50);
    expect((await fetch(`${api.url}${url}`)).status).toBe(404);
    expect((await fetch(`${api.url}${next}`)).status).toBe(200);
    const removed = editor(await c.request("DELETE", `/api/venues/${cafe}/portal/logo`));
    expect(removed.logo).toEqual({ url: null, own: false });
    await Bun.sleep(50);
    expect((await fetch(`${api.url}${next}`)).status).toBe(404);
  });

  test("what is not an accepted image is refused, whatever it claims to be", async () => {
    const c = await owner();
    const cafe = await addVenue(c, "Cafe");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    for (const text of [svg, "not an image"]) {
      const reply = await upload(c, cafe, new TextEncoder().encode(text));
      expect(reply.status).toBe(400);
      expect(reply.body).toMatchObject({ code: "INVALID_IMAGE" });
    }
    const huge = await upload(c, cafe, new Uint8Array(8 * 1024 * 1024 + 1));
    expect(huge.status).toBe(413);
    expect(await t.db.venuePortal.count({ where: { logoKey: { not: null } } })).toBe(0);
  });

  test("a venue manager changes their own venues' portals, not another's nor the template", async () => {
    const c = await owner();
    const mine = await addVenue(c, "Mine");
    const theirs = await addVenue(c, "Theirs");
    const { membershipId: id } = await businessMember(t.db, {
      email: "m@example.com",
      name: "M",
      role: "venue_manager",
    });
    await t.db.membershipVenue.create({ data: { membershipId: id, venueId: mine } });
    const m = browser(api);
    await signInWithCode(api, m, "m@example.com");
    expect((await m.request("PUT", `/api/venues/${mine}/portal`, LOOK)).status).toBe(200);
    for (const [method, path] of [
      ["GET", `/api/venues/${theirs}/portal`],
      ["PUT", `/api/venues/${theirs}/portal`],
      ["DELETE", `/api/venues/${theirs}/portal`],
    ] as const) {
      expect((await m.request(method, path, method === "PUT" ? LOOK : null)).status).toBe(404);
    }
    expect((await upload(m, theirs, await png())).status).toBe(404);
    expect((await m.request("GET", "/api/portal/business")).status).toBe(403);
    expect((await m.request("PUT", "/api/portal/business", LOOK)).status).toBe(403);
    expect((await m.request("PUT", "/api/portal", HASHINET_PORTAL)).status).toBe(403);
    // Whoever works the counter neither changes nor reads a venue's portal.
    const { membershipId: op } = await businessMember(t.db, {
      email: "op@example.com",
      name: "Op",
      role: "venue_operator",
    });
    await t.db.membershipVenue.create({ data: { membershipId: op, venueId: mine } });
    const o = browser(api);
    await signInWithCode(api, o, "op@example.com");
    expect((await o.request("GET", `/api/venues/${mine}/portal`)).status).toBe(403);
  });

  test("the guest route serves only names it makes", async () => {
    const venue = await t.db.venue.create({
      data: {
        businessId: await testBusinessId(t.db),
        name: "Cafe",
        region: "Dar es Salaam",
        area: "Dar",
      },
    });
    for (const file of [
      "..%2F..%2Fsecret",
      "logo.webp",
      "logo-abc.png",
      "background-0123456789abcdef.webp",
    ]) {
      const reply = await fetch(`${api.url}/api/guest/brand/${venue.id}/${file}`);
      expect(reply.status).toBe(404);
    }
    expect((await fetch(`${api.url}/api/guest/brand/not-a-uuid/logo.webp`)).status).toBe(404);
  });

  test("the guest sees the venue's portal, its logo only when shown, as the preview does", async () => {
    const c = await owner();
    const cafe = await addVenue(c, "Cafe");
    await sellingVenue(t.db, cafe);
    const router = await t.db.router.create({
      data: { venueId: cafe, name: "Lobby", ipAddress: "192.168.88.2" },
    });
    await t.db.package.create({
      data: {
        businessId: await testBusinessId(t.db),
        name: "Day",
        durationMinutes: 1440,
        downloadSpeedMbps: 10,
        priceTsh: 2000,
      },
    });
    await c.request("PUT", `/api/venues/${cafe}/portal`, {
      ...LOOK,
      opensOn: "buy",
      welcome: "Karibu Cafe",
    });
    const url = editor(await upload(c, cafe, await png())).logo.url;
    const seen = await context(router.id);
    expect(seen.settings).toMatchObject({ opensOn: "buy", welcome: "Karibu Cafe", logoUrl: url });
    expect(seen.packages.map((p) => p.name)).toEqual(["Day"]);

    const hidden = editor(
      await c.request("PUT", `/api/venues/${cafe}/portal`, { ...LOOK, showLogo: false }),
    );
    expect((await context(router.id)).settings.logoUrl).toBeNull();
    // The editor's preview is what the guest gets, but for the router's own line.
    const { internet: _a, ...preview } = hidden.preview;
    const { internet: _b, ...guest } = await context(router.id);
    expect(preview).toEqual(guest);
  });

  test("the sweep removes stored files nothing references, once they are an hour old", async () => {
    const c = await owner();
    const cafe = await addVenue(c, "Cafe");
    const kept = editor(await upload(c, cafe, await png())).logo.url ?? "";
    const store = join(BRAND_DIR, cafe);
    await Bun.write(join(store, "background-0123456789abcdef.webp"), "old");
    // Nothing the store didn't make is ever touched.
    await Bun.write(join(BRAND_DIR, "backups", "db.sql.gz"), "not ours");
    const sweep = (at: Date) => api.app.get(Logos).sweep(at);
    // Too new to remove yet: its row may still be on its way.
    expect(await sweep(new Date())).toBe(0);
    // Other tests' logos, whose rows are gone, go too.
    expect(await sweep(new Date(Date.now() + 2 * 60 * 60_000))).toBeGreaterThanOrEqual(1);
    expect(await Bun.file(join(store, "background-0123456789abcdef.webp")).exists()).toBe(false);
    expect((await fetch(`${api.url}${kept}`)).status).toBe(200);
    expect(await Bun.file(join(BRAND_DIR, "backups", "db.sql.gz")).exists()).toBe(true);
  });

  test("the business profile: its owner changes it, business managers read it, venue managers don't", async () => {
    const c = await owner();
    // The test business is found by its name, which this test changes: its people come first.
    await businessMember(t.db, { email: "bm@example.com", name: "BM", role: "business_manager" });
    await businessMember(t.db, { email: "vm@example.com", name: "VM", role: "venue_manager" });
    const first = await c.request("GET", "/api/business");
    expect(first.body).toMatchObject({ name: "Test Business", logoUrl: null });
    const saved = await c.request("PUT", "/api/business", {
      name: "Zuhura Cafes",
      region: "Dar es Salaam",
      area: "Mbezi Beach",
    });
    expect(saved.body).toEqual({
      name: "Zuhura Cafes",
      region: "Dar es Salaam",
      area: "Mbezi Beach",
      logoUrl: null,
    });
    expect(
      (await c.request("PUT", "/api/business", { name: "", region: "Mars", area: "" })).status,
    ).toBe(400);

    const bm = browser(api);
    await enrollAuthenticatorFor(api, bm, "bm@example.com");
    expect((await bm.request("GET", "/api/business")).body).toMatchObject({ name: "Zuhura Cafes" });
    expect((await bm.request("PUT", "/api/business", saved.body)).status).toBe(403);
    const vm = browser(api);
    await signInWithCode(api, vm, "vm@example.com");
    expect((await vm.request("GET", "/api/business")).status).toBe(403);
    const actions = (await t.db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toContain("business.profile.update");
  });

  test("the business logo heads the admin and shows where a venue has none of its own", async () => {
    const c = await owner();
    const cafe = await addVenue(c, "Cafe");
    await sellingVenue(t.db, cafe);
    const router = await t.db.router.create({
      data: { venueId: cafe, name: "Lobby", ipAddress: "192.168.88.2" },
    });
    const reply = await c.requestWith("PUT", "/api/business/logo", await png(), {
      Origin: "http://localhost:3006",
      "Content-Type": "application/octet-stream",
    });
    const business = (reply.body as { logoUrl: string }).logoUrl;
    expect(business).toMatch(/^\/api\/guest\/brand\/[0-9a-f-]+\/logo-[0-9a-f]{16}\.webp$/);
    expect((await fetch(`${api.url}${business}`)).status).toBe(200);
    const me = (await c.request("GET", "/api/me")).body as {
      active: { business: { logoUrl: string } };
    };
    expect(me.active.business.logoUrl).toBe(business);

    // The venue has none of its own: its portal and its editor show the business's.
    expect((await context(router.id)).settings.logoUrl).toBe(business);
    expect(editor(await c.request("GET", `/api/venues/${cafe}/portal`)).logo).toEqual({
      url: business,
      own: false,
    });
    const own = editor(await upload(c, cafe, await png(300, 1))).logo.url;
    expect((await context(router.id)).settings.logoUrl).toBe(own);

    // The sweep keeps both; removing the business's takes its file.
    expect(
      await api.app.get(Logos).sweep(new Date(Date.now() + 2 * 60 * 60_000)),
    ).toBeGreaterThanOrEqual(0);
    expect((await fetch(`${api.url}${business}`)).status).toBe(200);
    const removed = await c.request("DELETE", "/api/business/logo");
    expect(removed.body).toMatchObject({ logoUrl: null });
    await Bun.sleep(50);
    expect((await fetch(`${api.url}${business}`)).status).toBe(404);
  });
});
