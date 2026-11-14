import { describe, expect, test } from "bun:test";
import { browser, enrollAuthenticatorFor, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, protectedOwner, testBusinessId } from "./people.js";

/**
 * No provider credentials: what launches. A sale at the counter needs neither provider: the money
 * is in hand, by cash or mobile money to the venue's own number (ADR-0017).
 */
const t = useTestDatabase();
const api = useApi();

async function setting() {
  await protectedOwner(t.db);
  const venue = await t.db.venue.create({
    data: {
      businessId: await testBusinessId(t.db),
      name: "Cafe",
      region: "Dar es Salaam",
      area: "Dar",
    },
  });
  const router = await t.db.router.create({
    data: { venueId: venue.id, name: "Lobby", ipAddress: "192.168.88.2" },
  });
  const pkg = await t.db.package.create({
    data: {
      businessId: await testBusinessId(t.db),
      name: "Day",
      durationMinutes: 1440,
      downloadSpeedMbps: 5,
      priceTsh: "2000",
    },
  });
  return { venue, router, pkg };
}

const post = (path: string, body: unknown) =>
  fetch(`${api.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));

describe("without mobile money or SMS", () => {
  test("the portal is for vouchers, and nobody can be charged", async () => {
    const { router, pkg } = await setting();
    const device = { router: router.id, mac: "AA:BB:CC:00:00:03", ip: "10.5.50.20" };
    const context = await post("/api/guest/context", device);
    expect(context.body).toMatchObject({ mobileMoney: false, packages: [{ name: "Day" }] });
    const buying = await post("/api/guest/payments", {
      ...device,
      packageId: pkg.id,
      phone: "0712345678",
    });
    expect(buying.status).toBe(503);
    expect(buying.body).toMatchObject({ code: "PAYMENTS_OFF" });
    expect(await t.db.payment.count()).toBe(0);
  });

  test("staff sell at the counter: cash, or mobile money with the guest's number", async () => {
    await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
    const c = browser(api);
    await enrollAuthenticatorFor(api, c, "owner@example.com");
    expect((await c.request("GET", "/api/capabilities")).body).toEqual({
      mobileMoney: false,
      sms: false,
    });
    const { venue, pkg } = await setting();
    const sell = (body: object) =>
      c.request("POST", "/api/sales", { venueId: venue.id, packageId: pkg.id, ...body });

    const cash = await sell({ method: "cash" });
    expect(cash.status).toBe(201);
    expect(cash.body).toMatchObject({ code: expect.stringMatching(/^\d{12}$/) });

    const noNumber = await sell({ method: "mobile_money" });
    expect(noNumber.status).toBe(400);
    expect(noNumber.body).toMatchObject({ details: { phone: "is required for mobile money" } });
    const mobile = await sell({ method: "mobile_money", phone: "0754218640" });
    expect(mobile.status).toBe(201);

    // Each sale made its one voucher, paid at the package's price, and names who sold it.
    const payments = await t.db.payment.findMany({ include: { voucher: true } });
    expect(payments).toHaveLength(2);
    for (const p of payments) {
      expect(p.status).toBe("paid");
      expect(Number(p.amountTsh)).toBe(2000);
      expect(p.voucher?.priceTsh.toString()).toBe("2000");
      expect(p.recordedById).not.toBeNull();
    }
    expect(payments.map((p) => p.provider).sort()).toEqual(["cash", "mobile_money"]);
    expect(await t.db.voucher.count()).toBe(2);
  });
});
