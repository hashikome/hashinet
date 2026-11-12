import { describe, expect, test } from "bun:test";
import type { MembershipRole } from "@hashinet/types";
import { allows, capabilitiesOf, needsProtectedSession } from "./policy.js";
import { accessLevel, type Principal } from "./principal.js";
import { venueScope } from "./venue-scope.js";

const day = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-12T12:00:00Z");
const facts = (over: Partial<Parameters<typeof accessLevel>[0]>) => ({
  role: "owner" as MembershipRole,
  signedInWith: "email_code" as const,
  personProtected: false,
  membershipStartedAt: new Date(now.getTime() - day),
  now,
  ...over,
});

describe("sign-in protection (ADR-0011, 9)", () => {
  test("a session signed in with an authenticator, a passkey or a recovery code may act", () => {
    for (const signedInWith of ["authenticator", "passkey", "recovery_code"] as const) {
      expect(accessLevel(facts({ signedInWith, personProtected: true }))).toBe("full");
    }
  });

  test("operators may sign in with an email code alone", () => {
    expect(accessLevel(facts({ role: "venue_operator" }))).toBe("full");
  });

  test("platform staff with an email code alone reach only Account and security", () => {
    for (const role of ["admin", "manager", "operator"] as const) {
      expect(accessLevel(facts({ role }))).toBe("account");
    }
  });

  test("an unprotected owner or manager gets set up for 7 days, then only Account", () => {
    for (const role of ["owner", "business_manager", "venue_manager"] as const) {
      expect(accessLevel(facts({ role }))).toBe("setup");
      const later = new Date(now.getTime() - 8 * day);
      expect(accessLevel(facts({ role, membershipStartedAt: later }))).toBe("account");
    }
  });

  test("someone with a passkey who signed in with an email code alone reaches only Account", () => {
    expect(accessLevel(facts({ personProtected: true }))).toBe("account");
  });

  test("selling and printing need a protected session", () => {
    expect(needsProtectedSession("sale.record")).toBe(true);
    expect(needsProtectedSession("voucher.print")).toBe(true);
    expect(needsProtectedSession("package.read")).toBe(false);
  });
});

describe("the policy (ADR-0011)", () => {
  test("business-wide prices are the owner's alone", () => {
    expect(allows("owner", "package.manage")).toBe(true);
    for (const role of ["business_manager", "venue_manager", "venue_operator", "admin"] as const) {
      expect(allows(role, "package.manage")).toBe(false);
    }
  });

  test("the platform sees no guest's codes, sessions or devices (ADR-0014)", () => {
    for (const role of ["admin", "manager", "operator"] as const) {
      for (const action of [
        "voucher.read",
        "session.read",
        "device.read",
        "payment.read",
      ] as const) {
        expect(allows(role, action)).toBe(false);
      }
    }
  });

  test("only HashiNet's admin and managers set up routers; its operators check them", () => {
    expect(allows("admin", "router.manage")).toBe(true);
    expect(allows("manager", "router.manage")).toBe(true);
    expect(allows("operator", "router.manage")).toBe(false);
    expect(allows("operator", "router.check")).toBe(true);
    expect(allows("owner", "router.manage")).toBe(false);
  });

  test("operators sell and read, but neither revoke nor block nor read the audit log", () => {
    expect(allows("venue_operator", "sale.record")).toBe(true);
    expect(allows("venue_operator", "voucher.revoke")).toBe(false);
    expect(allows("venue_operator", "device.block")).toBe(false);
    expect(allows("venue_operator", "audit.read")).toBe(false);
  });

  test("capabilities are exactly the actions the role allows", () => {
    expect(capabilitiesOf("venue_operator")).toContain("sale.record");
    expect(capabilitiesOf("venue_operator")).not.toContain("audit.read");
  });
});

describe("venue scope", () => {
  const principal = (over: Partial<Principal>): Principal => ({
    sessionId: "s",
    userId: "u",
    email: "e@example.com",
    name: "E",
    membershipId: "m",
    scope: "business",
    businessId: "b",
    role: "venue_manager",
    venueIds: ["v1"],
    access: "full",
    ...over,
  });

  test("a venue manager's scope never carries an id that would replace the caller's", () => {
    const where = { id: "theirs", ...venueScope(principal({})) };
    expect(where.id).toBe("theirs");
    expect(where).toMatchObject({ businessId: "b", members: { some: { membershipId: "m" } } });
  });

  test("the owner reaches the business; the platform every venue", () => {
    expect(venueScope(principal({ role: "owner", venueIds: null }))).toEqual({ businessId: "b" });
    expect(venueScope(principal({ scope: "platform", businessId: null, role: "admin" }))).toEqual(
      {},
    );
  });
});
