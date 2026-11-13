import { describe, expect, test } from "bun:test";
import type { BusinessDetail, BusinessList, IssueList } from "@hashinet/types";
import { beginOnboarding } from "../../src/onboarding/begin.js";
import { browser, type Client, enrollAuthenticatorFor, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, platformMember, testBusinessId } from "./people.js";

const t = useTestDatabase();
const api = useApi();

async function signedIn(email: string): Promise<Client> {
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, email);
  return c;
}

/** A venue as the app makes one: with its onboarding begun. */
async function venue(businessId: string, name: string) {
  const v = await t.db.venue.create({
    data: { businessId, name, region: "Dar es Salaam", area: "Dar" },
  });
  await beginOnboarding(t.db, v.id);
  return v;
}

describe("a business's guests, for HashiNet's team", () => {
  test("are counts per venue, never a device, code or session", async () => {
    await platformMember(t.db, { email: "hamisi@example.com", name: "Hamisi", role: "operator" });
    await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
    const businessId = await testBusinessId(t.db);
    const cafe = await venue(businessId, "Cafe");
    const bar = await venue(businessId, "Bar");
    const up = await t.db.router.create({
      data: { venueId: cafe.id, name: "Cafe", ipAddress: "192.168.88.2", status: "online" },
    });
    const down = await t.db.router.create({
      data: { venueId: bar.id, name: "Bar", ipAddress: "192.168.88.3", status: "offline" },
    });
    const session = (venueId: string, routerId: string, mac: string, status = "connected") =>
      t.db.wifiSession.create({
        data: { venueId, routerId, macAddress: mac, status: status as "connected" },
      });
    await session(cafe.id, up.id, "02:00:00:00:00:01");
    await session(cafe.id, up.id, "02:00:00:00:00:02");
    await session(cafe.id, up.id, "02:00:00:00:00:03", "expired");
    await session(bar.id, down.id, "02:00:00:00:00:04");

    const hamisi = await signedIn("hamisi@example.com");
    const reply = await hamisi.request("GET", "/api/businesses");
    expect(reply.status).toBe(200);
    expect(
      (reply.body as BusinessList).businesses[0]?.venues.map((v) => [
        v.name,
        v.onlineNow,
        v.midSession,
      ]),
    ).toEqual([
      ["Cafe", 2, 0],
      ["Bar", 0, 1],
    ]);
    const page = (await hamisi.request("GET", `/api/businesses/${businessId}`))
      .body as BusinessDetail;
    expect(page.venues.map((v) => [v.name, v.onlineNow, v.midSession])).toEqual([
      ["Cafe", 2, 0],
      ["Bar", 0, 1],
    ]);
    expect(JSON.stringify(reply.body)).not.toContain("02:00:00");

    // The lists are the business's own.
    for (const path of ["/api/sessions", "/api/devices", "/api/vouchers"]) {
      expect((await hamisi.request("GET", path)).status).toBe(403);
    }
    const owner = await signedIn("owner@example.com");
    expect((await owner.request("GET", "/api/businesses")).status).toBe(403);
  });
  test("a business's page names its owners and managers, never its operators", async () => {
    await platformMember(t.db, { email: "asha@example.com", name: "Asha", role: "manager" });
    const businessId = await testBusinessId(t.db);
    const cafe = await venue(businessId, "Cafe");
    await t.db.venueOnboarding.update({
      where: { venueId: cafe.id },
      data: { preferredAt: new Date() },
    });
    await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
    await businessMember(t.db, {
      email: "vm@example.com",
      name: "Cafe manager",
      role: "venue_manager",
      venueIds: [cafe.id],
    });
    await businessMember(t.db, {
      email: "op@example.com",
      name: "Counter",
      role: "venue_operator",
      venueIds: [cafe.id],
    });
    const asha = await signedIn("asha@example.com");
    const page = (await asha.request("GET", `/api/businesses/${businessId}`))
      .body as BusinessDetail;
    expect(page.owner).toEqual({ name: "Owner", email: "owner@example.com", phone: null });
    expect(page.people.map((p) => [p.name, p.role, p.venues])).toEqual([
      ["Owner", "owner", []],
      ["Cafe manager", "venue_manager", ["Cafe"]],
    ]);
    expect(page.venues).toMatchObject([
      { id: cafe.id, routers: 0, condition: "setting-up", stage: "confirm" },
    ]);
    expect(JSON.stringify(page)).not.toContain("op@example.com");
    // Its issues, asked for by business.
    const other = await t.db.venue.create({
      data: {
        businessId: await testBusinessId(t.db, "Other"),
        name: "Elsewhere",
        region: "Dar es Salaam",
        area: "Dar",
      },
    });
    await beginOnboarding(t.db, other.id);
    const theirs = (await asha.request("GET", `/api/issues?businessId=${businessId}`))
      .body as IssueList;
    expect(theirs.issues.map((i) => i.venue?.name)).toEqual(["Cafe"]);
    expect(
      (await asha.request("GET", "/api/businesses/01a1d4dc-0abd-72b4-899c-c0ea84303684")).status,
    ).toBe(404);
  });
});
