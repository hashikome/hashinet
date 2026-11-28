import { describe, expect, test } from "bun:test";
import type { BusinessDetail, GuestContext, IssueList, Me, VenueRecord } from "@hashinet/types";
import { ServiceAccessService } from "../../src/billing/service-access.js";
import { addDays, businessDayOf } from "../../src/core/time/business-day.js";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, platformMember, sellingVenue, testBusinessId } from "./people.js";

const t = useTestDatabase();
const api = useApi();

/** An instant in Dar es Salaam on a 2026 day. */
const on = (day: string) => new Date(`${day}T09:00:00Z`);
const sync = (day: string) => api.app.get(ServiceAccessService).sync(null, on(day));

let numbers = 0;
/** A month's fees, due on `dueOn`, paid in full on `paidOn` if given. */
async function fees(dueOn: string, totalTsh: number, paidOn: string | null = null) {
  const businessId = await testBusinessId(t.db);
  const invoice = await t.db.invoice.create({
    data: {
      number: `INV-TEST-${++numbers}`,
      businessId,
      kind: "monthly_fees",
      period: new Date(`${dueOn.slice(0, 8)}01T00:00:00Z`),
      issuedAt: on(dueOn),
      dueOn: new Date(`${dueOn}T00:00:00Z`),
      totalTsh,
      lines: { create: [{ position: 0, label: "Home", amountTsh: totalTsh }] },
    },
  });
  if (paidOn) {
    await t.db.billPayment.create({
      data: {
        businessId,
        amountTsh: totalTsh,
        receivedOn: new Date(`${paidOn}T00:00:00Z`),
        method: "mobile_money",
        allocations: { create: { invoiceId: invoice.id, amountTsh: totalTsh } },
      },
    });
  }
  return invoice;
}

async function signedIn(
  role: "owner" | "business_manager" | "venue_operator",
  email: string,
  venueIds: string[] = [],
): Promise<Client> {
  await businessMember(t.db, { email, name: email, role, venueIds });
  const c = browser(api);
  if (role === "venue_operator") await signInWithCode(api, c, email);
  else await enrollAuthenticatorFor(api, c, email);
  return c;
}

async function staff(role: "admin" | "manager", email: string): Promise<Client> {
  await platformMember(t.db, { email, name: email, role });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, email);
  return c;
}

async function home() {
  const v = await t.db.venue.create({
    data: {
      businessId: await testBusinessId(t.db),
      name: "Juma's home",
      region: "Dar es Salaam",
      area: "Mbweni",
    },
  });
  await sellingVenue(t.db, v.id);
  await t.db.venueOnboarding.create({ data: { venueId: v.id, completedAt: on("2026-08-01") } });
  return v;
}

const access = async () =>
  (await t.db.business.findUniqueOrThrow({ where: { id: await testBusinessId(t.db) } })).access;

describe("service access by a business's bills", () => {
  test("late before: read-only 14 days after the due date; nothing sells; paying restores it", async () => {
    const v = await home();
    const owner = await signedIn("owner", "juma@example.com");
    const grace = await signedIn("business_manager", "grace@example.com");
    await fees("2026-09-07", 5_875, "2026-09-12");
    const september = await fees("2026-10-07", 6_140);

    await sync("2026-10-10");
    expect(await access()).toBe("grace_period");
    const overdue = api.email.sent.find((m) => m.subject === "Your bill to HashiNet is overdue");
    expect(overdue?.to).toBe("juma@example.com");
    expect(overdue?.text).toContain("Pay it by 21 October 2026 to keep selling.");
    // The manager hears that selling pauses, without the amount; the owner has the bill.
    const issues = async (c: Client) =>
      ((await c.request("GET", "/api/issues?status=open")).body as IssueList).issues;
    expect((await issues(grace)).map((i) => [i.kind, i.access])).toEqual([
      [
        "selling_paused",
        { state: "grace_period", selling: true, held: false, pausesOn: "2026-10-21" },
      ],
    ]);
    expect((await issues(owner)).map((i) => i.kind)).not.toContain("selling_paused");

    await sync("2026-10-21");
    expect(await access()).toBe("read_only");
    expect(api.email.sent.map((m) => m.subject)).toContain("Selling is paused at Test Business");

    // Nothing sells: not at the counter, not on the portal, and no package changes.
    const pkg = await t.db.package.create({
      data: {
        businessId: v.businessId,
        name: "Day",
        durationMinutes: 1440,
        downloadSpeedMbps: 5,
        priceTsh: "1000",
      },
    });
    const sale = await owner.request("POST", "/api/sales", {
      venueId: v.id,
      packageId: pkg.id,
      method: "cash",
      phone: null,
    });
    expect(sale.status).toBe(403);
    expect(sale.body).toMatchObject({ code: "SELLING_PAUSED" });
    expect((await owner.request("DELETE", `/api/packages/${pkg.id}`)).status).toBe(403);
    const me = (await owner.request("GET", "/api/me")).body as Me;
    // The actions stay in view, paused: the web says why instead of hiding them.
    expect(me.active).toMatchObject({ pause: "overdue" });
    expect(me.active.capabilities).toContain("package.manage");
    const venue = (await owner.request("GET", `/api/venues/${v.id}`)).body as {
      venue: VenueRecord;
    };
    expect(venue.venue.selling).toEqual({ state: "paused" });
    const router = await t.db.router.findFirstOrThrow({ where: { venueId: v.id } });
    const portal = (
      await browser(api).request("POST", "/api/guest/context", {
        router: router.id,
        mac: "AA:BB:CC:DD:EE:01",
        ip: "192.168.88.20",
      })
    ).body as GuestContext;
    expect(portal).toMatchObject({ selling: false, packages: [] });

    // Paying what is overdue restores it at once.
    const asha = await staff("manager", "asha@example.com");
    const paid = await asha.request("POST", "/api/billing/payments", {
      businessId: v.businessId,
      invoiceId: september.id,
      amountTsh: 6_140,
      receivedOn: "2026-10-22",
      method: "mobile_money",
      reference: "TXN 1",
    });
    expect(paid.status).toBe(204);
    expect(await access()).toBe("enabled");
    expect(api.email.sent.map((m) => m.subject)).toContain("Test Business can sell again");
    expect(await issues(grace)).toEqual([]);
  });

  test("a first late bill stays in its grace period, and managers hear nothing", async () => {
    await home();
    const grace = await signedIn("business_manager", "grace@example.com");
    await fees("2026-09-07", 5_875, "2026-09-05");
    await fees("2026-10-07", 6_140);
    await sync("2026-11-03");
    expect(await access()).toBe("grace_period");
    expect(
      ((await grace.request("GET", "/api/issues?status=open")).body as IssueList).issues,
    ).toEqual([]);
  });
});

describe("service access by hand", () => {
  test("the team holds a state until a day; only the admin suspends; bills take back over", async () => {
    await home();
    await signedIn("owner", "juma@example.com");
    await fees("2026-09-07", 5_875, "2026-09-12");
    await fees("2026-10-07", 6_140);
    await sync("2026-10-25");
    const id = await testBusinessId(t.db);
    const asha = await staff("manager", "asha@example.com");
    const path = `/api/businesses/${id}/service-access`;

    const suspend = await asha.request("PUT", path, {
      mode: "hold",
      access: "suspended",
      reason: "policy_violation",
      note: "Reported",
    });
    expect(suspend.status).toBe(403);

    const hold = await asha.request("PUT", path, {
      mode: "hold",
      access: "enabled",
      days: 7,
      reason: "payment_arranged",
      note: "Pays on Friday",
      message: "Thanks for arranging it.",
    });
    expect(hold.status).toBe(200);
    // Seven days, today included.
    expect(hold.body).toMatchObject({
      access: "enabled",
      held: true,
      heldUntil: addDays(businessDayOf(new Date()), 6),
    });
    const told = api.email.sent.find(
      (m) => m.subject === "Test Business's service is back to normal",
    );
    expect(told?.text).toContain("as a payment was arranged");
    expect(told?.text).toContain("Thanks for arranging it.");
    expect(told?.text).not.toContain("Pays on Friday");
    // The hourly run keeps a hold.
    await sync("2026-10-26");
    expect(await access()).toBe("enabled");

    const paul = await staff("admin", "paul@example.com");
    const back = await paul.request("PUT", path, {
      mode: "bills",
      reason: "other",
      note: "Did not pay",
    });
    expect(back.body).toMatchObject({ access: "read_only", held: false });
    const got = await paul.request("GET", `/api/businesses/${id}`);
    expect(got.status).toBe(200);
    const detail = got.body as BusinessDetail;
    expect(detail.serviceAccess.overdueTsh).toBe(6_140);
    // A platform operator sees the state, never the sums (billing is the admin's and managers').
    await platformMember(t.db, { email: "hamisi@example.com", name: "Hamisi", role: "operator" });
    const hamisi = browser(api);
    await enrollAuthenticatorFor(api, hamisi, "hamisi@example.com");
    const seen = (await hamisi.request("GET", `/api/businesses/${id}`)).body as BusinessDetail;
    expect(seen.serviceAccess).toMatchObject({ access: "read_only", overdueTsh: null });
    expect(detail.serviceAccess.changes.map((c) => [c.access, c.held, c.by])).toEqual([
      ["read_only", false, "paul@example.com"],
      ["enabled", true, "asha@example.com"],
      // Found already 14 days overdue, it went straight to read-only.
      ["read_only", false, null],
    ]);
  });

  test("a hold ends after its last day, and the business follows its bills again", async () => {
    await home();
    await signedIn("owner", "juma@example.com");
    await fees("2026-09-07", 5_875, "2026-09-12");
    await fees("2026-10-07", 6_140);
    const asha = await staff("manager", "asha@example.com");
    await asha.request("PUT", `/api/businesses/${await testBusinessId(t.db)}/service-access`, {
      mode: "hold",
      access: "enabled",
      days: 30,
      reason: "payment_arranged",
      note: "x",
    });
    await t.db.business.updateMany({
      data: { accessHeldUntil: new Date("2026-10-25T00:00:00Z") },
    });
    await sync("2026-10-25");
    expect(await access()).toBe("enabled");
    await sync("2026-10-26");
    expect(await access()).toBe("read_only");
    // Its owners hear that the hold ended and its bills set it again, not of a payment.
    const ended = api.email.sent.filter((m) => m.subject === "Selling is paused at Test Business");
    expect(ended.at(-1)?.text).toContain("hold on Test Business's service has ended");
  });

  test("a manager changes only along the allowed steps; a paused-by-hand business says so", async () => {
    const v = await home();
    const owner = await signedIn("owner", "juma@example.com");
    const id = await testBusinessId(t.db);
    const asha = await staff("manager", "asha@example.com");
    const path = `/api/businesses/${id}/service-access`;
    const hold = (access: string) =>
      asha.request("PUT", path, { mode: "hold", access, reason: "policy_violation", note: "x" });
    expect((await hold("read_only")).status).toBe(200);
    // Read-only to a grace period is not one of ADR-0014's steps: the admin's override.
    expect((await hold("grace_period")).status).toBe(403);
    const paul = await staff("admin", "paul@example.com");
    expect(
      (
        await paul.request("PUT", path, {
          mode: "hold",
          access: "grace_period",
          reason: "other",
          note: "Override",
        })
      ).status,
    ).toBe(200);
    expect((await hold("read_only")).status).toBe(200);
    // Paused by HashiNet's team, not by a bill: nothing says to pay.
    const me = (await owner.request("GET", "/api/me")).body as Me;
    expect(me.active.pause).toBe("held");
    const pkg = await t.db.package.create({
      data: {
        businessId: v.businessId,
        name: "Day",
        durationMinutes: 1440,
        downloadSpeedMbps: 5,
        priceTsh: "1000",
      },
    });
    const sale = await owner.request("POST", "/api/sales", {
      venueId: v.id,
      packageId: pkg.id,
      method: "cash",
      phone: null,
    });
    expect(sale.body).toMatchObject({ code: "SELLING_PAUSED" });
    expect((sale.body as { message: string }).message).toContain("HashiNet's team has paused");
  });
});
