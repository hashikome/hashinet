import { describe, expect, test } from "bun:test";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, platformMember, testBusinessId } from "./people.js";

const t = useTestDatabase();
const api = useApi();

async function admin(): Promise<Client> {
  await platformMember(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, "admin@example.com");
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

let codes = 0;

/**
 * October 2026 at two venues. 21:00 UTC is midnight in Dar es Salaam, so an instant at 21:30
 * UTC on 30 September belongs to 1 October. Revenue that must count: a mobile-money payment
 * (5,000), a staff-recorded cash payment (2,000) and two cash sales at the counter (1,000 each),
 * one in use and one used up. A voucher exists only by its sale (ADR-0017), so its payment is the
 * revenue: a voucher is never counted on its own, and a failed payment is not revenue.
 */
async function october(operatorId: string | null) {
  const home = await t.db.venue.create({
    data: {
      businessId: await testBusinessId(t.db),
      name: "Home",
      region: "Dar es Salaam",
      area: "Dar",
    },
  });
  if (operatorId)
    await t.db.membershipVenue.create({ data: { membershipId: operatorId, venueId: home.id } });
  const other = await t.db.venue.create({
    data: {
      businessId: await testBusinessId(t.db),
      name: "Other",
      region: "Dar es Salaam",
      area: "Arusha",
    },
  });
  const day = await t.db.package.create({
    data: {
      businessId: await testBusinessId(t.db),
      name: "Day",
      durationMinutes: 1440,
      downloadSpeedMbps: 10,
      priceTsh: 1000,
    },
  });
  const card = (status: "active" | "used" | "expired" | "unused", activatedAt: Date | null) => {
    codes += 1;
    return t.db.voucher.create({
      data: {
        venueId: home.id,
        packageId: day.id,
        code: `WIFI-T${codes}`,
        status,
        activatedAt,
        durationMinutes: 1440,
        priceTsh: 1000,
      },
    });
  };
  const at = (iso: string) => new Date(iso);
  // A sale at the counter: its voucher, and the cash paid for it when it was sold.
  const sale = async (status: "active" | "used", soldAt: Date) => {
    const voucher = await card(status, soldAt);
    await t.db.payment.create({
      data: {
        provider: "cash",
        status: "paid",
        paidAt: soldAt,
        amountTsh: 1000,
        packageId: day.id,
        venueId: home.id,
        voucherId: voucher.id,
      },
    });
  };
  await sale("active", at("2026-09-30T21:30:00Z")); // 1 Oct locally
  await sale("used", at("2026-10-15T09:00:00Z"));
  const paidCard = await card("used", at("2026-10-20T09:00:00Z"));
  const pay = (data: {
    provider: "mobile_money" | "manual";
    amountTsh: number;
    status: "paid" | "failed";
    paidAt: Date | null;
    venueId: string;
    voucherId?: string;
  }) =>
    t.db.payment.create({
      data: { packageId: day.id, phone: "+255700000001", providerReference: "REF-1", ...data },
    });
  await pay({
    provider: "mobile_money",
    amountTsh: 5000,
    status: "paid",
    paidAt: at("2026-10-20T09:00:00Z"),
    venueId: other.id,
    voucherId: paidCard.id,
  });
  await pay({
    provider: "manual",
    amountTsh: 2000,
    status: "paid",
    paidAt: at("2026-10-31T20:59:00Z"), // still 31 Oct locally
    venueId: home.id,
  });
  await pay({
    provider: "mobile_money",
    amountTsh: 9000,
    status: "failed",
    paidAt: null,
    venueId: home.id,
  });
  // September: 4,000, to measure growth against.
  await pay({
    provider: "mobile_money",
    amountTsh: 4000,
    status: "paid",
    paidAt: at("2026-09-30T20:00:00Z"),
    venueId: home.id,
  });
  return { home, other, day };
}

type Body = Record<string, unknown>;

/** The test business's owner, signed in with an authenticator app. */
async function owner(): Promise<Client> {
  await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, "owner@example.com");
  return c;
}

const OCTOBER = "range=custom&from=2026-10-01&to=2026-10-31";

describe("sales", () => {
  test("October by the Dar es Salaam day: net of refunds, by venue and package", async () => {
    const c = await owner();
    const { home, day } = await october(null);
    // A refund made in October nets out of its takings, never out of vouchers sold.
    const sold = await t.db.payment.findFirstOrThrow({
      where: { venueId: home.id, provider: "cash" },
    });
    await t.db.refund.create({
      data: {
        voucherId: sold.voucherId ?? "",
        paymentId: sold.id,
        venueId: home.id,
        packageId: day.id,
        amountTsh: 1000,
        method: "cash",
        createdAt: new Date("2026-10-16T09:00:00Z"),
      },
    });
    const reply = await c.request("GET", `/api/analytics/sales?${OCTOBER}&show=week`);
    expect(reply.status).toBe(200);
    const r = reply.body as Body & { series: number[]; period: { buckets: { start: string }[] } };
    // 1,000 at 21:30 UTC on 30 September is 1 October here; September's 4,000 is not October's.
    expect(r).toMatchObject({
      empty: false,
      takingsTsh: "8000.00",
      vouchers: 4,
      averageSaleTsh: "2250.00",
      bestSeller: { name: "Day", vouchers: 4 },
    });
    expect(r.period.buckets.map((b) => b.start)).toEqual([
      "2026-10-01",
      "2026-10-08",
      "2026-10-15",
      "2026-10-22",
      "2026-10-29",
    ]);
    expect(r.series).toEqual([1000, 0, 5000, 0, 2000]);
    expect(r.venues).toEqual([
      { venueId: expect.any(String), name: "Other", vouchers: 1, takingsTsh: "5000.00", share: 63 },
      { venueId: home.id, name: "Home", vouchers: 3, takingsTsh: "3000.00", share: 38 },
    ]);
    expect(r.packages).toEqual([
      {
        packageId: day.id,
        name: "Day",
        vouchers: 4,
        takingsTsh: "8000.00",
        share: 100,
        takingsShare: 100,
      },
    ]);
    // Over October's 31 days, in whole shillings.
    expect(r).toMatchObject({ takingsPerDayTsh: "258.00", vouchersPerDay: 0 });

    // One venue, for its page.
    const one = await c.request("GET", `/api/analytics/sales?${OCTOBER}&venueId=${home.id}`);
    expect((one.body as Body).takingsTsh).toBe("3000.00");
  });

  test("a venue manager sees only their venues; HashiNet's team uses its own report", async () => {
    const m = await manager("m@example.com");
    const { home, other } = await october(m.id);
    const reply = await m.client.request("GET", `/api/analytics/sales?${OCTOBER}`);
    expect((reply.body as Body).takingsTsh).toBe("4000.00");
    expect(((reply.body as Body).venues as Body[]).map((v) => v.name)).toEqual(["Home"]);
    expect(
      (await m.client.request("GET", `/api/analytics/sales?${OCTOBER}&venueId=${other.id}`)).status,
    ).toBe(404);
    expect((await m.client.request("GET", `/api/analytics/platform-sales?${OCTOBER}`)).status).toBe(
      403,
    );
    const a = await admin();
    expect((await a.request("GET", `/api/analytics/sales?${OCTOBER}`)).status).toBe(403);
    expect(home.id).toBeTruthy();
  });

  test("a period that can't be is refused, field by field", async () => {
    const c = await owner();
    const details = async (q: string) => {
      const reply = await c.request("GET", `/api/analytics/sales?${q}`);
      expect(reply.status).toBe(400);
      return Object.keys((reply.body as { details: object }).details);
    };
    expect(await details("range=custom&from=2025-01-01&to=2026-06-01")).toEqual(["to"]);
    expect(await details("range=custom&from=2026-10-01")).toEqual(["to"]);
    expect(await details("range=current&period=7d")).toEqual(["period"]);
    expect(await details(`${OCTOBER}&show=hour`)).toEqual(["show"]);
  });
});

describe("platform sales", () => {
  test("across businesses, with HashiNet's fee by each business's own terms", async () => {
    const a = await admin();
    await october(null);
    const mine = await testBusinessId(t.db);
    // The test business pays 5% on sales; another, on its own terms, 10%.
    await t.db.business.update({
      where: { id: mine },
      data: { feeRateBp: 500, feeLowerRateBp: 250, feeLowerRateAboveTsh: 2_000_000 },
    });
    const otherId = await testBusinessId(t.db, "Other Business");
    await t.db.business.update({
      where: { id: otherId },
      data: { feeRateBp: 1000, feeLowerRateBp: 1000, feeLowerRateAboveTsh: 2_000_000 },
    });
    const far = await t.db.venue.create({
      data: { businessId: otherId, name: "Far", region: "Dar es Salaam", area: "Mwanza" },
    });
    await t.db.payment.create({
      data: {
        provider: "cash",
        status: "paid",
        paidAt: new Date("2026-10-10T09:00:00Z"),
        amountTsh: 20000,
        venueId: far.id,
      },
    });
    const reply = await a.request("GET", `/api/analytics/platform-sales?${OCTOBER}`);
    expect(reply.status).toBe(200);
    const r = reply.body as Body & { businesses: Body[] };
    // 9,000 at 5% by venue (Home 4,000: 200; Other 5,000: 250) and 20,000 at 10%: 2,000.
    expect(r).toMatchObject({ salesTsh: "29000.00", feesTsh: "2450.00", venuesServing: 0 });
    expect(r.businesses.map((b) => [b.name, b.salesTsh, b.feeTsh, b.share])).toEqual([
      ["Other Business", "20000.00", "2000.00", 69],
      ["Test Business", "9000.00", "450.00", 31],
    ]);
  });
});

describe("usage", () => {
  test("devices, sessions, data and peak hours from the sessions, over the reader's venues", async () => {
    const c = await owner();
    const { home, other } = await october(null);
    const session = (
      venueId: string,
      mac: string,
      started: string,
      ended: string | null,
      bytes: number,
    ) =>
      t.db.wifiSession.create({
        data: {
          venueId,
          macAddress: mac,
          startedAt: new Date(started),
          endedAt: ended === null ? null : new Date(ended),
          downloadBytes: BigInt(bytes),
          status: ended === null ? "connected" : "disconnected",
        },
      });
    // Saturday 3 October, 19:10 to 20:40 in Dar es Salaam: two devices at once at 19:00 and 20:00.
    await session(
      home.id,
      "AA:00:00:00:00:01",
      "2026-10-03T16:10:00Z",
      "2026-10-03T17:40:00Z",
      1000,
    );
    await session(
      home.id,
      "AA:00:00:00:00:02",
      "2026-10-03T16:30:00Z",
      "2026-10-03T17:10:00Z",
      500,
    );
    // The first device again on another day, across the end of the 4th into the 5th here.
    await session(
      other.id,
      "AA:00:00:00:00:01",
      "2026-10-04T20:30:00Z",
      "2026-10-04T21:30:00Z",
      250,
    );
    const reply = await c.request("GET", `/api/analytics/usage?${OCTOBER}&show=day`);
    expect(reply.status).toBe(200);
    const r = reply.body as Body & {
      series: number[];
      peak: { days: number[][]; max: number; at: Body };
      venues: Body[];
    };
    expect(r).toMatchObject({
      empty: false,
      devices: 2,
      returning: 1,
      sessions: 3,
      dataBytes: 1750,
    });
    // Started on the 3rd (two) and the 4th here (23:30 local), one each.
    expect(r.series.slice(0, 5)).toEqual([0, 0, 2, 1, 0]);
    expect(r.peak.max).toBe(2);
    expect(r.peak.at).toEqual({ weekday: 5, hour: 19 });
    expect(r.venues.map((v) => [v.name, v.sessions, v.devices])).toEqual([
      ["Home", 2, 2],
      ["Other", 1, 1],
    ]);

    const m = await manager("m@example.com");
    await t.db.membershipVenue.create({ data: { membershipId: m.id, venueId: other.id } });
    const theirs = await m.client.request("GET", `/api/analytics/usage?${OCTOBER}`);
    expect(theirs.body).toMatchObject({ sessions: 1, devices: 1 });
  });
});

describe("a business's day", () => {
  test("today's sales, takings and who is online, over the owner's venues or one of them", async () => {
    await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
    const owner = browser(api);
    await enrollAuthenticatorFor(api, owner, "owner@example.com");
    const businessId = await testBusinessId(t.db);
    const place = { businessId, region: "Dar es Salaam", area: "Mbezi" } as const;
    const home = await t.db.venue.create({ data: { ...place, name: "Home" } });
    const cafe = await t.db.venue.create({ data: { ...place, name: "Cafe" } });
    const hour = await t.db.package.create({
      data: {
        businessId,
        name: "1 hour",
        durationMinutes: 60,
        downloadSpeedMbps: 10,
        priceTsh: 500,
      },
    });
    const now = new Date();
    for (const [venueId, code] of [
      [home.id, "T-1"],
      [home.id, "T-2"],
      [cafe.id, "T-3"],
    ] as const) {
      // Each voucher sold at the counter, for cash.
      const voucher = await t.db.voucher.create({
        data: {
          venueId,
          packageId: hour.id,
          code,
          status: "active",
          activatedAt: now,
          durationMinutes: 60,
          priceTsh: 500,
        },
      });
      await t.db.payment.create({
        data: {
          packageId: hour.id,
          venueId,
          voucherId: voucher.id,
          provider: "cash",
          amountTsh: 500,
          status: "paid",
          paidAt: now,
        },
      });
    }
    await t.db.payment.create({
      data: {
        packageId: hour.id,
        venueId: home.id,
        provider: "manual",
        amountTsh: 500,
        status: "paid",
        paidAt: now,
      },
    });
    const device = await t.db.device.create({ data: { macAddress: "AA:BB:CC:00:00:09" } });
    await t.db.wifiSession.create({
      data: { venueId: home.id, deviceId: device.id, macAddress: "AA:BB", status: "connected" },
    });

    expect((await owner.request("GET", "/api/analytics/today")).body).toMatchObject({
      onlineNow: 1,
      sold: 4,
      takingsTsh: "2000.00",
      lastWeekTakingsTsh: "0.00",
      byPackage: [{ name: "1 hour", sold: 4, takingsTsh: "2000.00" }],
    });
    expect(
      (await owner.request("GET", `/api/analytics/today?venueId=${cafe.id}`)).body,
    ).toMatchObject({ onlineNow: 0, sold: 1, takingsTsh: "500.00" });

    // Another business's venue is simply nothing.
    const elsewhere = await t.db.business.create({
      data: { name: "Elsewhere", region: "Arusha", area: "Njiro" },
    });
    const far = await t.db.venue.create({
      data: { businessId: elsewhere.id, name: "Far", region: "Arusha", area: "Njiro" },
    });
    expect(
      (await owner.request("GET", `/api/analytics/today?venueId=${far.id}`)).body,
    ).toMatchObject({ sold: 0, takingsTsh: "0.00" });

    const staff = await admin();
    expect((await staff.request("GET", "/api/analytics/today")).status).toBe(403);

    // A venue operator's home is the Overview too: their venues' day.
    const { membershipId } = await businessMember(t.db, {
      email: "op@example.com",
      name: "Op",
      role: "venue_operator",
    });
    await t.db.membershipVenue.create({ data: { membershipId, venueId: cafe.id } });
    const operator = browser(api);
    await signInWithCode(api, operator, "op@example.com");
    expect((await operator.request("GET", "/api/analytics/today")).body).toMatchObject({
      sold: 1,
      takingsTsh: "500.00",
    });
  });
});

describe("payments received", () => {
  test("a business's month: its sales, by month and venue, never another's", async () => {
    await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
    const owner = browser(api);
    await enrollAuthenticatorFor(api, owner, "owner@example.com");
    const { home, other } = await october(null);

    const october2026 = (await owner.request("GET", "/api/payments/received?month=2026-10"))
      .body as Body & { payments: Body[] };
    expect(october2026).toMatchObject({
      month: "2026-10",
      current: false,
      totalTsh: "9000.00",
      count: 4,
    });
    // This month is always offered, then every month with payments.
    const thisMonth = new Date()
      .toLocaleDateString("en-CA", { timeZone: "Africa/Dar_es_Salaam" })
      .slice(0, 7);
    expect(october2026.months).toEqual([thisMonth, "2026-10", "2026-09"]);
    expect(october2026.payments.map((p) => p.kind)).toEqual(["sale", "sale", "sale", "sale"]);
    // This month by default.
    expect((await owner.request("GET", "/api/payments/received")).body).toMatchObject({
      month: thisMonth,
      current: true,
    });
    expect(
      (await owner.request("GET", `/api/payments/received?month=2026-10&venueId=${other.id}`)).body,
    ).toMatchObject({ totalTsh: "5000.00", count: 1 });
    expect(
      (await owner.request("GET", `/api/payments/received?month=2026-10&venueId=${home.id}`)).body,
    ).toMatchObject({ totalTsh: "4000.00", count: 3 });

    const elsewhere = await t.db.business.create({
      data: { name: "Elsewhere", region: "Arusha", area: "Njiro" },
    });
    await businessMember(t.db, {
      email: "far@example.com",
      name: "Far",
      role: "owner",
      businessId: elsewhere.id,
    });
    const far = browser(api);
    await enrollAuthenticatorFor(api, far, "far@example.com");
    expect((await far.request("GET", "/api/payments/received?month=2026-10")).body).toMatchObject({
      count: 0,
      totalTsh: "0.00",
    });
    expect((await (await admin()).request("GET", "/api/payments/received")).status).toBe(403);
  });
});

describe("payments received, page by page", () => {
  test("rows sharing a time are never skipped between pages", async () => {
    await businessMember(t.db, { email: "pages@example.com", name: "Pages", role: "owner" });
    const owner = browser(api);
    await enrollAuthenticatorFor(api, owner, "pages@example.com");
    const businessId = await testBusinessId(t.db);
    const venue = await t.db.venue.create({
      data: { businessId, name: "Home", region: "Dar es Salaam", area: "Mbezi" },
    });
    const paidAt = new Date();
    await t.db.payment.createMany({
      data: Array.from({ length: 101 }, () => ({
        venueId: venue.id,
        provider: "manual" as const,
        amountTsh: 500,
        status: "paid" as const,
        paidAt,
      })),
    });
    type Page = { count: number; payments: { id: string }[]; nextBefore: string | null };
    const first = (await owner.request("GET", "/api/payments/received")).body as Page;
    expect(first.count).toBe(101);
    expect(first.payments).toHaveLength(100);
    const second = (
      await owner.request(
        "GET",
        `/api/payments/received?before=${encodeURIComponent(first.nextBefore ?? "")}`,
      )
    ).body as Page;
    expect(second.payments).toHaveLength(1);
    expect(second.nextBefore).toBeNull();
    const ids = new Set([...first.payments, ...second.payments].map((p) => p.id));
    expect(ids.size).toBe(101);
  });
});

describe("each venue's takings", () => {
  test("today and the last 7 days, net of refunds, each within the reader's venues", async () => {
    const businessId = await testBusinessId(t.db);
    const [home, cafe, quiet] = await Promise.all(
      ["Home", "Cafe", "Quiet"].map((name) =>
        t.db.venue.create({ data: { businessId, name, region: "Dar es Salaam", area: "Dar" } }),
      ),
    );
    if (!home || !cafe || !quiet) throw new Error("venues");
    const pkg = await t.db.package.create({
      data: {
        businessId,
        name: "Day",
        durationMinutes: 1440,
        downloadSpeedMbps: 10,
        priceTsh: 1000,
      },
    });
    const now = new Date();
    const sold = async (venueId: string, at: Date, refunded = false) => {
      codes += 1;
      const voucher = await t.db.voucher.create({
        data: {
          venueId,
          packageId: pkg.id,
          code: `WIFI-V${codes}`,
          priceTsh: 1000,
          durationMinutes: 1440,
        },
      });
      const payment = await t.db.payment.create({
        data: {
          provider: "cash",
          status: "paid",
          paidAt: at,
          amountTsh: 1000,
          venueId,
          packageId: pkg.id,
          voucherId: voucher.id,
        },
      });
      if (refunded) {
        await t.db.refund.create({
          data: {
            voucherId: voucher.id,
            paymentId: payment.id,
            venueId,
            packageId: pkg.id,
            amountTsh: 1000,
            method: "cash",
            createdAt: at,
          },
        });
      }
    };
    await sold(home.id, now);
    await sold(home.id, now, true);
    await sold(home.id, new Date(now.getTime() - 3 * 86_400_000));
    // Eight days ago is outside the week.
    await sold(home.id, new Date(now.getTime() - 8 * 86_400_000));
    await sold(cafe.id, new Date(now.getTime() - 2 * 86_400_000));

    await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
    const owner = browser(api);
    await enrollAuthenticatorFor(api, owner, "owner@example.com");
    const all = (await owner.request("GET", "/api/analytics/venue-takings")).body as {
      venues: {
        venueId: string;
        todayTsh: string;
        soldToday: number;
        weekTsh: string;
        soldWeek: number;
      }[];
    };
    const of = (id: string) => all.venues.find((v) => v.venueId === id);
    expect(of(home.id)).toMatchObject({
      todayTsh: "1000.00",
      soldToday: 2,
      weekTsh: "2000.00",
      soldWeek: 3,
    });
    expect(of(cafe.id)).toMatchObject({ todayTsh: "0.00", weekTsh: "1000.00", soldWeek: 1 });
    expect(of(quiet.id)).toMatchObject({ todayTsh: "0.00", soldWeek: 0 });

    const daudi = await manager("daudi@example.com");
    await t.db.membershipVenue.create({ data: { membershipId: daudi.id, venueId: cafe.id } });
    const his = (await daudi.client.request("GET", "/api/analytics/venue-takings")).body as {
      venues: { venueId: string }[];
    };
    expect(his.venues.map((v) => v.venueId)).toEqual([cafe.id]);
  });
});
