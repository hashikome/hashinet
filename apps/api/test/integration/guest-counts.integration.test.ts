import { describe, expect, test } from "bun:test";
import type { GuestCounts } from "@hashinet/types";
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

describe("a business's guests, for HashiNet's team", () => {
  test("are counts per venue, never a device, code or session", async () => {
    await platformMember(t.db, { email: "hamisi@example.com", name: "Hamisi", role: "operator" });
    await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
    const businessId = await testBusinessId(t.db);
    const cafe = await t.db.venue.create({
      data: { businessId, name: "Cafe", region: "Dar es Salaam", area: "Dar" },
    });
    const bar = await t.db.venue.create({
      data: { businessId, name: "Bar", region: "Dar es Salaam", area: "Dar" },
    });
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
    const reply = await hamisi.request("GET", "/api/guest-counts");
    expect(reply.status).toBe(200);
    expect((reply.body as GuestCounts).venues).toEqual([
      {
        venue: { id: bar.id, name: "Bar" },
        business: { id: businessId, name: "Test Business" },
        onlineNow: 0,
        midSession: 1,
      },
      {
        venue: { id: cafe.id, name: "Cafe" },
        business: { id: businessId, name: "Test Business" },
        onlineNow: 2,
        midSession: 0,
      },
    ]);
    expect(JSON.stringify(reply.body)).not.toContain("02:00:00");

    // The lists are the business's own.
    for (const path of ["/api/sessions", "/api/devices", "/api/vouchers"]) {
      expect((await hamisi.request("GET", path)).status).toBe(403);
    }
    const owner = await signedIn("owner@example.com");
    expect((await owner.request("GET", "/api/guest-counts")).status).toBe(403);
  });
});
