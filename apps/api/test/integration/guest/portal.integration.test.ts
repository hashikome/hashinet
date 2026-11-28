import { describe, expect, test } from "bun:test";
import type { PlatformPortal } from "@hashinet/types";
import { copyToBusiness } from "../../../src/guest/portal/copy-down.js";
import { HASHINET_PORTAL } from "../../../src/guest/portal/portal-input.js";
import { browser, type Client, enrollAuthenticatorFor, useApi } from "../api.js";
import { useTestDatabase } from "../harness.js";
import { platformMember, testBusinessId } from "../people.js";

const t = useTestDatabase();
const api = useApi();

async function staff(role: "admin" | "manager" | "operator", email: string): Promise<Client> {
  await platformMember(t.db, { email, name: email, role });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, email);
  return c;
}

const portalOf = (reply: { body: unknown }) => reply.body as PlatformPortal;

describe("what a new business's portal starts with", () => {
  test("HashiNet's own until saved; saved, audited and restored; operators only read", async () => {
    const c = await staff("manager", "manager@example.com");
    const first = portalOf(await c.request("GET", "/api/portal"));
    expect(first).toMatchObject({ content: HASHINET_PORTAL, updatedAt: null });

    const saved = await c.request("PUT", "/api/portal", {
      ...HASHINET_PORTAL,
      opensOn: "buy",
      welcome: "Karibu",
    });
    expect(saved.status).toBe(200);
    expect(portalOf(saved).content).toMatchObject({ opensOn: "buy", welcome: "Karibu" });
    expect(await t.db.portalSetting.count()).toBe(1);

    const o = await staff("operator", "operator@example.com");
    expect(portalOf(await o.request("GET", "/api/portal")).content.welcome).toBe("Karibu");
    expect((await o.request("PUT", "/api/portal", HASHINET_PORTAL)).status).toBe(403);

    const restored = portalOf(await c.request("DELETE", "/api/portal"));
    expect(restored.content).toEqual(HASHINET_PORTAL);
    const actions = (await t.db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(["portal.defaults.update", "portal.defaults.reset"]);
  });

  test("bad content is refused field by field", async () => {
    const c = await staff("admin", "admin@example.com");
    const reply = await c.request("PUT", "/api/portal", {
      ...HASHINET_PORTAL,
      welcome: "",
      opensOn: "elsewhere",
      contactPhone: "12345",
      // Not a field: unknown fields are ignored, never stored.
      logoUrl: "https://tracker.example/logo.png",
    });
    expect(reply.status).toBe(400);
    expect(Object.keys((reply.body as { details: object }).details).sort()).toEqual([
      "contactPhone",
      "opensOn",
      "welcome",
    ]);
  });

  test("themes: one default, which a new business starts with; the default stays", async () => {
    const c = await staff("manager", "manager@example.com");
    const add = (name: string, pageColor: string, buttonColor: string) =>
      c.request("POST", "/api/portal/themes", { name, pageColor, buttonColor });
    expect((await add("Midnight", "#0d1b2a", "#f59e2a")).status).toBe(201);
    const added = portalOf(await add("Wine", "#7A1F2B", "#F2C14E"));
    expect(added.themes.map((x) => [x.name, x.pageColor])).toEqual([
      ["Midnight", "#0D1B2A"],
      ["Wine", "#7A1F2B"],
    ]);
    expect((await add("Wine", "#000000", "#FFFFFF")).status).toBe(409);
    expect((await add("Bad", "red", "#FFFFFF")).status).toBe(400);

    const wine = added.themes.find((x) => x.name === "Wine")?.id;
    const midnight = added.themes.find((x) => x.name === "Midnight")?.id;
    const made = portalOf(await c.request("PUT", `/api/portal/themes/${wine}/default`));
    expect(made.themes.map((x) => [x.name, x.isDefault])).toEqual([
      ["Wine", true],
      ["Midnight", false],
    ]);
    expect((await c.request("DELETE", `/api/portal/themes/${wine}`)).status).toBe(409);

    // A new business starts with the default theme's colours and the platform's content.
    await c.request("PUT", "/api/portal", { ...HASHINET_PORTAL, welcome: "Karibu" });
    const businessId = await testBusinessId(t.db, "New");
    await copyToBusiness(t.db, businessId);
    expect(await t.db.businessPortal.findUniqueOrThrow({ where: { businessId } })).toMatchObject({
      pageColor: "#7A1F2B",
      buttonColor: "#F2C14E",
      welcome: "Karibu",
    });
    // Removing a theme changes nobody's portal: a portal keeps its colours.
    await c.request("PUT", `/api/portal/themes/${midnight}/default`);
    expect((await c.request("DELETE", `/api/portal/themes/${wine}`)).status).toBe(200);
    expect((await t.db.businessPortal.findUniqueOrThrow({ where: { businessId } })).pageColor).toBe(
      "#7A1F2B",
    );

    const o = await staff("operator", "operator@example.com");
    expect((await o.request("POST", "/api/portal/themes", { name: "X" })).status).toBe(403);
  });
});
