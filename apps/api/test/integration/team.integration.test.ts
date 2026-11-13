import { describe, expect, test } from "bun:test";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { platformMember } from "./people.js";

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
