import type { AuditList } from "@hashinet/types";
import { describe, expect, test } from "bun:test";
import { browser, enrollAuthenticatorFor, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, testBusinessId } from "./people.js";

const t = useTestDatabase();
const api = useApi();

describe("the audit log", () => {
  test("filters by venue, business day and who acted, and names what it can", async () => {
    const businessId = await testBusinessId(t.db);
    const [kijiwe, pwani] = await Promise.all(
      ["Kijiwe Cafe", "Pwani Lounge"].map((name) =>
        t.db.venue.create({ data: { businessId, name, region: "Mwanza", area: "Kirumba" } }),
      ),
    );
    if (!kijiwe || !pwani) throw new Error("venues not created");
    const neema = await businessMember(t.db, {
      email: "neema@example.com",
      name: "Neema Mushi",
      role: "owner",
    });
    const daudi = await businessMember(t.db, {
      email: "daudi@example.com",
      name: "Daudi Kweka",
      role: "venue_manager",
      venueIds: [kijiwe.id],
    });
    const row = (venueId: string, actor: string, at: string) =>
      t.db.auditLog.create({
        data: {
          actorMembershipId: actor,
          businessId,
          venueId,
          action: "venue.update",
          category: "change",
          targetType: "venue",
          targetId: venueId,
          outcome: "success",
          createdAt: new Date(at),
        },
      });
    // 20:59 UTC on the 17th is still the 17th in Dar es Salaam; 21:00 is the 18th.
    await row(kijiwe.id, neema.membershipId, "2026-11-17T20:59:00Z");
    await row(kijiwe.id, daudi.membershipId, "2026-11-17T21:00:00Z");
    await row(pwani.id, neema.membershipId, "2026-11-18T10:00:00Z");

    const owner = browser(api);
    await enrollAuthenticatorFor(api, owner, "neema@example.com");
    const list = async (q: string) =>
      ((await owner.request("GET", `/api/audit?${q}`)).body as AuditList).entries;

    const all = await list("action=venue.update");
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({
      target: { type: "venue", label: "Pwani Lounge" },
      venue: { id: pwani.id, name: "Pwani Lounge" },
      business: { id: businessId },
      actor: { name: "Neema Mushi", role: "owner" },
    });
    expect(await list(`venueId=${pwani.id}`)).toHaveLength(1);
    expect((await list("from=2026-11-18&to=2026-11-18")).map((e) => e.actor?.name)).toEqual([
      "Neema Mushi",
      "Daudi Kweka",
    ]);
    expect(await list("to=2026-11-17")).toHaveLength(1);
    expect((await list("search=daudi")).map((e) => e.actor?.name)).toEqual(["Daudi Kweka"]);

    // A venue manager's log stays their venues', whatever venue they ask for.
    const manager = browser(api);
    await enrollAuthenticatorFor(api, manager, "daudi@example.com");
    const theirs = (await manager.request("GET", `/api/audit?venueId=${pwani.id}`))
      .body as AuditList;
    expect(theirs.entries).toEqual([]);
  });
});
