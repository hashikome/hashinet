import { describe, expect, test } from "bun:test";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, platformMember, testBusinessId } from "./people.js";

const t = useTestDatabase();
const api = useApi();

async function staff(role: "admin" | "manager" | "operator", email = `${role}@example.com`) {
  const member = await platformMember(t.db, { email, name: role, role });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, email);
  return { c, membershipId: member.membershipId };
}

async function tokenFor(to: string, after: number): Promise<string> {
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

type Team = {
  members: { membershipId: string; email: string; role: string; manageable: boolean }[];
  invitations: { id: string; email: string; role: string }[];
  assignable: string[];
};

async function team(c: Client): Promise<Team> {
  return (await c.request("GET", "/api/team")).body as Team;
}

describe("HashiNet's team", () => {
  test("the admin invites a manager, who accepts with a name and signs in to the platform", async () => {
    const { c } = await staff("admin");
    expect((await team(c)).assignable).toEqual(["manager", "operator"]);
    const before = api.email.sent.length;
    const issued = await c.request("POST", "/api/team/invitations", {
      email: " Asha@Example.com ",
      role: "manager",
    });
    expect(issued.status).toBe(201);
    expect((await team(c)).invitations).toMatchObject([
      { email: "asha@example.com", role: "manager" },
    ]);

    const token = await tokenFor("asha@example.com", before);
    const guest = browser(api);
    expect(
      (await guest.request("POST", "/api/invitations/accept/preview", { token })).body,
    ).toMatchObject({ kind: "platform_member", role: "manager", email: "asha@example.com" });
    const accepted = await guest.request("POST", "/api/invitations/accept/member", {
      token,
      person: { name: "Asha Komba" },
    });
    expect(accepted.status).toBe(201);
    // It works once.
    expect(
      (
        await guest.request("POST", "/api/invitations/accept/member", {
          token,
          person: { name: "X" },
        })
      ).status,
    ).toBe(404);

    const asha = browser(api);
    await signInWithCode(api, asha, "asha@example.com");
    expect((await asha.request("GET", "/api/me")).body).toMatchObject({
      name: "Asha Komba",
      active: { scope: "platform", role: "manager" },
    });
    const listed = await team(c);
    expect(listed.invitations).toEqual([]);
    expect(listed.members.map((m) => [m.email, m.role, m.manageable])).toEqual([
      ["admin@example.com", "admin", false],
      ["asha@example.com", "manager", true],
    ]);
  });

  test("nobody gives, changes or removes a role at or above their own", async () => {
    const { c: manager, membershipId: managerId } = await staff("manager");
    const { membershipId: adminId } = await platformMember(t.db, {
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
    });
    const { membershipId: otherManager } = await platformMember(t.db, {
      email: "m2@example.com",
      name: "M2",
      role: "manager",
    });
    const { membershipId: operatorId } = await platformMember(t.db, {
      email: "op@example.com",
      name: "Op",
      role: "operator",
    });
    expect((await team(manager)).assignable).toEqual(["operator"]);
    const refused = await manager.request("POST", "/api/team/invitations", {
      email: "x@example.com",
      role: "manager",
    });
    expect(refused.status).toBe(403);
    for (const id of [adminId, otherManager]) {
      expect((await manager.request("DELETE", `/api/team/${id}`)).status).toBe(403);
      expect((await manager.request("PUT", `/api/team/${id}`, { role: "operator" })).status).toBe(
        403,
      );
    }
    expect((await manager.request("DELETE", `/api/team/${managerId}`)).status).toBe(400);
    // A manager may not lift an operator to manager either.
    expect(
      (await manager.request("PUT", `/api/team/${operatorId}`, { role: "manager" })).status,
    ).toBe(403);

    const { c: operator } = await staff("operator", "op2@example.com");
    expect((await operator.request("GET", "/api/team")).status).toBe(403);
  });

  test("the admin changes and removes; a removed person is signed out, and can be invited back", async () => {
    const { c } = await staff("admin");
    await platformMember(t.db, { email: "hamisi@example.com", name: "Hamisi", role: "operator" });
    const hamisi = browser(api);
    await enrollAuthenticatorFor(api, hamisi, "hamisi@example.com");
    const id = (await team(c)).members.find((m) => m.email === "hamisi@example.com")?.membershipId;
    expect((await c.request("PUT", `/api/team/${id}`, { role: "manager" })).status).toBe(204);
    expect((await hamisi.request("GET", "/api/me")).body).toMatchObject({
      active: { role: "manager" },
    });

    expect((await c.request("DELETE", `/api/team/${id}`)).status).toBe(204);
    expect((await hamisi.request("GET", "/api/me")).status).toBe(401);
    expect((await team(c)).members.map((m) => m.email)).toEqual(["admin@example.com"]);

    const before = api.email.sent.length;
    await c.request("POST", "/api/team/invitations", {
      email: "hamisi@example.com",
      role: "operator",
    });
    const token = await tokenFor("hamisi@example.com", before);
    expect(
      (
        await browser(api).request("POST", "/api/invitations/accept/member", {
          token,
          person: { name: "Hamisi" },
        })
      ).status,
    ).toBe(201);
    expect((await team(c)).members.find((m) => m.email === "hamisi@example.com")).toMatchObject({
      role: "operator",
    });
    const actions = (await t.db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["membership.role", "membership.remove"]));
  });

  test("someone already on the team is not invited again, and a manager can't touch a manager's invitation", async () => {
    const { c: admin } = await staff("admin");
    expect(
      (
        await admin.request("POST", "/api/team/invitations", {
          email: "admin@example.com",
          role: "operator",
        })
      ).status,
    ).toBe(409);
    const before = api.email.sent.length;
    const invited = (
      (
        await admin.request("POST", "/api/team/invitations", {
          email: "new@example.com",
          role: "manager",
        })
      ).body as { invitation: { id: string } }
    ).invitation;
    await tokenFor("new@example.com", before);
    const { c: manager } = await staff("manager");
    expect((await manager.request("DELETE", `/api/team/invitations/${invited.id}`)).status).toBe(
      403,
    );
    // Nor through the business invitations' routes.
    expect((await manager.request("DELETE", `/api/invitations/${invited.id}`)).status).toBe(404);
    expect((await manager.request("POST", `/api/invitations/${invited.id}/resend`)).status).toBe(
      404,
    );
  });
});

async function venueOf(name: string, businessId?: string) {
  const id = businessId ?? (await testBusinessId(t.db));
  return t.db.venue.create({
    data: { businessId: id, name, region: "Mwanza", area: "Kirumba" },
  });
}

async function member(
  role: "owner" | "business_manager" | "venue_manager" | "venue_operator",
  email: string,
  venueIds: string[] = [],
) {
  const m = await businessMember(t.db, { email, name: email, role, venueIds });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, email);
  return { c, membershipId: m.membershipId };
}

describe("a business's team", () => {
  test("the owner invites an operator to a venue, who accepts and works only there", async () => {
    const kijiwe = await venueOf("Kijiwe Cafe");
    await venueOf("Mama Neema Lodge");
    const { c } = await member("owner", "neema@example.com");
    expect((await team(c)).assignable).toEqual([
      "business_manager",
      "venue_manager",
      "venue_operator",
    ]);
    const before = api.email.sent.length;
    const issued = await c.request("POST", "/api/team/invitations", {
      email: "musa@example.com",
      role: "venue_operator",
      venueIds: [kijiwe.id],
    });
    expect(issued.status).toBe(201);
    expect(issued.body).toMatchObject({ invitation: { venueIds: [kijiwe.id] } });

    const token = await tokenFor("musa@example.com", before);
    const guest = browser(api);
    expect(
      (await guest.request("POST", "/api/invitations/accept/preview", { token })).body,
    ).toMatchObject({ kind: "business_member", role: "venue_operator" });
    const accepted = await guest.request("POST", "/api/invitations/accept/member", {
      token,
      person: { name: "Musa Lyimo" },
    });
    expect(accepted.status).toBe(201);

    const musa = browser(api);
    await signInWithCode(api, musa, "musa@example.com");
    expect((await musa.request("GET", "/api/me")).body).toMatchObject({
      active: { scope: "business", role: "venue_operator", venueIds: [kijiwe.id] },
    });
    // The business's team is its own: HashiNet's people are not on it.
    await platformMember(t.db, { email: "asha@example.com", name: "Asha", role: "manager" });
    const listed = await team(c);
    expect(listed.members.map((m) => m.email).sort()).toEqual([
      "musa@example.com",
      "neema@example.com",
    ]);
  });

  test("a venue role needs venues, of this business, and only a venue role has them", async () => {
    const own = await venueOf("Kijiwe Cafe");
    const other = await t.db.business.create({
      data: { name: "Kona", region: "Mwanza", area: "Kirumba" },
    });
    const elsewhere = await venueOf("Kona Masaki", other.id);
    const { c } = await member("owner", "neema@example.com");
    const invite = (role: string, venueIds: string[]) =>
      c.request("POST", "/api/team/invitations", { email: "x@example.com", role, venueIds });
    expect((await invite("venue_operator", [])).status).toBe(400);
    expect((await invite("venue_operator", [elsewhere.id])).status).toBe(400);
    expect((await invite("business_manager", [own.id])).status).toBe(400);
    expect((await invite("manager", [])).status).toBe(403);
    expect((await invite("business_manager", [])).status).toBe(201);
  });

  test("a venue manager gives only operators, only their own venues, and reaches only those people", async () => {
    const kijiwe = await venueOf("Kijiwe Cafe");
    const lodge = await venueOf("Mama Neema Lodge");
    const { c } = await member("venue_manager", "daudi@example.com", [kijiwe.id]);
    expect((await team(c)).assignable).toEqual(["venue_operator"]);
    const invite = (role: string, venueIds: string[]) =>
      c.request("POST", "/api/team/invitations", { email: "x@example.com", role, venueIds });
    expect((await invite("venue_manager", [kijiwe.id])).status).toBe(403);
    expect((await invite("venue_operator", [lodge.id])).status).toBe(403);
    expect((await invite("venue_operator", [kijiwe.id])).status).toBe(201);

    const atLodge = await businessMember(t.db, {
      email: "halima@example.com",
      name: "Halima",
      role: "venue_operator",
      venueIds: [lodge.id],
    });
    const atKijiwe = await businessMember(t.db, {
      email: "musa@example.com",
      name: "Musa",
      role: "venue_operator",
      venueIds: [kijiwe.id],
    });
    const listed = await team(c);
    const manageable = (id: string) =>
      listed.members.find((m) => m.membershipId === id)?.manageable;
    expect(manageable(atLodge.membershipId)).toBe(false);
    expect(manageable(atKijiwe.membershipId)).toBe(true);
    expect((await c.request("DELETE", `/api/team/${atLodge.membershipId}`)).status).toBe(403);
    // Moving an operator to a venue the manager doesn't run is refused.
    expect(
      (
        await c.request("PUT", `/api/team/${atKijiwe.membershipId}`, {
          role: "venue_operator",
          venueIds: [lodge.id],
        })
      ).status,
    ).toBe(403);
  });

  test("the owner moves an operator to other venues, then makes them a business manager", async () => {
    const kijiwe = await venueOf("Kijiwe Cafe");
    const lodge = await venueOf("Mama Neema Lodge");
    const { c } = await member("owner", "neema@example.com");
    const musa = await businessMember(t.db, {
      email: "musa@example.com",
      name: "Musa",
      role: "venue_operator",
      venueIds: [kijiwe.id],
    });
    const put = (body: object) => c.request("PUT", `/api/team/${musa.membershipId}`, body);
    expect((await put({ role: "venue_operator", venueIds: [kijiwe.id, lodge.id] })).status).toBe(
      204,
    );
    const venues = async () =>
      (await t.db.membershipVenue.findMany({ where: { membershipId: musa.membershipId } }))
        .map((v) => v.venueId)
        .sort();
    expect(await venues()).toEqual([kijiwe.id, lodge.id].sort());
    expect((await put({ role: "business_manager", venueIds: [] })).status).toBe(204);
    expect(await venues()).toEqual([]);
  });
});
