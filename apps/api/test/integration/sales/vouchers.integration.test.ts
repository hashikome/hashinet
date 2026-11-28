import { describe, expect, test } from "bun:test";
import type { VenueRecord } from "@hashinet/types";
import { Prisma } from "../../../src/generated/prisma/client.js";
import { browser, type Client, enrollAuthenticatorFor, useApi } from "../api.js";
import { useTestDatabase } from "../harness.js";
import { businessMember, sellingVenue, testBusinessId } from "../people.js";

const t = useTestDatabase();
const api = useApi();

/** The test business's owner, signed in with an authenticator app. */
async function owner(): Promise<Client> {
  await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, "owner@example.com");
  return c;
}

async function manager(email: string): Promise<{ client: Client; id: string }> {
  const { membershipId: id } = await businessMember(t.db, {
    email,
    name: email,
    role: "venue_manager",
  });
  const client = browser(api);
  await enrollAuthenticatorFor(api, client, email);
  return { client, id };
}

const DAY = { name: "Day", durationMinutes: 1440, downloadSpeedMbps: 10, priceTsh: 2000 };

async function setting(operatorId: string | null) {
  const venue = await t.db.venue.create({
    data: {
      businessId: await testBusinessId(t.db),
      name: "Home",
      region: "Dar es Salaam",
      area: "Dar es Salaam",
    },
  });
  await sellingVenue(t.db, venue.id);
  if (operatorId)
    await t.db.membershipVenue.create({ data: { membershipId: operatorId, venueId: venue.id } });
  const pkg = await t.db.package.create({
    data: { businessId: await testBusinessId(t.db), ...DAY, dataLimitGb: 5 },
  });
  return { venue, pkg };
}

/** Sells `n` vouchers of a package at a venue, as `c`; returns the codes. */
async function sell(c: Client, venueId: string, packageId: string, n: number) {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const sold = await c.request("POST", "/api/sales", { venueId, packageId, method: "cash" });
    expect(sold.status).toBe(201);
    codes.push((sold.body as { code: string }).code);
  }
  return codes;
}

describe("vouchers", () => {
  test("a voucher is made by its sale, with the package's terms and price", async () => {
    const c = await owner();
    const { venue, pkg } = await setting(null);
    const [code] = await sell(c, venue.id, pkg.id, 1);
    expect(code).toMatch(/^\d{12}$/);
    const voucher = await t.db.voucher.findUniqueOrThrow({ where: { code } });
    expect(voucher).toMatchObject({
      status: "unused",
      venueId: venue.id,
      packageId: pkg.id,
      durationMinutes: 1440,
      dataLimitGb: 5,
    });
    expect(voucher.priceTsh.toString()).toBe("2000");
    // Raising the price later never re-prices a sale.
    await t.db.package.update({ where: { id: pkg.id }, data: { priceTsh: 3000 } });
    expect((await t.db.voucher.findUniqueOrThrow({ where: { code } })).priceTsh.toString()).toBe(
      "2000",
    );
  });

  test("a manager sells only at their venues, and lists only theirs, a page at a time", async () => {
    const own = await manager("own@example.com");
    const { venue, pkg } = await setting(own.id);
    const c = await owner();
    const other = await t.db.venue.create({
      data: {
        businessId: await testBusinessId(t.db),
        name: "Other",
        region: "Dar es Salaam",
        area: "Arusha",
      },
    });
    await sellingVenue(t.db, other.id);
    await sell(own.client, venue.id, pkg.id, 5);
    await sell(c, other.id, pkg.id, 3);
    const elsewhere = await own.client.request("POST", "/api/sales", {
      venueId: other.id,
      packageId: pkg.id,
      method: "cash",
    });
    expect(elsewhere.status).toBe(404);

    const first = (await own.client.request("GET", "/api/vouchers?limit=3")).body as {
      vouchers: { venueName: string }[];
      nextBefore: string | null;
    };
    expect(first.vouchers).toHaveLength(3);
    expect(first.nextBefore).not.toBeNull();
    const rest = (
      await own.client.request("GET", `/api/vouchers?limit=3&before=${first.nextBefore}`)
    ).body as { vouchers: unknown[]; nextBefore: string | null };
    expect(rest.vouchers).toHaveLength(2);
    expect(rest.nextBefore).toBeNull();
    expect(first.vouchers.every((v) => v.venueName === "Home")).toBe(true);
    const all = (await c.request("GET", "/api/vouchers?status=unused")).body as {
      vouchers: unknown[];
    };
    expect(all.vouchers).toHaveLength(8);
  });

  test("printing and revoking are gone: a voucher exists only by its sale", async () => {
    const c = await owner();
    expect((await c.request("GET", "/api/vouchers/batches")).status).toBe(404);
    expect((await c.request("POST", "/api/vouchers/revoke", { ids: [] })).status).toBe(404);
    expect((await c.request("POST", "/api/vouchers/print", { ids: [] })).status).toBe(404);
  });
});

describe("a venue sells only while a router serves it", () => {
  test("no router serving, no sale: offline since it was last heard from, or not set up", async () => {
    const { venue, pkg } = await setting(null);
    const c = await owner();
    const selling = async () =>
      ((await c.request("GET", `/api/venues/${venue.id}`)).body as { venue: VenueRecord }).venue
        .selling;
    expect(await selling()).toEqual({ state: "selling" });

    const heard = new Date("2026-11-18T13:05:00Z");
    await t.db.router.updateMany({
      where: { venueId: venue.id },
      data: { status: "offline", lastSeenAt: heard },
    });
    expect(await selling()).toEqual({ state: "offline", since: heard.toISOString() });
    // Answering but failing is the router's "needs attention", as its condition says it.
    await t.db.router.updateMany({ where: { venueId: venue.id }, data: { status: "error" } });
    expect(await selling()).toEqual({ state: "needs-attention", since: heard.toISOString() });
    const refused = await c.request("POST", "/api/sales", {
      venueId: venue.id,
      packageId: pkg.id,
      method: "cash",
    });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "VENUE_NOT_SERVING" });
    expect(await t.db.voucher.count({ where: { venueId: venue.id } })).toBe(0);

    // A router never set up is not offline: the venue isn't set up yet.
    await t.db.router.updateMany({
      where: { venueId: venue.id },
      data: { lastSetup: Prisma.DbNull, status: "online" },
    });
    expect(await selling()).toEqual({ state: "not-set-up" });

    await sellingVenue(t.db, venue.id);
    expect(await selling()).toEqual({ state: "selling" });
    await sell(c, venue.id, pkg.id, 1);
  });
});
