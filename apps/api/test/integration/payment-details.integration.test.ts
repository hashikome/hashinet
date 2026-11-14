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

async function venue(name: string) {
  return t.db.venue.create({
    data: { businessId: await testBusinessId(t.db), name, region: "Mwanza", area: "Kirumba" },
  });
}

const LIPA = { through: "Lipa namba", number: "5123 4567", name: "NEEMA HOSPITALITY" };
const BANK = { through: "CRDB Bank", number: "0150 3842 6610 0", name: "NEEMA HOSPITALITY LTD" };

describe("a venue's payment details", () => {
  test("the owner keeps them; whoever sells there reads them, in order, and changes none", async () => {
    const kijiwe = await venue("Kijiwe Cafe");
    const owner = await signedIn("owner", "neema@example.com");
    const path = `/api/venues/${kijiwe.id}/payment-details`;
    expect((await owner.request("GET", path)).body).toEqual({ ways: [] });

    const saved = await owner.request("PUT", path, { ways: [LIPA, BANK] });
    expect(saved).toEqual({ status: 200, body: { ways: [LIPA, BANK] } });

    const musa = await signedIn("venue_operator", "musa@example.com", [kijiwe.id]);
    expect((await musa.request("GET", path)).body).toEqual({ ways: [LIPA, BANK] });
    expect((await musa.request("PUT", path, { ways: [] })).status).toBe(403);

    const row = await t.db.auditLog.findFirstOrThrow({
      where: { action: "venue.payment_details.update" },
    });
    expect(row.venueId).toBe(kijiwe.id);
    expect(row.businessId).toBe(kijiwe.businessId);

    // Removing one is saving the list without it.
    expect((await owner.request("PUT", path, { ways: [BANK] })).body).toEqual({ ways: [BANK] });
  });

  test("three ways at most, each with what it is, its number in digits and its name", async () => {
    const kijiwe = await venue("Kijiwe Cafe");
    const owner = await signedIn("owner", "neema@example.com");
    const put = (ways: unknown[]) =>
      owner.request("PUT", `/api/venues/${kijiwe.id}/payment-details`, { ways });
    expect((await put([LIPA, LIPA, LIPA, LIPA])).status).toBe(400);
    expect((await put([{ ...LIPA, through: "" }])).status).toBe(400);
    expect((await put([{ ...LIPA, name: " " }])).status).toBe(400);
    expect((await put([{ ...LIPA, number: "51-23" }])).status).toBe(400);
    expect((await put([LIPA, LIPA, LIPA])).status).toBe(200);
  });

  test("a venue manager keeps their own venues' only", async () => {
    const kijiwe = await venue("Kijiwe Cafe");
    const lodge = await venue("Mama Neema Lodge");
    const daudi = await signedIn("venue_manager", "daudi@example.com", [kijiwe.id]);
    const put = (id: string) =>
      daudi.request("PUT", `/api/venues/${id}/payment-details`, { ways: [LIPA] });
    expect((await put(kijiwe.id)).status).toBe(200);
    expect((await put(lodge.id)).status).toBe(404);
  });
});
