import { describe, expect, test } from "bun:test";
import type { IssueList, VenueSites } from "@hashinet/types";
import { openHosts } from "../../src/sites/open-sites.js";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, platformMember, testBusinessId } from "./people.js";

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
    data: { businessId: await testBusinessId(t.db), name, region: "Mwanza", area: "Isamilo" },
  });
}

const sites = (body: unknown) => (body as VenueSites).sites;

describe("a venue's sites open before paying", () => {
  test("the first is included; the next is invoiced and waits; paying opens it", async () => {
    const lodge = await venue("Mama Neema Lodge");
    const owner = await signedIn("owner", "neema@example.com");
    const path = `/api/venues/${lodge.id}/sites`;
    expect((await owner.request("GET", path)).body).toEqual({ sites: [], nextCostTsh: 0 });

    const first = await owner.request("POST", path, {
      host: "https://MamaNeemaLodge.co.tz/rooms?x=1",
      note: "Our booking page",
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      sites: [{ host: "mamaneemalodge.co.tz", state: "open", cost: "included", invoice: null }],
      nextCostTsh: 10_000,
    });

    const second = sites((await owner.request("POST", path, { host: "neemaspa.co.tz" })).body);
    expect(second[1]).toMatchObject({
      host: "neemaspa.co.tz",
      state: "waiting",
      cost: "due",
      slotTsh: 10_000,
    });
    const invoiceId = second[1]?.invoice?.id ?? "";
    const invoice = await t.db.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { lines: true },
    });
    expect(invoice).toMatchObject({ kind: "site_slot", venueId: lodge.id, totalTsh: 10_000 });
    expect(invoice.lines.map((l) => l.label)).toEqual(["neemaspa.co.tz"]);
    // Only open sites reach the routers, and the owner has the bill as an issue.
    expect(await openHosts(t.db, lodge.id)).toEqual(["mamaneemalodge.co.tz"]);
    const issues = ((await owner.request("GET", "/api/issues?status=open")).body as IssueList)
      .issues;
    expect(issues.map((i) => i.kind)).toContain("bill_due");
    expect(api.email.sent.map((m) => m.subject)).toContain(
      `Invoice ${invoice.number}: Mama Neema Lodge's extra site`,
    );

    await platformMember(t.db, { email: "asha@example.com", name: "Asha", role: "manager" });
    const asha = browser(api);
    await enrollAuthenticatorFor(api, asha, "asha@example.com");
    const paid = await asha.request("POST", "/api/billing/payments", {
      businessId: lodge.businessId,
      invoiceId,
      amountTsh: 10_000,
      receivedOn: invoice.issuedAt.toISOString().slice(0, 10),
      method: "mobile_money",
      reference: "TXN 1",
    });
    expect(paid.status).toBe(204);
    expect(sites((await owner.request("GET", path)).body)[1]).toMatchObject({
      state: "open",
      cost: "paid",
      invoice: null,
    });
    expect(await openHosts(t.db, lodge.id)).toEqual(["mamaneemalodge.co.tz", "neemaspa.co.tz"]);

    // A paid slot stays with the venue: removing its site frees it for the next, at no cost.
    const removed = await owner.request("DELETE", `${path}/${second[1]?.id}`);
    expect(removed.body).toMatchObject({ nextCostTsh: 0 });
    const again = sites((await owner.request("POST", path, { host: "neemabar.co.tz" })).body);
    expect(again[1]).toMatchObject({ host: "neemabar.co.tz", state: "open", cost: "paid" });
    expect(await t.db.invoice.count({ where: { kind: "site_slot" } })).toBe(1);
  });

  test("removing a waiting site cancels its unpaid invoice", async () => {
    const lodge = await venue("Mama Neema Lodge");
    const owner = await signedIn("owner", "neema@example.com");
    const path = `/api/venues/${lodge.id}/sites`;
    await owner.request("POST", path, { host: "one.co.tz" });
    const two = sites((await owner.request("POST", path, { host: "two.co.tz" })).body)[1];
    expect(await t.db.invoice.count({ where: { kind: "site_slot" } })).toBe(1);
    await owner.request("DELETE", `${path}/${two?.id}`);
    expect(await t.db.invoice.count({ where: { kind: "site_slot" } })).toBe(0);
    expect(await t.db.siteSlot.count()).toBe(0);
  });

  test("an address is reduced to its host; others are refused; a site is listed once", async () => {
    const lodge = await venue("Mama Neema Lodge");
    const owner = await signedIn("owner", "neema@example.com");
    const path = `/api/venues/${lodge.id}/sites`;
    for (const host of ["*.hotel.co.tz", "10.0.0.1", "hotel", "a b.com"]) {
      expect((await owner.request("POST", path, { host })).status).toBe(400);
    }
    await owner.request("POST", path, { host: "hotel.co.tz" });
    expect((await owner.request("POST", path, { host: "HOTEL.co.tz" })).status).toBe(409);
  });

  test("its managers keep the list; an operator reads it; another venue's manager can't", async () => {
    const lodge = await venue("Mama Neema Lodge");
    const cafe = await venue("Kijiwe Cafe");
    const daudi = await signedIn("venue_manager", "daudi@example.com", [lodge.id]);
    const musa = await signedIn("venue_operator", "musa@example.com", [lodge.id]);
    const path = (id: string) => `/api/venues/${id}/sites`;
    expect((await daudi.request("POST", path(lodge.id), { host: "lodge.co.tz" })).status).toBe(201);
    expect((await daudi.request("POST", path(cafe.id), { host: "cafe.co.tz" })).status).toBe(404);
    expect((await musa.request("GET", path(lodge.id))).status).toBe(200);
    expect((await musa.request("POST", path(lodge.id), { host: "x.co.tz" })).status).toBe(403);
  });
});
