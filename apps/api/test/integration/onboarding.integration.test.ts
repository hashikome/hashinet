import { describe, expect, test } from "bun:test";
import type { IssueDetail, IssueList, VenueOnboarding } from "@hashinet/types";
import { businessDayOf } from "../../src/analytics/business-day.js";
import { OnboardingService } from "../../src/onboarding/onboarding.service.js";
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

async function onboarding(c: Client, venueId: string): Promise<VenueOnboarding> {
  return (await c.request("GET", `/api/venues/${venueId}/onboarding`)).body as VenueOnboarding;
}

async function team() {
  await platformMember(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
  const manager = await platformMember(t.db, {
    email: "asha@example.com",
    name: "Asha",
    role: "manager",
  });
  const operator = await platformMember(t.db, {
    email: "hamisi@example.com",
    name: "Hamisi",
    role: "operator",
  });
  const owner = await businessMember(t.db, {
    email: "baraka@example.com",
    name: "Baraka",
    role: "owner",
  });
  return {
    admin: await signedIn("admin@example.com"),
    asha: await signedIn(manager.email),
    hamisi: await signedIn(operator.email),
    baraka: await signedIn(owner.email),
    manager,
    operator,
  };
}

async function newVenue(admin: Client): Promise<string> {
  const created = await admin.request("POST", "/api/venues", {
    businessId: await testBusinessId(t.db),
    name: "Baraka's Cafe",
    region: "Dar es Salaam",
    area: "Mjimwema",
  });
  expect(created.status).toBe(201);
  return (created.body as { venue: { id: string } }).venue.id;
}

describe("Onboarding a venue", () => {
  test("from the owner's choice through the package, its payment and the setup, to the first guest", async () => {
    const { admin, asha, hamisi, baraka, manager, operator } = await team();
    const venueId = await newVenue(admin);
    const base = `/api/venues/${venueId}/onboarding`;

    // A new venue starts at its package: an issue for the admin and managers, not for operators.
    expect(await onboarding(baraka, venueId)).toMatchObject({
      stage: "choose",
      preference: null,
      issueId: null,
      ownerProtected: true,
      changeable: true,
    });
    const packageIssue = (await onboarding(admin, venueId)).issueId;
    expect(packageIssue).not.toBeNull();
    // Whom the team calls: the business's owner.
    expect(
      ((await admin.request("GET", `/api/issues/${packageIssue}`)).body as IssueDetail).contact,
    ).toEqual({ name: "Baraka", email: "baraka@example.com", phone: null });
    expect((await onboarding(hamisi, venueId)).issueId).toBeNull();

    // The owner prefers Install; the team never sets a preference.
    expect((await admin.request("PUT", `${base}/preference`, { plan: "install" })).status).toBe(
      403,
    );
    const chose = (await baraka.request("PUT", `${base}/preference`, { plan: "install" }))
      .body as VenueOnboarding;
    expect(chose).toMatchObject({ stage: "confirm", preference: { plan: "install" } });

    // Asha confirms what was agreed on the call, line by line, and so holds the issue.
    const FEE = {
      kind: "onboarding_fee",
      description: "Two technicians, one day",
      amountTsh: 80_000,
    };
    const MIKROTIK = { kind: "mikrotik_router", description: "hAP ax2", amountTsh: 190_000 };
    for (const refused of [
      { plan: "install", lines: [FEE] }, // Install brings a router
      { plan: "connect", lines: [FEE, MIKROTIK] }, // Connect uses the venue's own
      { plan: "install", lines: [MIKROTIK] }, // one onboarding fee
      { plan: "install", lines: [FEE, FEE, MIKROTIK] },
      { plan: "install", lines: [FEE, { ...MIKROTIK, description: null }] }, // the router's model
      { plan: "install", lines: [FEE, MIKROTIK, { kind: "other", amountTsh: 5_000 }] },
    ]) {
      expect((await asha.request("POST", `${base}/confirm`, refused)).status).toBe(400);
    }
    expect((await hamisi.request("POST", `${base}/confirm`, {})).status).toBe(403);
    const agreed = (
      await asha.request("POST", `${base}/confirm`, {
        plan: "install",
        lines: [MIKROTIK, FEE],
        note: "Two floors, about 40 guests at peak",
      })
    ).body as VenueOnboarding;
    expect(agreed).toMatchObject({
      stage: "pay",
      agreed: { plan: "install", lines: [FEE, MIKROTIK], totalTsh: 270_000 },
    });
    expect(agreed.agreed?.dueOn).toBe(businessDayOf(new Date(Date.now() + 7 * 86_400_000)));
    // Someone else's issue: the admin takes it over to change it.
    expect(
      (await admin.request("POST", `${base}/confirm`, { plan: "connect", lines: [FEE] })).status,
    ).toBe(403);
    // The owner's preference no longer changes.
    expect((await baraka.request("PUT", `${base}/preference`, { plan: null })).status).toBe(409);
    // Nor is the setup scheduled before it is paid.
    expect(
      (await asha.request("POST", `${base}/schedule`, { date: businessDayOf(new Date()) })).status,
    ).toBe(409);

    // The admin records the payment, whoever holds the issue; paid in full.
    expect(
      (await admin.request("POST", `${base}/payment`, { amountTsh: 100_000, by: "cash" })).status,
    ).toBe(400);
    const paid = (
      await admin.request("POST", `${base}/payment`, { amountTsh: 270_000, by: "mobile_money" })
    ).body as VenueOnboarding;
    expect(paid).toMatchObject({
      stage: "schedule",
      paid: { amountTsh: 270_000, by: "mobile_money" },
      changeable: false,
    });
    expect(
      (await asha.request("POST", `${base}/confirm`, { plan: "connect", lines: [FEE] })).status,
    ).toBe(409);

    // Scheduled: the package is done and the setup goes to Hamisi.
    expect((await asha.request("POST", `${base}/schedule`, { date: "2020-01-01" })).status).toBe(
      400,
    );
    const scheduled = (
      await asha.request("POST", `${base}/schedule`, {
        date: businessDayOf(new Date()),
        goesId: operator.membershipId,
      })
    ).body as VenueOnboarding;
    expect(scheduled.stage).toBe("add-router");
    const pkg = (await admin.request("GET", `/api/issues/${packageIssue}`)).body as IssueDetail;
    expect(pkg.issue.status).toBe("resolved");
    expect(pkg.events.map((e) => [e.action, e.actor?.name ?? null, e.data])).toEqual([
      ["opened", null, null],
      ["step", "Baraka", { step: "preferred", plan: "install" }],
      ["claimed", "Asha", null],
      ["step", "Asha", { step: "confirmed", plan: "install", totalTsh: 270_000 }],
      ["step", "Admin", { step: "paid", amountTsh: 270_000, by: "mobile_money" }],
      ["step", "Asha", { step: "scheduled", date: businessDayOf(new Date()) }],
      ["resolved", null, { reason: "scheduled" }],
    ]);
    // Handed to Hamisi, it is his to see: his pass to install.
    const setup = (await hamisi.request("GET", "/api/issues")).body as IssueList;
    expect(setup.issues).toMatchObject([
      { kind: "venue_setup", mine: true, holder: { membershipId: operator.membershipId } },
    ]);
    expect((await onboarding(hamisi, venueId)).issueId).toBe(setup.issues[0]?.id ?? "");
    expect(manager.membershipId).not.toBe(operator.membershipId);

    // Hamisi adds the router at the venue handed to him, and nowhere else.
    const otherVenue = await newVenue(admin);
    await t.db.venueOnboarding.update({
      where: { venueId: otherVenue },
      data: { setupDate: new Date() },
    });
    const ROUTER = { name: "Baraka's Cafe", ipAddress: "192.168.88.3", apiUsername: "hashinet" };
    expect(
      (await hamisi.request("POST", "/api/routers", { ...ROUTER, venueId: otherVenue })).status,
    ).toBe(403);
    const added = await hamisi.request("POST", "/api/routers", { ...ROUTER, venueId });
    expect(added.status).toBe(201);
    const addedId = (added.body as { router: { id: string } }).router.id;
    // Editing and removing a router stay with the admin and managers.
    expect((await hamisi.request("DELETE", `/api/routers/${addedId}`)).status).toBe(403);
    await t.db.router.delete({ where: { id: addedId } });

    // The router reaches HashiNet and serves; the first guest closes the setup.
    const router = await t.db.router.create({
      data: {
        venueId,
        name: "Baraka's Cafe",
        ipAddress: "192.168.88.2",
        status: "online",
        lastSeenAt: new Date(),
        lastSetup: { ok: true, phases: [], blockers: [] },
        lastSetupAt: new Date(),
      },
    });
    expect((await onboarding(baraka, venueId)).stage).toBe("first-guest");
    const svc = api.app.get(OnboardingService);
    await svc.syncSetups();
    expect((await onboarding(baraka, venueId)).stage).toBe("first-guest");
    await t.db.wifiSession.create({
      data: { venueId, routerId: router.id, macAddress: "02:00:00:00:00:01" },
    });
    await svc.syncSetups();
    expect(await onboarding(baraka, venueId)).toMatchObject({ stage: "done", issueId: null });
    const closed = (await hamisi.request("GET", "/api/issues?status=resolved")).body as IssueList;
    expect(closed.issues.map((i) => i.kind)).toEqual(["venue_setup"]);
  });

  test("a package with nothing to charge goes straight to its setup day", async () => {
    const { admin, asha } = await team();
    const venueId = await newVenue(admin);
    const agreed = (
      await asha.request("POST", `/api/venues/${venueId}/onboarding/confirm`, {
        plan: "connect",
        lines: [{ kind: "onboarding_fee", description: "In town", amountTsh: 0 }],
      })
    ).body as VenueOnboarding;
    expect(agreed).toMatchObject({ stage: "schedule", agreed: { dueOn: null } });
    expect(
      (
        await admin.request("POST", `/api/venues/${venueId}/onboarding/payment`, {
          amountTsh: 1,
          by: "cash",
        })
      ).status,
    ).toBe(409);
  });
});
