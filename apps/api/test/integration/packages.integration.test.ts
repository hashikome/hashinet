import { describe, expect, test } from "bun:test";
import { browser, type Client, enrollAuthenticatorFor, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, sellingVenue, testBusinessId } from "./people.js";

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

type Body = Record<string, unknown>;
const packageOf = (reply: { body: unknown }) => (reply.body as { package: Body }).package;
const details = (reply: { body: unknown }) => (reply.body as { details: Body }).details;

describe("packages", () => {
  test("the owner creates, replaces and deletes a package, each audited", async () => {
    const c = await owner();
    const created = await c.request("POST", "/api/packages", {
      ...DAY,
      features: ["Fast"],
      throttledDownloadMbps: 2,
      peakStartHour: 18,
      peakEndHour: 22,
    });
    expect(created.status).toBe(201);
    expect(packageOf(created)).toMatchObject({
      priceTsh: "2000.00",
      deviceLimit: 1,
      throttledDownloadMbps: 2,
    });
    const id = String(packageOf(created).id);

    // A replacement without the throttle fields clears them.
    const replaced = await c.request("PUT", `/api/packages/${id}`, { ...DAY, priceTsh: 2500 });
    expect(packageOf(replaced)).toMatchObject({
      priceTsh: "2500.00",
      throttledDownloadMbps: null,
      peakStartHour: null,
    });

    expect((await c.request("DELETE", `/api/packages/${id}`)).status).toBe(204);
    const actions = (await t.db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map(
      (entry) => entry.action,
    );
    expect(actions).toEqual(["package.create", "package.update", "package.delete"]);
  });

  test("the API enforces the form's rules and the ones that make throttling work", async () => {
    const c = await owner();
    const cases: [Body, string, RegExp][] = [
      [{ priceTsh: 499 }, "priceTsh", /500/],
      [{ priceTsh: 1500.5 }, "priceTsh", /whole number/],
      [{ durationMinutes: 600_000 }, "durationMinutes", /525600/],
      [
        { throttledDownloadMbps: 10, peakStartHour: 1, peakEndHour: 5 },
        "throttledDownloadMbps",
        /below the download speed/,
      ],
      [
        {
          uploadSpeedMbps: 4,
          throttledDownloadMbps: 2,
          throttledUploadMbps: 4,
          throttleAfterGb: 1,
        },
        "throttledUploadMbps",
        /below the upload speed \(4/,
      ],
      [{ throttledDownloadMbps: 2 }, "throttledDownloadMbps", /peak hours or a data threshold/],
      [{ peakStartHour: 18, peakEndHour: 22 }, "peakStartHour", /throttled download/],
      [{ throttleAfterGb: 2 }, "throttleAfterGb", /throttled download/],
      [{ throttledUploadMbps: 1 }, "throttledUploadMbps", /throttled download/],
      [{ throttledDownloadMbps: 2, peakStartHour: 18 }, "peakEndHour", /both peak hours/],
      [{ throttledDownloadMbps: 2, peakStartHour: 18, peakEndHour: 18 }, "peakEndHour", /differ/],
      [
        { dataLimitGb: 5, throttledDownloadMbps: 2, throttleAfterGb: 5 },
        "throttleAfterGb",
        /data limit \(5/,
      ],
      [{ name: "Two\nlines" }, "name", /one line/],
    ];
    for (const [change, field, message] of cases) {
      const reply = await c.request("POST", "/api/packages", { ...DAY, ...change });
      expect({ change, status: reply.status }).toEqual({ change, status: 400 });
      expect({ change, message: String(details(reply)[field]) }).toEqual({
        change,
        message: expect.stringMatching(message),
      });
    }
    // A night window across midnight is valid.
    const night = await c.request("POST", "/api/packages", {
      ...DAY,
      throttledDownloadMbps: 2,
      peakStartHour: 22,
      peakEndHour: 6,
    });
    expect(night.status).toBe(201);
    expect(await t.db.package.count()).toBe(1);
  });

  test("removing a package stops it selling; its vouchers keep working", async () => {
    const c = await owner();
    const pkg = await t.db.package.create({
      data: { businessId: await testBusinessId(t.db), ...DAY },
    });
    const voucher = await t.db.voucher.create({
      data: { packageId: pkg.id, code: "LIVE01", durationMinutes: 1440, priceTsh: "2000" },
    });
    expect((await c.request("DELETE", `/api/packages/${pkg.id}`)).status).toBe(204);
    expect(
      ((await c.request("GET", "/api/packages")).body as { packages: Body[] }).packages,
    ).toEqual([]);
    expect((await c.request("GET", `/api/packages/${pkg.id}`)).status).toBe(404);
    expect(await t.db.voucher.findUniqueOrThrow({ where: { id: voucher.id } })).toMatchObject({
      packageId: pkg.id,
      status: "unused",
    });
    expect((await t.db.auditLog.findMany()).map((a) => a.action)).toContain("package.delete");
  });

  test("a manager reads what is on sale and changes nothing", async () => {
    const { client } = await manager("m@example.com");
    const active = await t.db.package.create({
      data: { businessId: await testBusinessId(t.db), ...DAY },
    });
    const retired = await t.db.package.create({
      data: { businessId: await testBusinessId(t.db), ...DAY, name: "Old", isActive: false },
    });

    const list = await client.request("GET", "/api/packages");
    expect((list.body as { packages: Body[] }).packages.map((p) => p.id)).toEqual([active.id]);
    expect((await client.request("GET", `/api/packages/${retired.id}`)).status).toBe(404);
    expect((await client.request("POST", "/api/packages", DAY)).status).toBe(403);
    expect((await client.request("PUT", `/api/packages/${active.id}`, DAY)).status).toBe(403);
    expect((await client.request("DELETE", `/api/packages/${active.id}`)).status).toBe(403);
  });

  test("a venue sells the business's packages at its own prices, and a package of its own", async () => {
    const c = await owner();
    const own = await manager("own@example.com");
    const businessId = await testBusinessId(t.db);
    const venue = await t.db.venue.create({
      data: { businessId, name: "Home", region: "Dar es Salaam", area: "Mbweni" },
    });
    await t.db.membershipVenue.create({ data: { membershipId: own.id, venueId: venue.id } });
    const other = await t.db.venue.create({
      data: { businessId, name: "Other", region: "Dar es Salaam", area: "Kunduchi" },
    });
    const day = await t.db.package.create({ data: { businessId, ...DAY } });
    const week = await t.db.package.create({
      data: { businessId, ...DAY, name: "Week", priceTsh: 9000 },
    });
    await t.db.package.create({ data: { businessId, ...DAY, name: "Old", isActive: false } });
    type Sold = {
      packages: Body[];
      catalogue: { package: Body; ownPriceTsh: string | null; onSale: boolean; own: boolean }[];
    };
    const at = async (client: Client, venueId: string) =>
      (await client.request("GET", `/api/venues/${venueId}/packages`)).body as Sold;
    const sold = (b: Sold) => b.packages.map((p) => `${p.name} ${p.priceTsh}`);

    expect(sold(await at(own.client, venue.id))).toEqual(["Day 2000.00", "Week 9000.00"]);

    // The owner sets Home's own price for Week, and stops selling Day there.
    const priced = await c.request("PUT", `/api/venues/${venue.id}/packages/${week.id}`, {
      priceTsh: 8000,
      onSale: true,
    });
    expect(priced.status).toBe(200);
    await c.request("PUT", `/api/venues/${venue.id}/packages/${day.id}`, {
      priceTsh: null,
      onSale: false,
    });
    const home = await at(own.client, venue.id);
    expect(sold(home)).toEqual(["Week 8000.00"]);
    expect(home.catalogue.map((x) => [x.package.name, x.ownPriceTsh, x.onSale])).toEqual([
      ["Day", null, false],
      ["Week", "8000.00", true],
    ]);
    // Another venue keeps the business's prices.
    expect(sold(await at(c, other.id))).toEqual(["Day 2000.00", "Week 9000.00"]);

    // A venue manager adds a package for their venue: sold only there, at its own price.
    const added = await own.client.request("POST", `/api/venues/${venue.id}/own-packages`, {
      ...DAY,
      name: "Evening",
      priceTsh: 1000,
    });
    expect(added.status).toBe(201);
    const evening = (added.body as Sold).catalogue.find((x) => x.own)?.package;
    expect(evening?.name).toBe("Evening");
    expect(sold(await at(own.client, venue.id))).toEqual(["Evening 1000.00", "Week 8000.00"]);
    expect(sold(await at(c, other.id))).toEqual(["Day 2000.00", "Week 9000.00"]);
    // It is the venue's: the business's routes don't reach it, and neither does another venue's.
    expect((await c.request("PUT", `/api/packages/${evening?.id}`, DAY)).status).toBe(404);
    expect(
      (await c.request("DELETE", `/api/venues/${other.id}/own-packages/${evening?.id}`)).status,
    ).toBe(404);

    // Back to the business's price and on sale again.
    await c.request("PUT", `/api/venues/${venue.id}/packages/${day.id}`, {
      priceTsh: null,
      onSale: true,
    });
    await c.request("PUT", `/api/venues/${venue.id}/packages/${week.id}`, {
      priceTsh: null,
      onSale: true,
    });
    expect(await t.db.venuePackage.count()).toBe(0);
    const removed = await own.client.request(
      "DELETE",
      `/api/venues/${venue.id}/own-packages/${evening?.id}`,
    );
    expect(sold(removed.body as Sold)).toEqual(["Day 2000.00", "Week 9000.00"]);

    // The list says where each sells; a venue manager sees only their venue's own.
    const list = (await c.request("GET", "/api/packages")).body as {
      venues: number;
      packages: Body[];
    };
    expect(list.venues).toBe(2);
    expect(list.packages.map((p) => [p.name, p.soldAt, p.ownPrices])).toEqual([
      ["Day", 2, 0],
      ["Week", 2, 0],
    ]);

    // A venue manager neither sets a venue's price nor reaches another venue.
    expect((await own.client.request("GET", `/api/venues/${other.id}/packages`)).status).toBe(404);
    expect(
      (
        await own.client.request("PUT", `/api/venues/${venue.id}/packages/${day.id}`, {
          priceTsh: 100,
          onSale: true,
        })
      ).status,
    ).toBe(403);
    expect(
      (await own.client.request("POST", `/api/venues/${other.id}/own-packages`, DAY)).status,
    ).toBe(404);
    const actions = (await t.db.auditLog.findMany()).map((entry) => entry.action);
    expect(actions.filter((a) => a === "package.venue.set")).toHaveLength(4);
    expect(actions.filter((a) => a === "package.create")).toHaveLength(1);
    expect(actions.filter((a) => a === "package.delete")).toHaveLength(1);
  });

  test("the owner exports every package and where it is sold, never another business's", async () => {
    const c = await owner();
    const mine = await testBusinessId(t.db);
    const home = await t.db.venue.create({
      data: { businessId: mine, name: "Home", region: "Dar es Salaam", area: "Mbweni" },
    });
    const day = await t.db.package.create({ data: { businessId: mine, ...DAY } });
    await t.db.package.create({ data: { businessId: mine, ...DAY, name: "=HYPERLINK(1)" } });
    const away = await t.db.venue.create({
      data: { businessId: mine, name: "Away", region: "Dar es Salaam", area: "Kunduchi" },
    });
    await t.db.venuePackage.create({
      data: { venueId: away.id, packageId: day.id, onSale: false },
    });
    await t.db.venuePackage.create({
      data: { venueId: home.id, packageId: day.id, priceTsh: 1500 },
    });
    const other = await testBusinessId(t.db, "Other Business");
    await t.db.package.create({ data: { businessId: other, ...DAY, name: "Theirs" } });

    const reply = await c.request("GET", "/api/packages/export.csv");
    expect(reply.status).toBe(200);
    const csv = String(reply.body);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Package,Minutes,Devices,Price (TSh),On sale,Sold at");
    // A venue's own price is its own line; a venue that stopped selling it is on neither.
    expect(lines).toContain("Day,1440,1,1500,Yes,Home");
    expect(lines.filter((l) => l.startsWith("Day,"))).toHaveLength(1);
    // A formula-looking name is kept as text, and another business's packages never appear.
    expect(csv).toContain("'=HYPERLINK(1),1440,1,2000,Yes,Away; Home");
    expect(csv).not.toContain("Theirs");

    // A manager of Away sees what sells there: never a package Away stopped selling.
    const m = await manager("away@example.com");
    await t.db.membershipVenue.create({ data: { membershipId: m.id, venueId: away.id } });
    const theirs = String((await m.client.request("GET", "/api/packages/export.csv")).body);
    expect(theirs).not.toContain("Day,");
    expect(theirs).toContain("'=HYPERLINK(1),1440,1,2000,Yes,Away");
  });

  test("a sold voucher keeps the price it was sold at when the package's price changes", async () => {
    const c = await owner();
    const businessId = await testBusinessId(t.db);
    const venue = await t.db.venue.create({
      data: { businessId, name: "Home", region: "Dar es Salaam", area: "Mbweni" },
    });
    await sellingVenue(t.db, venue.id);
    const pkg = await t.db.package.create({ data: { businessId, ...DAY } });
    for (let i = 0; i < 2; i++) {
      const sold = await c.request("POST", "/api/sales", {
        venueId: venue.id,
        packageId: pkg.id,
        method: "cash",
      });
      expect(sold.status).toBe(201);
    }
    const raised = await c.request("PUT", `/api/packages/${pkg.id}`, { ...DAY, priceTsh: 5000 });
    expect(raised.status).toBe(200);
    const prices = await t.db.voucher.findMany({ where: { packageId: pkg.id } });
    expect(prices.map((v) => Number(v.priceTsh))).toEqual([2000, 2000]);
  });
});
