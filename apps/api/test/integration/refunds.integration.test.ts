import { describe, expect, test } from "bun:test";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, testBusinessId } from "./people.js";

const t = useTestDatabase();
const api = useApi();

async function signedIn(
  role: "owner" | "venue_manager" | "venue_operator",
  email: string,
  venueIds: string[] = [],
): Promise<Client> {
  await businessMember(t.db, { email, name: email, role, venueIds });
  const c = browser(api);
  if (role === "venue_operator") await signInWithCode(api, c, email);
  else await enrollAuthenticatorFor(api, c, email);
  return c;
}

async function setting() {
  const businessId = await testBusinessId(t.db);
  const venue = await t.db.venue.create({
    data: { businessId, name: "Kijiwe Cafe", region: "Mwanza", area: "Kirumba" },
  });
  const pkg = await t.db.package.create({
    data: {
      businessId,
      name: "1 day",
      durationMinutes: 1440,
      downloadSpeedMbps: 10,
      priceTsh: 1500,
    },
  });
  return { venue, pkg };
}

async function sell(c: Client, venueId: string, packageId: string) {
  const sold = await c.request("POST", "/api/sales", { venueId, packageId, method: "cash" });
  expect(sold.status).toBe(201);
  const { code } = sold.body as { code: string };
  return t.db.voucher.findUniqueOrThrow({ where: { code } });
}

type Today = { sold: number; takingsTsh: string; refundsTsh: string; yourCashTsh: string };

describe("refunds", () => {
  test("an owner refunds an unused voucher: it stops working, and the money shows as its own line", async () => {
    const { venue, pkg } = await setting();
    const owner = await signedIn("owner", "neema@example.com");
    const musa = await signedIn("venue_operator", "musa@example.com", [venue.id]);
    const voucher = await sell(musa, venue.id, pkg.id);
    await sell(musa, venue.id, pkg.id);

    const refunded = await owner.request("POST", `/api/vouchers/${voucher.id}/refund`, {
      method: "cash",
      reason: "Wrong package",
    });
    expect(refunded.status).toBe(200);
    expect(refunded.body).toMatchObject({ voucher: { status: "refunded" } });
    const row = await t.db.refund.findUniqueOrThrow({ where: { voucherId: voucher.id } });
    expect(Number(row.amountTsh)).toBe(1500);
    expect(row).toMatchObject({ method: "cash", reason: "Wrong package", phone: null });

    // Today: two sold, 3,000 taken, 1,500 given back, 1,500 net. The seller's cash is still theirs:
    // they sold 3,000 in cash and gave nothing back.
    expect((await owner.request("GET", "/api/analytics/today")).body).toMatchObject({
      sold: 2,
      takingsTsh: "1500.00",
      refundsTsh: "1500.00",
    });
    expect(((await musa.request("GET", "/api/analytics/today")).body as Today).yourCashTsh).toBe(
      "3000.00",
    );
    expect(((await owner.request("GET", "/api/analytics/today")).body as Today).yourCashTsh).toBe(
      "-1500.00",
    );

    // Payments: the sale stays as it was, and the refund is its own row with a negative amount.
    const received = (await owner.request("GET", "/api/payments/received")).body as {
      totalTsh: string;
      payments: { kind: string; amountTsh: string; by: string | null }[];
    };
    expect(received.totalTsh).toBe("1500.00");
    // Each row names who sold it, or who gave it back.
    expect(received.payments.map((p) => [p.kind, p.amountTsh, p.by]).sort()).toEqual([
      ["refund", "-1500.00", "neema@example.com"],
      ["sale", "1500.00", "musa@example.com"],
      ["sale", "1500.00", "musa@example.com"],
    ]);
    // An operator's own day: only the rows they made, on that business day.
    const { day } = (await musa.request("GET", "/api/analytics/today")).body as { day: string };
    const own = async (c: Client, on: string) =>
      (await c.request("GET", `/api/payments/received?by=me&day=${on}`)).body as {
        totalTsh: string;
        payments: { kind: string }[];
      };
    expect(await own(musa, day)).toMatchObject({ totalTsh: "3000.00" });
    expect((await own(musa, day)).payments.map((p) => p.kind)).toEqual(["sale", "sale"]);
    expect(await own(owner, day)).toMatchObject({ totalTsh: "-1500.00" });
    expect((await own(musa, "2020-01-01")).payments).toEqual([]);

    const audit = await t.db.auditLog.findFirstOrThrow({ where: { action: "voucher.refund" } });
    expect(audit.venueId).toBe(venue.id);
  });

  test("only an owner or a manager refunds, once, only while unused, and mobile money says where", async () => {
    const { venue, pkg } = await setting();
    const owner = await signedIn("owner", "neema@example.com");
    const musa = await signedIn("venue_operator", "musa@example.com", [venue.id]);
    const daudi = await signedIn("venue_manager", "daudi@example.com", [venue.id]);
    const one = await sell(musa, venue.id, pkg.id);
    const refund = (c: Client, id: string, body: object) =>
      c.request("POST", `/api/vouchers/${id}/refund`, body);

    expect((await refund(musa, one.id, { method: "cash" })).status).toBe(403);
    const noWhere = await refund(daudi, one.id, { method: "mobile_money" });
    expect(noWhere.status).toBe(400);
    expect(noWhere.body).toMatchObject({
      details: { phone: "is required for mobile money", reference: "is required for mobile money" },
    });
    const byPhone = await refund(daudi, one.id, {
      method: "mobile_money",
      phone: "0754218640",
      reference: "QK81Z2",
    });
    expect(byPhone.status).toBe(200);
    expect((await refund(owner, one.id, { method: "cash" })).status).toBe(409);

    const used = await sell(musa, venue.id, pkg.id);
    await t.db.voucher.update({ where: { id: used.id }, data: { status: "active" } });
    expect((await refund(owner, used.id, { method: "cash" })).status).toBe(409);
    expect(await t.db.refund.count()).toBe(1);
  });
});
