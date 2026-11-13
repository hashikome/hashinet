import { describe, expect, test } from "bun:test";
import { DEFAULT_PACKAGES } from "../../src/platform/bootstrap.js";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, platformMember } from "./people.js";

const t = useTestDatabase();
const api = useApi();

async function staff(role: "admin" | "manager" | "operator" = "admin"): Promise<Client> {
  const email = `${role}@example.com`;
  await platformMember(t.db, { email, name: role, role });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, email);
  return c;
}

/** The token from the newest invitation sent to `to`, waiting briefly: it is sent in the background. */
async function tokenFor(to: string, after = 0): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const found = api.email.sent
      .slice(after)
      .reverse()
      .find((m) => m.to === to && /#token=/.test(m.text));
    const token = found?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
    if (token) return token;
    await Bun.sleep(20);
  }
  throw new Error(`no invitation reached ${to}`);
}

const ACCEPT = {
  person: { name: "Baraka Mollel", phone: "0754 300 118" },
  business: { name: "Bahari Beach Bar", region: "Dar es Salaam", area: "Mjimwema, Kigamboni" },
  venue: { name: "Bahari Beach Bar", region: "Dar es Salaam", area: "Mjimwema, Kigamboni" },
};

async function defaults(): Promise<void> {
  await t.db.platformDefaultPackage.createMany({
    data: DEFAULT_PACKAGES.map((p, position) => ({ ...p, position })),
  });
}

describe("inviting a business", () => {
  test("HashiNet's admin invites by email; nothing is created but the invitation", async () => {
    const c = await staff();
    const before = api.email.sent.length;
    const issued = await c.request("POST", "/api/invitations/businesses", {
      email: " Baraka@Example.com ",
    });
    expect(issued.status).toBe(201);
    expect(issued.body).toMatchObject({
      invitation: {
        email: "baraka@example.com",
        scope: "business",
        role: "owner",
        invitedBy: "admin",
      },
    });
    const token = await tokenFor("baraka@example.com", before);
    const row = await t.db.invitation.findFirstOrThrow();
    expect(row.tokenDigest).not.toBe(token);
    expect(await t.db.business.count()).toBe(0);
    expect(await t.db.user.count({ where: { email: "baraka@example.com" } })).toBe(0);
    expect((await t.db.auditLog.findMany()).map((a) => a.action)).toContain("invitation.issue");
    const list = await c.request("GET", "/api/invitations/businesses");
    expect((list.body as { invitations: unknown[] }).invitations).toHaveLength(1);
  });

  test("a business's people and HashiNet's operators cannot invite a business", async () => {
    await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
    const owner = browser(api);
    await enrollAuthenticatorFor(api, owner, "owner@example.com");
    const body = { email: "x@example.com" };
    expect((await owner.request("POST", "/api/invitations/businesses", body)).status).toBe(403);
    expect((await owner.request("GET", "/api/businesses")).status).toBe(403);
    const operator = await staff("operator");
    expect((await operator.request("GET", "/api/invitations/businesses")).status).toBe(200);
    expect((await operator.request("GET", "/api/businesses")).status).toBe(200);
    expect((await operator.request("POST", "/api/invitations/businesses", body)).status).toBe(403);
  });
});

describe("accepting an invitation to start a business", () => {
  test("creates the person, business, venue, packages and owner, then the owner signs in", async () => {
    await defaults();
    const c = await staff();
    const before = api.email.sent.length;
    await c.request("POST", "/api/invitations/businesses", { email: "baraka@example.com" });
    const token = await tokenFor("baraka@example.com", before);
    const guest = browser(api);

    const preview = await guest.request("POST", "/api/invitations/accept/preview", { token });
    expect(preview.body).toMatchObject({ email: "baraka@example.com", kind: "business_owner" });

    const accepted = await guest.request("POST", "/api/invitations/accept/business", {
      token,
      ...ACCEPT,
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body).toMatchObject({ email: "baraka@example.com" });
    // Accepting signs nobody in.
    expect((await guest.request("GET", "/api/me")).status).toBe(401);

    const user = await t.db.user.findUniqueOrThrow({ where: { email: "baraka@example.com" } });
    expect(user).toMatchObject({ name: "Baraka Mollel", phone: "+255754300118" });
    const business = await t.db.business.findFirstOrThrow({ include: { venues: true } });
    expect(business).toMatchObject({ name: "Bahari Beach Bar", region: "Dar es Salaam" });
    expect(business.venues).toHaveLength(1);
    // Its venue starts at its package, an issue for HashiNet's team (ADR-0013, 2).
    const venueId = business.venues[0]?.id ?? "";
    expect(await t.db.venueOnboarding.findUnique({ where: { venueId } })).toMatchObject({
      preferredAt: null,
      confirmedAt: null,
    });
    expect(
      await t.db.issue.findFirst({ where: { key: `venue-package:${venueId}`, status: "open" } }),
    ).toMatchObject({ scope: "platform", kind: "venue_package", venueId });
    const packages = await t.db.package.findMany({
      where: { businessId: business.id },
      include: { venues: true },
    });
    expect(packages.map((p) => p.name).sort()).toEqual(["1 day", "1 hour", "1 week"]);
    expect(packages.every((p) => p.venues.length === 1)).toBe(true);
    expect(await t.db.membership.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({
      scope: "business",
      role: "owner",
      businessId: business.id,
    });
    const actions = (await t.db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["invitation.accept", "business.create"]));

    // HashiNet's team sees it, with its owner and venue.
    expect((await c.request("GET", "/api/businesses")).body).toMatchObject({
      businesses: [
        {
          name: "Bahari Beach Bar",
          owner: { name: "Baraka Mollel", email: "baraka@example.com" },
          venues: [{ name: "Bahari Beach Bar", routers: 0 }],
          condition: "setting-up",
        },
      ],
    });

    // The same link works once.
    const again = await guest.request("POST", "/api/invitations/accept/business", {
      token,
      ...ACCEPT,
    });
    expect(again.status).toBe(404);
    expect(await t.db.business.count()).toBe(1);

    // Then the owner signs in with a code, into their own business, getting set up.
    const owner = browser(api);
    expect((await signInWithCode(api, owner, "baraka@example.com")).status).toBe(200);
    expect((await owner.request("GET", "/api/me")).body).toMatchObject({
      active: { role: "owner", business: { name: "Bahari Beach Bar" }, access: "setup" },
      protection: { required: true, passkeys: 0, setupEndsAt: expect.any(String) },
    });
    // Getting set up, nothing sellable is offered yet.
    const capabilities = (
      (await owner.request("GET", "/api/me")).body as {
        active: { capabilities: string[] };
      }
    ).active.capabilities;
    expect(capabilities).toContain("package.manage");
    expect(capabilities).not.toContain("voucher.print");
  });

  test("a replaced, revoked, expired or unknown link is not found", async () => {
    const c = await staff();
    let before = api.email.sent.length;
    await c.request("POST", "/api/invitations/businesses", { email: "a@example.com" });
    const first = await tokenFor("a@example.com", before);
    before = api.email.sent.length;
    const second = (
      (await c.request("POST", "/api/invitations/businesses", { email: "a@example.com" })).body as {
        invitation: { id: string };
      }
    ).invitation;
    const replacement = await tokenFor("a@example.com", before);
    const guest = browser(api);
    const preview = (token: string) =>
      guest.request("POST", "/api/invitations/accept/preview", { token });
    expect((await preview(first)).status).toBe(404);
    expect((await preview(replacement)).status).toBe(200);

    before = api.email.sent.length;
    expect((await c.request("POST", `/api/invitations/${second.id}/resend`)).status).toBe(200);
    const resent = await tokenFor("a@example.com", before);
    expect((await preview(replacement)).status).toBe(404);
    expect((await preview(resent)).status).toBe(200);

    expect((await c.request("DELETE", `/api/invitations/${second.id}`)).status).toBe(204);
    expect((await preview(resent)).status).toBe(404);

    before = api.email.sent.length;
    await c.request("POST", "/api/invitations/businesses", { email: "late@example.com" });
    const late = await tokenFor("late@example.com", before);
    await t.db.invitation.updateMany({
      where: { email: "late@example.com" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await preview(late)).status).toBe(404);
    expect((await preview("x".repeat(43))).status).toBe(404);
  });

  test("the owner's mobile number and the places are checked", async () => {
    const c = await staff();
    const before = api.email.sent.length;
    await c.request("POST", "/api/invitations/businesses", { email: "b@example.com" });
    const token = await tokenFor("b@example.com", before);
    const refused = await browser(api).request("POST", "/api/invitations/accept/business", {
      token,
      ...ACCEPT,
      person: { name: "B", phone: "12345" },
      venue: { ...ACCEPT.venue, region: "Narnia" },
    });
    expect(refused.status).toBe(400);
    expect(Object.keys((refused.body as { details: Record<string, string> }).details)).toEqual(
      expect.arrayContaining(["person.phone", "venue.region"]),
    );
    expect(await t.db.business.count()).toBe(0);
  });

  test("someone already on HashiNet keeps one identity and gains a workspace", async () => {
    const c = await staff();
    const before = api.email.sent.length;
    await c.request("POST", "/api/invitations/businesses", { email: "admin@example.com" });
    const token = await tokenFor("admin@example.com", before);
    const accepted = await browser(api).request("POST", "/api/invitations/accept/business", {
      token,
      ...ACCEPT,
      business: { ...ACCEPT.business, name: "Paul's home" },
    });
    expect(accepted.status).toBe(201);
    expect(await t.db.user.count({ where: { email: "admin@example.com" } })).toBe(1);
    const memberships = await t.db.membership.findMany({
      where: { user: { email: "admin@example.com" } },
    });
    expect(memberships.map((m) => m.role).sort()).toEqual(["admin", "owner"]);
  });
});
