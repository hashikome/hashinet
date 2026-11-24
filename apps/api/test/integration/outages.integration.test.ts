import { describe, expect, test } from "bun:test";
import type { GuestContext, RouterList, VenueRecord } from "@hashinet/types";
import { IssuesService } from "../../src/issues/issues.service.js";
import { RouterOutages } from "../../src/routers/router-outages.js";
import { recordInternet } from "../../src/services/live-monitor.js";
import { browser, enrollAuthenticatorFor, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, protectedOwner, testBusinessId } from "./people.js";

const t = useTestDatabase();
const api = useApi();
const MIN = 60_000;

/** A venue with a router that is set up and serving, a package, and its protected owner. */
async function venueServing() {
  const businessId = await testBusinessId(t.db);
  await protectedOwner(t.db, businessId);
  const venue = await t.db.venue.create({
    data: { businessId, name: "Juma's home", region: "Dar es Salaam", area: "Mbweni" },
  });
  const router = await t.db.router.create({
    data: {
      venueId: venue.id,
      name: "Lobby",
      ipAddress: "192.0.2.1",
      status: "online",
      lastSetup: { ok: true, phases: [], blockers: [] },
      lastSeenAt: new Date(),
      internetSeenAt: new Date(),
    },
  });
  const pkg = await t.db.package.create({
    data: {
      businessId,
      name: "1 week",
      durationMinutes: 7 * 1440,
      downloadSpeedMbps: 10,
      priceTsh: 7000,
    },
  });
  return { businessId, venue, router, pkg };
}

describe("a router's own internet", () => {
  test("two failed pings in a row mark it down, one good one marks it up", async () => {
    const { router } = await venueServing();
    const ok = async () =>
      (await t.db.router.findUniqueOrThrow({ where: { id: router.id } })).internetOk;
    await recordInternet(t.db, router.id, false);
    expect(await ok()).toBe(true);
    await recordInternet(t.db, router.id, false);
    expect(await ok()).toBe(false);
    await recordInternet(t.db, router.id, true);
    expect(await ok()).toBe(true);
    expect((await t.db.router.findUniqueOrThrow({ where: { id: router.id } })).internetFails).toBe(
      0,
    );
  });

  test("with no internet it doesn't serve: no sale, an issue, and the portal takes no code", async () => {
    const { venue, router, pkg } = await venueServing();
    const lost = new Date(Date.now() - 10 * MIN);
    await t.db.router.update({
      where: { id: router.id },
      data: { internetOk: false, internetSeenAt: lost },
    });
    await businessMember(t.db, {
      email: "neema@example.com",
      name: "Neema",
      role: "business_manager",
    });
    const c = browser(api);
    await enrollAuthenticatorFor(api, c, "neema@example.com");

    const { venue: record } = (await c.request("GET", `/api/venues/${venue.id}`)).body as {
      venue: VenueRecord;
    };
    expect(record.selling).toEqual({ state: "no-internet", since: expect.any(String) });
    const { routers } = (await c.request("GET", `/api/routers?venueId=${venue.id}`))
      .body as RouterList;
    expect(routers[0]?.condition).toBe("no-internet");
    const sale = await c.request("POST", "/api/sales", {
      venueId: venue.id,
      packageId: pkg.id,
      method: "cash",
    });
    expect(sale.body).toMatchObject({ code: "VENUE_NOT_SERVING" });

    await api.app.get(IssuesService).syncRouterIssues();
    // One for HashiNet's team, one for the business, each saying why it went down.
    const issues = await t.db.issue.findMany({
      where: { kind: "router_offline", key: `router:${router.id}` },
    });
    expect(issues.map((i) => i.cause)).toEqual(["no-internet", "no-internet"]);

    const guest = browser(api);
    const device = { router: router.id, mac: "AA:BB:CC:00:00:01", ip: "10.5.50.20" };
    const context = (await guest.request("POST", "/api/guest/context", device))
      .body as GuestContext;
    expect(context.internet).toBe(false);
    const redeem = await guest.request("POST", "/api/guest/redeem", {
      ...device,
      code: "123456789012",
      linkOrig: "",
    });
    expect(redeem.body).toMatchObject({ code: "NO_INTERNET" });
  });
});

describe("time given back", () => {
  test("each paid voucher that ran through the outage gets its lost time, up to what it had left, once", async () => {
    const { venue, router, pkg } = await venueServing();
    const outages = api.app.get(RouterOutages);
    const now = Date.now();
    const start = new Date(now - 45 * MIN);
    // A voucher, sold and paid, in use at this router since an hour before the outage.
    const voucher = async (
      code: string,
      expiresIn: number,
      status: "active" | "expired" | "refunded",
    ) => {
      const v = await t.db.voucher.create({
        data: {
          code,
          venueId: venue.id,
          packageId: pkg.id,
          priceTsh: 7000,
          status,
          activatedAt: new Date(start.getTime() - 60 * MIN),
          expiresAt: new Date(start.getTime() + expiresIn),
        },
      });
      await t.db.payment.create({
        data: {
          provider: "cash",
          status: "paid",
          paidAt: new Date(),
          amountTsh: 7000,
          venueId: venue.id,
          voucherId: v.id,
        },
      });
      return v;
    };
    const short = await voucher("100000000001", 20 * MIN, "expired");
    const week = await voucher("100000000002", 6 * 1440 * MIN, "active");
    const elsewhere = await voucher("100000000003", 6 * 1440 * MIN, "active");
    const refunded = await voucher("100000000004", 6 * 1440 * MIN, "refunded");
    for (const v of [short, week, refunded]) {
      await t.db.wifiSession.create({
        data: {
          venueId: venue.id,
          routerId: router.id,
          voucherId: v.id,
          macAddress: `AA:BB:CC:00:00:${v.code.slice(-2)}`,
          status: "connected",
          startedAt: new Date(start.getTime() - 30 * MIN),
        },
      });
    }
    await businessMember(t.db, {
      email: "neema@example.com",
      name: "Neema",
      role: "business_manager",
    });

    // It answers but has no internet: an outage from when it last reached the internet.
    await t.db.router.update({
      where: { id: router.id },
      data: { internetOk: false, internetSeenAt: start },
    });
    await outages.track(new Date(now - 30 * MIN));
    const open = await t.db.routerOutage.findFirstOrThrow({ where: { routerId: router.id } });
    expect(open).toMatchObject({ kind: "no_internet", startedAt: start, endedAt: null });
    await api.app.get(IssuesService).syncRouterIssues();

    // Its internet is back: the outage closes, and the time goes back.
    await t.db.router.update({ where: { id: router.id }, data: { internetOk: true } });
    await outages.track(new Date(now));
    const after = async (id: string) => t.db.voucher.findUniqueOrThrow({ where: { id } });

    // 20 minutes left when it began: those 20 after the outage, and it works again.
    expect(await after(short.id)).toMatchObject({
      givenBackMinutes: 20,
      status: "active",
      expiresAt: new Date(now + 20 * MIN),
    });
    // A week's voucher gets the whole 45 minutes.
    expect(await after(week.id)).toMatchObject({
      givenBackMinutes: 45,
      expiresAt: new Date(start.getTime() + 6 * 1440 * MIN + 45 * MIN),
    });
    // Not at this router, or refunded: nothing.
    expect((await after(elsewhere.id)).givenBackMinutes).toBe(0);
    expect((await after(refunded.id)).givenBackMinutes).toBe(0);

    const closed = await t.db.routerOutage.findUniqueOrThrow({ where: { id: open.id } });
    expect(closed.endedAt).not.toBeNull();
    expect(closed.givenBackAt).not.toBeNull();
    // Once: asking again gives nothing more.
    await outages.giveBack(open.id);
    expect((await after(week.id)).givenBackMinutes).toBe(45);

    const audit = await t.db.auditLog.findFirstOrThrow({
      where: { action: "router.time_given_back" },
    });
    expect(audit.change).toMatchObject({ after: { guests: 2, minutes: 65 } });
    const steps = await t.db.issueEvent.findMany({
      where: { action: "step", issue: { key: `router:${router.id}` } },
    });
    expect(steps.map((s) => s.data)).toContainEqual({
      step: "time_given_back",
      guests: 2,
      minutes: expect.stringMatching(/^(20,45|45,20)$/),
    });
  });
});
