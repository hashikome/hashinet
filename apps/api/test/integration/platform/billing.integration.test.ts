import { describe, expect, test } from "bun:test";
import type { BillingSettingsResponse } from "@hashinet/types";
import { browser, type Client, enrollAuthenticatorFor, useApi } from "../api.js";
import { useTestDatabase } from "../harness.js";
import { businessMember, platformMember, testBusinessId } from "../people.js";

const t = useTestDatabase();
const api = useApi();

async function staff(role: "admin" | "manager" | "operator"): Promise<Client> {
  const email = `${role}@example.com`;
  await platformMember(t.db, { email, name: role, role });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, email);
  return c;
}

/** The token from the newest invitation sent to `to`; it is sent in the background. */
async function tokenFor(to: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const found = [...api.email.sent].reverse().find((m) => m.to === to && /#token=/.test(m.text));
    const token = found?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
    if (token) return token;
    await Bun.sleep(20);
  }
  throw new Error(`no invitation reached ${to}`);
}

const SETTINGS = {
  terms: { rateBp: 600, lowerRateBp: 300, lowerRateAboveTsh: 3_000_000, minimumTsh: 6_000 },
  siteSlotTsh: 12_000,
  payTo: {
    mobileMoney: "5512 8840",
    mobileMoneyName: "",
    bankName: "",
    bankBranch: "",
    bankAccount: "",
    bankSwift: "",
    accountName: "Shikome Technology Limited",
  },
  issuer: {
    postal: "P.O. Box 17108, Dar es Salaam",
    office: "",
    email: "",
    registration: "",
    tin: "",
  },
};

describe("fees", () => {
  test("today's terms until the admin saves; managers read them; only the admin changes them", async () => {
    const admin = await staff("admin");
    const first = (await admin.request("GET", "/api/billing/settings"))
      .body as BillingSettingsResponse;
    expect(first.settings).toMatchObject({
      terms: { rateBp: 500, lowerRateBp: 250, lowerRateAboveTsh: 2_000_000, minimumTsh: 5_000 },
      payTo: { mobileMoney: null, bankAccount: null },
      updatedAt: null,
    });

    const saved = await admin.request("PUT", "/api/billing/settings", SETTINGS);
    expect(saved.status).toBe(200);
    expect((saved.body as BillingSettingsResponse).settings).toMatchObject({
      payTo: {
        mobileMoney: "5512 8840",
        mobileMoneyName: null,
        bankName: null,
        bankAccount: null,
        bankSwift: null,
        accountName: "Shikome Technology Limited",
      },
      issuer: { postal: "P.O. Box 17108, Dar es Salaam", office: null, tin: null },
    });
    expect(
      (
        await admin.request("PUT", "/api/billing/settings", {
          ...SETTINGS,
          terms: { ...SETTINGS.terms, rateBp: 10_001 },
        })
      ).status,
    ).toBe(400);

    const manager = await staff("manager");
    expect((await manager.request("GET", "/api/billing/settings")).status).toBe(200);
    expect((await manager.request("PUT", "/api/billing/settings", SETTINGS)).status).toBe(403);
    const operator = await staff("operator");
    expect((await operator.request("GET", "/api/billing/settings")).status).toBe(403);
    await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
    const owner = browser(api);
    await enrollAuthenticatorFor(api, owner, "owner@example.com");
    expect((await owner.request("GET", "/api/billing/settings")).status).toBe(403);

    const audit = await t.db.auditLog.findFirstOrThrow({ where: { action: "fees.update" } });
    expect(audit.businessId).toBeNull();
  });

  test("a business keeps the terms it was added with; a change reaches only businesses after it", async () => {
    const existing = await t.db.business.findUniqueOrThrow({
      where: { id: await testBusinessId(t.db) },
    });
    const admin = await staff("admin");
    await admin.request("PUT", "/api/billing/settings", SETTINGS);
    await admin.request("POST", "/api/invitations/businesses", { email: "baraka@example.com" });
    const accepted = await browser(api).request("POST", "/api/invitations/accept/business", {
      token: await tokenFor("baraka@example.com"),
      person: { name: "Baraka Mollel", phone: "0754 300 118" },
      business: { name: "Bahari Beach Bar", region: "Dar es Salaam", area: "Mjimwema" },
      venue: { name: "Bahari Beach Bar", region: "Dar es Salaam", area: "Mjimwema" },
    });
    expect(accepted.status).toBe(201);

    const added = await t.db.business.findFirstOrThrow({ where: { name: "Bahari Beach Bar" } });
    expect(added).toMatchObject({
      feeRateBp: 600,
      feeLowerRateBp: 300,
      feeLowerRateAboveTsh: 3_000_000,
      feeMinimumTsh: 6_000,
    });
    const before = await t.db.business.findUniqueOrThrow({ where: { id: existing.id } });
    expect(before).toMatchObject({ feeRateBp: 500, feeMinimumTsh: 5_000 });
  });
});
