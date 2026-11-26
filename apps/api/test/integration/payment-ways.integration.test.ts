import { describe, expect, test } from "bun:test";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, sellingVenue, testBusinessId } from "./people.js";

const t = useTestDatabase();
const api = useApi();

async function signedIn(
  role: "owner" | "business_manager" | "venue_manager" | "venue_operator",
  email: string,
  venueIds: string[] = [],
): Promise<Client> {
  await businessMember(t.db, { email, name: email, role, venueIds });
  const c = browser(api);
  if (role === "venue_operator") await signInWithCode(api, c, email);
  else await enrollAuthenticatorFor(api, c, email);
  return c;
}

async function venue(name: string) {
  return t.db.venue.create({
    data: { businessId: await testBusinessId(t.db), name, region: "Mwanza", area: "Kirumba" },
  });
}

const LIPA = { kind: "lipa_namba", number: "5123 4567", name: "NEEMA HOSPITALITY", label: "Lodge" };
const CAFE = { kind: "lipa_namba", number: "6620 1188", name: "KIJIWE CAFE" };
const BANK = {
  kind: "bank_account",
  provider: "CRDB Bank",
  branch: "Mwanza",
  number: "0150 3381 4420",
  name: "NEEMA HOSPITALITY LTD",
};

interface Way {
  id: string;
  through: string;
  number: string;
  isDefault: boolean;
  venues: { name: string }[];
}
const ways = (body: unknown) => (body as { ways: Way[] }).ways;

describe("a business's ways to pay", () => {
  test("the first is the default; venues read out theirs or the default", async () => {
    const lodge = await venue("Mama Neema Lodge");
    const cafe = await venue("Kijiwe Cafe");
    const owner = await signedIn("owner", "neema@example.com");
    expect((await owner.request("GET", "/api/payment-ways")).body).toEqual({ ways: [] });
    expect((await owner.request("GET", `/api/venues/${cafe.id}/payment-way`)).body).toEqual({
      way: null,
      choiceId: null,
    });

    const first = ways((await owner.request("POST", "/api/payment-ways", LIPA)).body);
    expect(first).toMatchObject([
      { through: "Lipa namba", label: "Lodge", provider: null, isDefault: true },
    ]);
    const added = ways((await owner.request("POST", "/api/payment-ways", CAFE)).body);
    const cafeWay = added.find((w) => w.number === CAFE.number);
    expect(cafeWay?.isDefault).toBe(false);

    // The café chooses its own till; the lodge keeps the default.
    const chose = await owner.request("PUT", `/api/venues/${cafe.id}/payment-way`, {
      wayId: cafeWay?.id,
    });
    expect(chose.body).toMatchObject({ way: { number: CAFE.number }, choiceId: cafeWay?.id });
    const listed = ways((await owner.request("GET", "/api/payment-ways")).body);
    expect(listed.map((w) => [w.number, w.venues.map((v) => v.name)])).toEqual([
      [LIPA.number, [lodge.name]],
      [CAFE.number, [cafe.name]],
    ]);

    // Whoever sells at the café reads its way and changes nothing.
    const musa = await signedIn("venue_operator", "musa@example.com", [cafe.id]);
    expect((await musa.request("GET", `/api/venues/${cafe.id}/payment-way`)).body).toMatchObject({
      way: { through: "Lipa namba", number: CAFE.number, name: CAFE.name },
    });
    expect((await musa.request("GET", "/api/payment-ways")).status).toBe(403);
    expect(
      (await musa.request("PUT", `/api/venues/${cafe.id}/payment-way`, { wayId: null })).status,
    ).toBe(403);
  });

  test("the default can't be removed; removing another moves its venues to the default", async () => {
    const cafe = await venue("Kijiwe Cafe");
    const owner = await signedIn("owner", "neema@example.com");
    const [lipa] = ways((await owner.request("POST", "/api/payment-ways", LIPA)).body);
    const bank = ways((await owner.request("POST", "/api/payment-ways", BANK)).body).find(
      (w) => w.number === BANK.number,
    );
    await owner.request("PUT", `/api/venues/${cafe.id}/payment-way`, { wayId: bank?.id });

    const refused = await owner.request("DELETE", `/api/payment-ways/${lipa?.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "PAYMENT_WAY_IS_DEFAULT" });

    const left = ways((await owner.request("DELETE", `/api/payment-ways/${bank?.id}`)).body);
    expect(left.map((w) => w.number)).toEqual([LIPA.number]);
    expect((await owner.request("GET", `/api/venues/${cafe.id}/payment-way`)).body).toMatchObject({
      way: { number: LIPA.number },
      choiceId: null,
    });

    // Making another the default lets the first go.
    const again = ways(
      (await owner.request("POST", "/api/payment-ways", { ...CAFE, makeDefault: true })).body,
    );
    expect(again.find((w) => w.isDefault)?.number).toBe(CAFE.number);
    expect((await owner.request("DELETE", `/api/payment-ways/${lipa?.id}`)).status).toBe(200);
    expect(
      (await t.db.auditLog.findMany({ orderBy: { createdAt: "asc" } }))
        .map((a) => a.action)
        .filter((a) => a.startsWith("payment_way")),
    ).toEqual([
      "payment_way.create",
      "payment_way.create",
      "payment_way.delete",
      "payment_way.create",
      "payment_way.delete",
    ]);
  });

  test("each kind asks for what it needs", async () => {
    await venue("Kijiwe Cafe");
    const owner = await signedIn("owner", "neema@example.com");
    const post = (way: unknown) => owner.request("POST", "/api/payment-ways", way);
    expect((await post({ ...BANK, provider: "" })).status).toBe(400);
    expect((await post({ kind: "mobile_number", number: "0754 000 111", name: "X" })).status).toBe(
      400,
    );
    expect((await post({ ...LIPA, number: "51-23" })).status).toBe(400);
    expect((await post({ ...LIPA, name: " " })).status).toBe(400);
    // A Lipa namba keeps no provider or branch, whatever is sent.
    const [w] = ways((await post({ ...LIPA, provider: "X", branch: "Y" })).body);
    expect(w).toMatchObject({ provider: null, branch: null });
  });

  test("the whole business keeps the list; a venue manager chooses only for their venues", async () => {
    const cafe = await venue("Kijiwe Cafe");
    const lodge = await venue("Mama Neema Lodge");
    const grace = await signedIn("business_manager", "grace@example.com");
    const [way] = ways((await grace.request("POST", "/api/payment-ways", LIPA)).body);
    const daudi = await signedIn("venue_manager", "daudi@example.com", [cafe.id]);
    expect((await daudi.request("POST", "/api/payment-ways", CAFE)).status).toBe(403);
    // The list says where a way is used only among the venues the reader sees.
    const seen = ways((await daudi.request("GET", "/api/payment-ways")).body);
    expect(seen[0]?.venues.map((v) => v.name)).toEqual([cafe.name]);
    const choose = (id: string) =>
      daudi.request("PUT", `/api/venues/${id}/payment-way`, { wayId: way?.id });
    expect((await choose(cafe.id)).status).toBe(200);
    expect((await choose(lodge.id)).status).toBe(404);
  });

  test("a mobile money sale needs a way to pay and keeps the one read out", async () => {
    const cafe = await venue("Kijiwe Cafe");
    const owner = await signedIn("owner", "neema@example.com");
    await sellingVenue(t.db, cafe.id);
    // sellingVenue gave the business a default; take it away to see a sale refused.
    await t.db.business.updateMany({ data: { defaultPaymentWayId: null } });
    await t.db.paymentWay.deleteMany();
    const pkg = await t.db.package.create({
      data: {
        businessId: cafe.businessId,
        name: "Day",
        durationMinutes: 1440,
        downloadSpeedMbps: 5,
        priceTsh: "1000",
      },
    });
    const sell = (method: string) =>
      owner.request("POST", "/api/sales", {
        venueId: cafe.id,
        packageId: pkg.id,
        method,
        phone: "0754218640",
      });
    const refused = await sell("mobile_money");
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "NO_PAYMENT_WAY" });
    expect((await sell("cash")).status).toBe(201);

    await owner.request("POST", "/api/payment-ways", CAFE);
    expect((await sell("mobile_money")).status).toBe(201);
    const mobile = await t.db.payment.findFirstOrThrow({ where: { provider: "mobile_money" } });
    expect(mobile).toMatchObject({
      paidThrough: "Lipa namba",
      paidToNumber: CAFE.number,
      paidToName: CAFE.name,
    });
  });
});
