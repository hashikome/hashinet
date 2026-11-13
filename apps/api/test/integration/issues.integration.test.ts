import { describe, expect, test } from "bun:test";
import type { IssueDetail, IssueList } from "@hashinet/types";
import { IssuesService } from "../../src/issues/issues.service.js";
import { browser, type Client, enrollAuthenticatorFor, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, platformMember, testBusinessId } from "./people.js";

const t = useTestDatabase();
const api = useApi();

const SERVED = { ok: true, phases: [], blockers: [] };

async function signedIn(email: string): Promise<Client> {
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, email);
  return c;
}

async function venue(name = "Cafe") {
  return t.db.venue.create({
    data: { businessId: await testBusinessId(t.db), name, region: "Dar es Salaam", area: "Dar" },
  });
}

/** A router that was set up and served, now with the given status. */
async function servedRouter(venueId: string, status: "online" | "offline" | "error") {
  return t.db.router.create({
    data: {
      venueId,
      name: "Lobby",
      ipAddress: "192.168.88.2",
      status,
      lastSetup: SERVED,
      lastSetupAt: new Date(),
    },
  });
}

const sync = () => api.app.get(IssuesService).syncRouterIssues();

async function issues(c: Client, status = "open"): Promise<IssueList> {
  return (await c.request("GET", `/api/issues?status=${status}`)).body as IssueList;
}

describe("Issues", () => {
  test("a router that stops serving opens an issue in both workspaces; serving again resolves it", async () => {
    await platformMember(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
    await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
    const admin = await signedIn("admin@example.com");
    const owner = await signedIn("owner@example.com");
    const cafe = await venue();
    // Still being set up: no issue.
    const fresh = await t.db.router.create({
      data: { venueId: cafe.id, name: "New", ipAddress: "192.168.88.3", status: "offline" },
    });
    const router = await servedRouter(cafe.id, "offline");

    await sync();
    await sync(); // idempotent
    for (const c of [admin, owner]) {
      const listed = await issues(c);
      expect(listed.openCount).toBe(1);
      expect(listed.issues).toMatchObject([
        {
          kind: "router_offline",
          router: { id: router.id },
          venue: { id: cafe.id },
          holder: null,
          canClaim: true,
        },
      ]);
    }
    expect((await issues(admin)).issues[0]?.router?.id).not.toBe(fresh.id);

    await t.db.router.update({ where: { id: router.id }, data: { status: "online" } });
    await sync();
    for (const c of [admin, owner]) {
      expect((await issues(c)).openCount).toBe(0);
      const resolved = (await issues(c, "resolved")).issues;
      expect(resolved).toMatchObject([{ status: "resolved" }]);
      const detail = (await c.request("GET", `/api/issues/${resolved[0]?.id}`)).body as IssueDetail;
      expect(detail.events.map((e) => e.action)).toEqual(["opened", "resolved"]);
      expect(detail.handTo).toEqual([]);
      // Nothing more happens to a resolved issue.
      expect((await c.request("POST", `/api/issues/${resolved[0]?.id}/claim`)).status).toBe(409);
    }
  });

  test("claim, note, hand, release and take over, each on the log, by rank", async () => {
    const owner = await businessMember(t.db, {
      email: "owner@example.com",
      name: "Owner",
      role: "owner",
    });
    const cafe = await venue();
    const other = await venue("Bar");
    const manager = await businessMember(t.db, {
      email: "bm@example.com",
      name: "Business manager",
      role: "business_manager",
    });
    const atCafe = await businessMember(t.db, {
      email: "vm@example.com",
      name: "Cafe manager",
      role: "venue_manager",
      venueIds: [cafe.id],
    });
    const atBar = await businessMember(t.db, {
      email: "bar@example.com",
      name: "Bar manager",
      role: "venue_manager",
      venueIds: [other.id],
    });
    await servedRouter(cafe.id, "error");
    await sync();

    const o = await signedIn(owner.email);
    const m = await signedIn(manager.email);
    const v = await signedIn(atCafe.email);
    const b = await signedIn(atBar.email);
    expect((await issues(b)).openCount).toBe(0);
    const id = (await issues(v)).issues[0]?.id;
    expect((await b.request("GET", `/api/issues/${id}`)).status).toBe(404);

    // Acting first claims it.
    const noted = (
      await v.request("POST", `/api/issues/${id}/note`, { note: "Power cut at the cafe" })
    ).body as IssueDetail;
    expect(noted.issue).toMatchObject({
      mine: true,
      holder: { membershipId: atCafe.membershipId },
    });
    // The bar's manager can't be handed a cafe issue; the business manager can.
    expect(noted.handTo.map((p) => p.membershipId).sort()).toEqual(
      [owner.membershipId, manager.membershipId].sort(),
    );
    expect((await m.request("POST", `/api/issues/${id}/claim`)).status).toBe(403);
    expect((await m.request("POST", `/api/issues/${id}/note`, { note: "x" })).status).toBe(403);
    expect(
      (await v.request("POST", `/api/issues/${id}/hand`, { to: atBar.membershipId })).status,
    ).toBe(400);

    const handed = (
      await v.request("POST", `/api/issues/${id}/hand`, { to: manager.membershipId, note: "Yours" })
    ).body as IssueDetail;
    expect(handed.issue.holder?.membershipId).toBe(manager.membershipId);
    // A venue manager is below a business manager: no take-over.
    expect((await issues(v)).issues[0]).toMatchObject({ mine: false, canTakeOver: false });
    expect(
      (await v.request("POST", `/api/issues/${id}/take-over`, { reason: "Mine again" })).status,
    ).toBe(403);
    // The owner is above: a reason is required, then it's theirs.
    expect((await issues(o)).issues[0]?.canTakeOver).toBe(true);
    expect((await o.request("POST", `/api/issues/${id}/take-over`, { reason: " " })).status).toBe(
      400,
    );
    const taken = (
      await o.request("POST", `/api/issues/${id}/take-over`, { reason: "Calling the ISP" })
    ).body as IssueDetail;
    expect(taken.issue.holder?.membershipId).toBe(owner.membershipId);
    expect((await m.request("POST", `/api/issues/${id}/release`)).status).toBe(403);
    const released = (await o.request("POST", `/api/issues/${id}/release`)).body as IssueDetail;
    expect(released.issue).toMatchObject({ holder: null, canClaim: true });

    expect(
      released.events.map((e) => [e.action, e.actor?.name ?? null, e.to?.name ?? null, e.note]),
    ).toEqual([
      ["opened", null, null, null],
      ["claimed", "Cafe manager", null, null],
      ["noted", "Cafe manager", null, "Power cut at the cafe"],
      ["handed", "Cafe manager", "Business manager", "Yours"],
      ["taken_over", "Owner", null, "Calling the ISP"],
      ["released", "Owner", null, null],
    ]);
  });

  test("a held issue with no step for a day is stalled; the platform doesn't see a business's own issues", async () => {
    const owner = await businessMember(t.db, {
      email: "owner@example.com",
      name: "Owner",
      role: "owner",
    });
    await platformMember(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
    const cafe = await venue();
    const svc = api.app.get(IssuesService);
    const id = await svc.open({
      scope: "business",
      businessId: cafe.businessId,
      kind: "venue_setup",
      key: `venue-setup:${cafe.id}`,
      venueId: cafe.id,
    });
    expect(
      await svc.open({
        scope: "business",
        businessId: cafe.businessId,
        kind: "venue_setup",
        key: `venue-setup:${cafe.id}`,
      }),
    ).toBe(id);
    const o = await signedIn(owner.email);
    await o.request("POST", `/api/issues/${id}/claim`);
    expect((await issues(o)).issues[0]?.stalled).toBe(false);
    await t.db.issueEvent.updateMany({
      where: { issueId: id },
      data: { at: new Date(Date.now() - 25 * 3_600_000) },
    });
    expect((await issues(o)).issues[0]?.stalled).toBe(true);

    const admin = await signedIn("admin@example.com");
    expect((await issues(admin)).openCount).toBe(0);
    expect((await admin.request("GET", `/api/issues/${id}`)).status).toBe(404);
  });
  test("a venue's package is for the platform's admin and managers; its operators don't see it", async () => {
    await platformMember(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
    const op = await platformMember(t.db, {
      email: "op@example.com",
      name: "Op",
      role: "operator",
    });
    const cafe = await venue();
    const svc = api.app.get(IssuesService);
    const pkg = await svc.open({
      scope: "platform",
      businessId: null,
      kind: "venue_package",
      key: `venue-package:${cafe.id}`,
      venueId: cafe.id,
    });
    const setup = await svc.open({
      scope: "platform",
      businessId: null,
      kind: "venue_setup",
      key: `venue-setup:${cafe.id}`,
      venueId: cafe.id,
    });
    const admin = await signedIn("admin@example.com");
    const operator = await signedIn(op.email);
    expect((await issues(operator)).issues.map((i) => i.id)).toEqual([setup]);
    expect((await operator.request("POST", `/api/issues/${pkg}/claim`)).status).toBe(404);
    const detail = (await admin.request("GET", `/api/issues/${pkg}`)).body as IssueDetail;
    expect(detail.handTo).toEqual([]);
    expect(
      (await admin.request("POST", `/api/issues/${pkg}/hand`, { to: op.membershipId })).status,
    ).toBe(400);
    const setupDetail = (await admin.request("GET", `/api/issues/${setup}`)).body as IssueDetail;
    expect(setupDetail.handTo.map((p) => p.membershipId)).toEqual([op.membershipId]);
  });
});
