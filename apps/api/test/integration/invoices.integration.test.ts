import { describe, expect, test } from "bun:test";
import type { InvoiceList, InvoiceRecord } from "@hashinet/types";
import { Invoices } from "../../src/billing/invoices.js";
import { browser, type Client, enrollAuthenticatorFor, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, platformMember, sellingVenue, testBusinessId } from "./people.js";

const t = useTestDatabase();
const api = useApi();

const NOV = "2026-11-01";
/** An instant in Dar es Salaam (UTC+3) on a November day, at an hour of that day. */
const dar = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour - 3));
const AFTER = new Date(Date.UTC(2026, 11, 1, 6));

let codes = 0;
/** A voucher sold at `venueId` for `tsh`, paid at `at`; refunded at `refundedAt` if given. */
async function sale(venueId: string, tsh: number, at: Date, refundedAt: Date | null = null) {
  const businessId = await testBusinessId(t.db);
  const pkg =
    (await t.db.package.findFirst({ where: { businessId } })) ??
    (await t.db.package.create({
      data: {
        businessId,
        name: "1 day",
        durationMinutes: 1440,
        downloadSpeedMbps: 10,
        priceTsh: tsh,
      },
    }));
  const voucher = await t.db.voucher.create({
    data: {
      code: String(100_000_000_000 + ++codes),
      venueId,
      packageId: pkg.id,
      priceTsh: tsh,
      status: refundedAt ? "refunded" : "unused",
    },
  });
  const payment = await t.db.payment.create({
    data: {
      provider: "cash",
      status: "paid",
      paidAt: at,
      amountTsh: tsh,
      venueId,
      voucherId: voucher.id,
    },
  });
  if (refundedAt) {
    await t.db.refund.create({
      data: {
        voucherId: voucher.id,
        paymentId: payment.id,
        venueId,
        amountTsh: tsh,
        method: "cash",
        createdAt: refundedAt,
      },
    });
  }
}

/** A venue of the test business, set up and serving, its first guest online on `completed`. */
async function venue(name: string, completed: Date | null) {
  const businessId = await testBusinessId(t.db);
  const v = await t.db.venue.create({
    data: { businessId, name, region: "Dar es Salaam", area: "Mbezi" },
  });
  await sellingVenue(t.db, v.id);
  await t.db.venueOnboarding.create({ data: { venueId: v.id, completedAt: completed } });
  return v;
}

async function owner(): Promise<Client> {
  await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, "owner@example.com");
  return c;
}

describe("a month's invoice", () => {
  test("each venue's net sales, its fee by the bands, and the minimum prorated by days served", async () => {
    const c = await owner();
    // Served since October: the minimum applies in November.
    const home = await venue("Home", new Date(Date.UTC(2026, 9, 10)));
    const router = await t.db.router.findFirstOrThrow({ where: { venueId: home.id } });
    // Down from the 5th to the 15th: ten days of thirty.
    await t.db.routerOutage.create({
      data: { routerId: router.id, kind: "offline", startedAt: dar(5, 0), endedAt: dar(15, 0) },
    });
    await sale(home.id, 20_000, dar(3));
    // Refunded the same month: it counts for nothing.
    await sale(home.id, 1_500, dar(4), dar(6));
    // Sold in October, refunded in November: the refund counts in November.
    await sale(home.id, 1_000, new Date(Date.UTC(2026, 9, 30)), dar(2));
    // 00:30 on 1 December in Dar es Salaam is December's.
    await sale(home.id, 9_000, new Date(Date.UTC(2026, 10, 30, 21, 30)));

    const big = await venue("Hotel", new Date(Date.UTC(2026, 9, 1)));
    await sale(big.id, 4_000_000, dar(20));

    const invoices = api.app.get(Invoices);
    const before = api.email.sent.length;
    expect(await invoices.issueMonth(NOV, AFTER)).toBe(1);
    // Once a business a month, however often it runs.
    expect(await invoices.issueMonth(NOV, AFTER)).toBe(0);

    const { invoices: list } = (await c.request("GET", "/api/billing/invoices"))
      .body as InvoiceList;
    expect(list).toHaveLength(1);
    const invoice = list[0] as InvoiceRecord;
    expect(invoice).toMatchObject({
      kind: "monthly_fees",
      period: "2026-11",
      dueOn: "2026-12-07",
      // Home: 5% of TSh 19,000 is 950, under two thirds of the minimum. Hotel: 150,000.
      totalTsh: 3_333 + 150_000,
      paidTsh: 0,
      // Read today: overdue once 7 December has passed.
      state: new Date().toISOString().slice(0, 10) > "2026-12-07" ? "overdue" : "due",
    });
    expect(invoice.number).toMatch(/^INV-2026-12-\d{4}$/);
    expect(invoice.lines).toEqual([
      {
        label: "Home",
        venueId: home.id,
        onboardingKind: null,
        netSalesTsh: 19_000,
        servedBp: 6_667,
        minimumTsh: 3_333,
        amountTsh: 3_333,
      },
      {
        label: "Hotel",
        venueId: big.id,
        onboardingKind: null,
        netSalesTsh: 4_000_000,
        servedBp: 10_000,
        minimumTsh: null,
        amountTsh: 150_000,
      },
    ]);
    const mail = api.email.sent.slice(before).find((m) => m.to === "owner@example.com");
    expect(mail?.subject).toBe(`Invoice ${invoice.number}: HashiNet's fees for November 2026`);
    expect(mail?.text).toContain("TSh 153,333, due by 7 December 2026");
  });

  test("the minimum starts with the first full month after setup; a month with no fee issues nothing", async () => {
    const c = await owner();
    // Set up on the 10th of November: November pays only its 5%.
    const late = await venue("Late", dar(10));
    await sale(late.id, 10_000, dar(12));
    const invoices = api.app.get(Invoices);
    expect(await invoices.issueMonth(NOV, AFTER)).toBe(1);
    const { invoices: list } = (await c.request("GET", "/api/billing/invoices"))
      .body as InvoiceList;
    expect(list[0]?.lines[0]).toMatchObject({
      netSalesTsh: 10_000,
      minimumTsh: null,
      amountTsh: 500,
    });
    // October: nothing sold, no minimum yet.
    expect(await invoices.issueMonth("2026-10-01", AFTER)).toBe(0);
  });
});

describe("who reads invoices", () => {
  test("the owner reads their own; HashiNet's staff name the business; nobody else", async () => {
    const c = await owner();
    const home = await venue("Home", new Date(Date.UTC(2026, 9, 10)));
    await sale(home.id, 200_000, dar(3));
    await api.app.get(Invoices).issueMonth(NOV, AFTER);
    const [mine] = ((await c.request("GET", "/api/billing/invoices")).body as InvoiceList).invoices;
    expect(mine).toBeDefined();

    await businessMember(t.db, { email: "bm@example.com", name: "BM", role: "business_manager" });
    const manager = browser(api);
    await enrollAuthenticatorFor(api, manager, "bm@example.com");
    expect((await manager.request("GET", "/api/billing/invoices")).status).toBe(403);

    const other = await t.db.business.create({
      data: { name: "Other", region: "Dar es Salaam", area: "Sinza" },
    });
    await businessMember(t.db, {
      email: "other@example.com",
      name: "Other",
      role: "owner",
      businessId: other.id,
    });
    const stranger = browser(api);
    await enrollAuthenticatorFor(api, stranger, "other@example.com");
    expect((await stranger.request("GET", `/api/billing/invoices/${mine?.id}`)).status).toBe(404);
    expect(
      ((await stranger.request("GET", "/api/billing/invoices")).body as InvoiceList).invoices,
    ).toEqual([]);

    await platformMember(t.db, { email: "asha@example.com", name: "Asha", role: "manager" });
    const asha = browser(api);
    await enrollAuthenticatorFor(api, asha, "asha@example.com");
    const theirs = await asha.request(
      "GET",
      `/api/billing/invoices?businessId=${await testBusinessId(t.db)}`,
    );
    expect((theirs.body as InvoiceList).invoices.map((i) => i.id)).toEqual([mine?.id]);
    await platformMember(t.db, { email: "hamisi@example.com", name: "Hamisi", role: "operator" });
    const hamisi = browser(api);
    await enrollAuthenticatorFor(api, hamisi, "hamisi@example.com");
    expect((await hamisi.request("GET", `/api/billing/invoices/${mine?.id}`)).status).toBe(403);
  });
});

describe("an onboarding charge", () => {
  test("confirming a package with a charge invoices it, due 7 days later; changing it before payment updates it", async () => {
    await platformMember(t.db, { email: "asha@example.com", name: "Asha", role: "manager" });
    const asha = browser(api);
    await enrollAuthenticatorFor(api, asha, "asha@example.com");
    const c = await owner();
    const created = await asha.request("POST", "/api/venues", {
      businessId: await testBusinessId(t.db),
      name: "Baraka's Cafe",
      region: "Dar es Salaam",
      area: "Mjimwema",
    });
    const venueId = (created.body as { venue: { id: string } }).venue.id;
    const confirm = (lines: { kind: string; description: string; amountTsh: number }[]) =>
      asha.request("POST", `/api/venues/${venueId}/onboarding/confirm`, { plan: "install", lines });
    const before = api.email.sent.length;
    expect(
      (
        await confirm([
          { kind: "onboarding_fee", description: "In town", amountTsh: 50_000 },
          { kind: "mikrotik_router", description: "hAP ax²", amountTsh: 250_000 },
        ])
      ).status,
    ).toBe(200);

    const read = async () =>
      ((await c.request("GET", "/api/billing/invoices")).body as InvoiceList).invoices;
    const [first] = await read();
    const today = new Date().toISOString().slice(0, 10);
    expect(first).toMatchObject({
      kind: "onboarding",
      venueName: "Baraka's Cafe",
      period: null,
      totalTsh: 300_000,
      lines: [
        { label: "In town", onboardingKind: "onboarding_fee", amountTsh: 50_000 },
        { label: "hAP ax²", onboardingKind: "mikrotik_router", amountTsh: 250_000 },
      ],
    });
    const due = new Date(`${today}T12:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 7);
    expect(first?.dueOn).toBe(due.toISOString().slice(0, 10));
    expect(
      api.email.sent.slice(before).some((m) => m.subject.endsWith("Baraka's Cafe's onboarding")),
    ).toBe(true);

    // The router came cheaper on a second call.
    const changed = await confirm([
      { kind: "onboarding_fee", description: "In town", amountTsh: 50_000 },
      { kind: "mikrotik_router", description: "hAP ax²", amountTsh: 200_000 },
    ]);
    expect(changed.status).toBe(200);
    const [again] = await read();
    expect(again).toMatchObject({ id: first?.id, number: first?.number, totalTsh: 250_000 });

    // Agreed free: no charge, no invoice.
    const free = await asha.request("POST", `/api/venues/${venueId}/onboarding/confirm`, {
      plan: "connect",
      lines: [{ kind: "onboarding_fee", description: "In town", amountTsh: 0 }],
    });
    expect(free.status).toBe(200);
    expect(await read()).toEqual([]);
  });
});

describe("payments", () => {
  /** Two monthly invoices and an onboarding charge for the test business, oldest first. */
  async function owing() {
    const businessId = await testBusinessId(t.db);
    const invoice = (
      number: string,
      kind: "monthly_fees" | "onboarding",
      dueOn: string,
      total: number,
    ) =>
      t.db.invoice.create({
        data: {
          number,
          businessId,
          kind,
          period: kind === "monthly_fees" ? new Date(`${dueOn.slice(0, 8)}01T00:00:00Z`) : null,
          issuedAt: new Date(`${dueOn}T06:00:00Z`),
          dueOn: new Date(`${dueOn}T00:00:00Z`),
          totalTsh: total,
          lines: { create: [{ position: 0, label: "Home", amountTsh: total }] },
        },
      });
    return {
      businessId,
      october: await invoice("INV-2026-11-0901", "monthly_fees", "2026-10-07", 10_000),
      november: await invoice("INV-2026-12-0902", "monthly_fees", "2026-11-07", 20_000),
      charge: await invoice("INV-2026-11-0903", "onboarding", "2026-11-20", 50_000),
    };
  }
  const today = () => new Date().toISOString().slice(0, 10);
  async function staffClient(role: "admin" | "manager" | "operator") {
    await platformMember(t.db, { email: `${role}@example.com`, name: role, role });
    const c = browser(api);
    await enrollAuthenticatorFor(api, c, `${role}@example.com`);
    return c;
  }
  const paidOf = async (id: string) =>
    (await t.db.billAllocation.aggregate({ where: { invoiceId: id }, _sum: { amountTsh: true } }))
      ._sum.amountTsh ?? 0;

  test("on the business it settles the oldest first; a part leaves the rest due", async () => {
    const { businessId, october, november, charge } = await owing();
    const asha = await staffClient("manager");
    const pay = (amountTsh: number) =>
      asha.request("POST", "/api/billing/payments", {
        businessId,
        invoiceId: null,
        amountTsh,
        receivedOn: today(),
        method: "bank_transfer",
        reference: "FT26330XK12",
      });
    // Everything owed is TSh 80,000; more is refused, and nothing is recorded.
    expect((await pay(80_001)).status).toBe(400);
    expect((await pay(25_000)).status).toBe(204);
    expect(await paidOf(october.id)).toBe(10_000);
    expect(await paidOf(november.id)).toBe(15_000);
    expect(await paidOf(charge.id)).toBe(0);
    const audit = await t.db.auditLog.findFirstOrThrow({ where: { action: "billing.payment" } });
    expect(audit).toMatchObject({ businessId });
    expect(audit.change).toMatchObject({
      after: { amountTsh: 25_000, settles: "INV-2026-11-0901, INV-2026-12-0902" },
    });
  });

  test("on an invoice it settles that invoice, whatever is older", async () => {
    const { businessId, october, charge } = await owing();
    const admin = await staffClient("admin");
    const pay = (amountTsh: number) =>
      admin.request("POST", "/api/billing/payments", {
        businessId,
        invoiceId: charge.id,
        amountTsh,
        receivedOn: today(),
        method: "mobile_money",
        reference: "",
      });
    expect((await pay(50_001)).status).toBe(400);
    expect((await pay(50_000)).status).toBe(204);
    expect(await paidOf(charge.id)).toBe(50_000);
    expect(await paidOf(october.id)).toBe(0);
    // Paid: nothing more is taken on it.
    expect((await pay(1)).status).toBe(409);
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect(
      (
        await admin.request("POST", "/api/billing/payments", {
          businessId,
          invoiceId: null,
          amountTsh: 1_000,
          receivedOn: tomorrow,
          method: "cash",
          reference: "",
        })
      ).status,
    ).toBe(400);
  });

  test("only HashiNet's admin and managers record payments and remind", async () => {
    const { businessId } = await owing();
    const body = {
      businessId,
      invoiceId: null,
      amountTsh: 1_000,
      receivedOn: today(),
      method: "cash",
      reference: "",
    };
    const hamisi = await staffClient("operator");
    expect((await hamisi.request("POST", "/api/billing/payments", body)).status).toBe(403);
    expect((await hamisi.request("POST", "/api/billing/reminders", { businessId })).status).toBe(
      403,
    );
    const c = await owner();
    expect((await c.request("POST", "/api/billing/payments", body)).status).toBe(403);
  });
});

describe("reminders", () => {
  test("Remind emails the owner what is owed, and a due date left unpaid reminds once", async () => {
    const c = await owner();
    const home = await venue("Home", new Date(Date.UTC(2026, 9, 10)));
    await sale(home.id, 200_000, dar(3));
    const invoices = api.app.get(Invoices);
    await invoices.issueMonth(NOV, AFTER);
    const [invoice] = ((await c.request("GET", "/api/billing/invoices")).body as InvoiceList)
      .invoices;

    await platformMember(t.db, { email: "asha@example.com", name: "Asha", role: "manager" });
    const asha = browser(api);
    await enrollAuthenticatorFor(api, asha, "asha@example.com");
    const before = api.email.sent.length;
    const businessId = await testBusinessId(t.db);
    expect((await asha.request("POST", "/api/billing/reminders", { businessId })).status).toBe(204);
    const sent = api.email.sent.slice(before).filter((m) => m.to === "owner@example.com");
    expect(sent.at(-1)?.subject).toBe("Test Business owes HashiNet TSh 10,000");
    expect(sent.at(-1)?.text).toContain(`${invoice?.number}, HashiNet's fees for November 2026`);
    expect(await t.db.auditLog.count({ where: { action: "billing.remind", businessId } })).toBe(1);

    // On 7 December, still unpaid: one reminder, however often the job runs.
    const dueDay = new Date(Date.UTC(2026, 11, 7, 6));
    const mark = api.email.sent.length;
    await invoices.remindDue(new Date(Date.UTC(2026, 11, 6, 6)));
    expect(api.email.sent.length).toBe(mark);
    await invoices.remindDue(dueDay);
    await invoices.remindDue(dueDay);
    await Bun.sleep(50);
    expect(api.email.sent.slice(mark).filter((m) => m.to === "owner@example.com")).toHaveLength(1);
  });
});
