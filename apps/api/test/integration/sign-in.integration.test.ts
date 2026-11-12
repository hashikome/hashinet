import { describe, expect, test } from "bun:test";
import {
  Client,
  enrollAuthenticatorFor,
  requestSignInCode,
  signInWithCode,
  totp,
  useApi,
} from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, platformMember } from "./people.js";

const t = useTestDatabase();
const api = useApi();

let nextIp = 1;
/** A fresh client address, so the per-address rate limits stay out of the way. */
function client(): Client {
  nextIp += 1;
  return new Client(() => api.url, `203.0.113.${nextIp % 250}`);
}

const requestCode = (c: Client, email: string) => requestSignInCode(c, email);
const signIn = (c: Client, email: string) => signInWithCode(api, c, email);
const enrollAuthenticator = (c: Client, email: string) => enrollAuthenticatorFor(api, c, email);

describe("sign-in", () => {
  test("an email code signs active staff in", async () => {
    await businessMember(t.db, {
      email: "Manager@Example.com",
      name: "Manager",
      role: "venue_manager",
    });
    const c = client();
    expect((await c.request("GET", "/api/me")).status).toBe(401);
    expect((await signIn(c, "manager@example.com")).status).toBe(200);
    const me = await c.request("GET", "/api/me");
    expect(me.status).toBe(200);
    // A new venue manager signed in with a code alone may get set up, not sell (ADR-0011, 9).
    expect(me.body).toMatchObject({
      email: "manager@example.com",
      active: { role: "venue_manager", scope: "business", access: "setup" },
      protection: { required: true, authenticator: false, passkeys: 0 },
    });
    expect((await t.db.membership.findFirstOrThrow()).lastUsedAt).not.toBeNull();

    expect((await c.request("POST", "/api/auth/sign-out", {})).status).toBe(200);
    expect((await c.request("GET", "/api/me")).status).toBe(401);
  });

  test("a stranger's email gets the same answers as staff, and no email", async () => {
    await businessMember(t.db, {
      email: "staff@example.com",
      name: "Staff",
      role: "venue_manager",
    });
    const staff = await requestCode(client(), "staff@example.com");
    const stranger = await requestCode(client(), "stranger@example.com");
    expect(stranger).toEqual(staff);
    await Bun.sleep(100);
    expect(api.email.sent.some((m) => m.to === "stranger@example.com")).toBe(false);

    const wrongForStaff = await client().request("POST", "/api/auth/sign-in/email-otp", {
      email: "staff@example.com",
      otp: "000000",
    });
    const anyForStranger = await client().request("POST", "/api/auth/sign-in/email-otp", {
      email: "stranger@example.com",
      otp: "000000",
    });
    expect(anyForStranger).toEqual(wrongForStaff);
    expect(anyForStranger.status).toBe(400);
  });

  test("codes are stored keyed, never as sent", async () => {
    await businessMember(t.db, {
      email: "keyed@example.com",
      name: "Keyed",
      role: "venue_manager",
    });
    const before = api.email.sent.length;
    await requestCode(client(), "keyed@example.com");
    const code = await api.email.codeFor("keyed@example.com", before);
    const stored = await t.db.verification.findMany();
    expect(stored.length).toBe(1);
    expect(stored.some((v) => v.value.includes(code))).toBe(false);
  });

  test("after five wrong codes the right one no longer works", async () => {
    await businessMember(t.db, {
      email: "guess@example.com",
      name: "Guess",
      role: "venue_manager",
    });
    const before = api.email.sent.length;
    await requestCode(client(), "guess@example.com");
    const otp = await api.email.codeFor("guess@example.com", before);
    const wrong = otp === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) {
      const attempt = await client().request("POST", "/api/auth/sign-in/email-otp", {
        email: "guess@example.com",
        otp: wrong,
      });
      expect(attempt.status).toBe(400);
    }
    const right = await client().request("POST", "/api/auth/sign-in/email-otp", {
      email: "guess@example.com",
      otp,
    });
    expect(right.status).not.toBe(200);
  });

  test("one address may request three codes a minute", async () => {
    const c = client();
    for (let i = 0; i < 3; i++) {
      expect((await requestCode(c, "nobody@example.com")).status).toBe(200);
    }
    expect((await requestCode(c, "nobody@example.com")).status).toBe(429);
  });

  test("one person receives at most five codes in fifteen minutes, from any address", async () => {
    await businessMember(t.db, {
      email: "flood@example.com",
      name: "Flood",
      role: "venue_manager",
    });
    for (let i = 0; i < 7; i++) {
      expect((await requestCode(client(), "flood@example.com")).status).toBe(200);
    }
    await Bun.sleep(200);
    expect(api.email.sent.filter((m) => m.to === "flood@example.com").length).toBe(5);
  });

  test("requests beyond the budget do not void the last code sent", async () => {
    await businessMember(t.db, {
      email: "target@example.com",
      name: "Target",
      role: "venue_manager",
    });
    for (let i = 0; i < 5; i++) await requestCode(client(), "target@example.com");
    const fifth = await api.email.codeFor("target@example.com");
    await Bun.sleep(100);
    const flood = await requestCode(client(), "target@example.com");
    expect(flood).toEqual(await requestCode(client(), "nobody-else@example.com"));
    await requestCode(client(), "target@example.com");
    const signedIn = await client().request("POST", "/api/auth/sign-in/email-otp", {
      email: "target@example.com",
      otp: fifth,
    });
    expect(signedIn.status).toBe(200);
  });

  test("removing a person's membership ends their session and stops their codes", async () => {
    const { membershipId: id } = await businessMember(t.db, {
      email: "leaver@example.com",
      name: "Leaver",
      role: "venue_manager",
    });
    const c = client();
    expect((await signIn(c, "leaver@example.com")).status).toBe(200);
    await t.db.membership.update({ where: { id }, data: { status: "removed" } });
    expect((await c.request("GET", "/api/me")).status).toBe(401);

    const before = api.email.sent.length;
    expect((await requestCode(client(), "leaver@example.com")).status).toBe(200);
    await Bun.sleep(100);
    expect(api.email.sent.length).toBe(before);
  });

  test("only the sign-in routes HashiNet uses are reachable", async () => {
    const c = client();
    const routes: [string, string, unknown][] = [
      ["POST", "/api/auth/sign-up/email", { email: "x@example.com", password: "p", name: "x" }],
      ["POST", "/api/auth/sign-in/email", { email: "x@example.com", password: "p" }],
      ["POST", "/api/auth/two-factor/disable", {}],
      ["POST", "/api/auth/update-user", { name: "x" }],
      ["POST", "/api/auth/email-otp/verify-email", { email: "x@example.com", otp: "1" }],
      ["POST", "/api/auth/passkey/update-passkey", { id: "x", name: "x" }],
    ];
    for (const [method, path, body] of routes) {
      expect((await c.request(method, path, body)).status).toBe(404);
    }
    const reset = await c.request("POST", "/api/auth/email-otp/send-verification-otp", {
      email: "x@example.com",
      type: "forget-password",
    });
    expect(reset.status).toBe(400);
  });
});

describe("my profile", () => {
  test("anyone changes their own name, and only that", async () => {
    await businessMember(t.db, { email: "me@example.com", name: "Old", role: "venue_manager" });
    const c = client();
    await signIn(c, "me@example.com");
    const reply = await c.request("PUT", "/api/me", { name: "  New Name ", role: "admin" });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ name: "New Name", active: { role: "venue_manager" } });
    expect((await c.request("GET", "/api/me")).body).toMatchObject({ name: "New Name" });
    expect((await c.request("PUT", "/api/me", { name: "" })).status).toBe(400);
  });
});

describe("protection is the session's, not the inbox's", () => {
  test("a passkey-protected person signed in with an email code alone cannot add a second factor", async () => {
    const person = await businessMember(t.db, {
      email: "pk@example.com",
      name: "Passkey Person",
      role: "owner",
    });
    await t.db.passkey.create({
      data: {
        id: Bun.randomUUIDv7(),
        userId: person.id,
        publicKey: "test-key",
        credentialID: "test-credential",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      },
    });
    const c = client();
    expect((await signIn(c, "pk@example.com")).status).toBe(200);
    expect((await c.request("GET", "/api/me")).body).toMatchObject({
      active: { access: "account" },
    });
    const enable = await c.request("POST", "/api/auth/two-factor/enable", {});
    expect(enable.status).toBe(403);
    expect(enable.body).toMatchObject({ code: "PROTECTION_REQUIRED" });
    expect((await c.request("GET", "/api/me")).body).toMatchObject({
      active: { access: "account" },
      protection: { authenticator: false, passkeys: 1 },
    });
  });
});

describe("passkeys", () => {
  test("registration and sign-in both ask for user verification (ADR-0011, 9)", async () => {
    const c = client();
    const signInOptions = await c.request("GET", "/api/auth/passkey/generate-authenticate-options");
    expect(signInOptions.status).toBe(200);
    expect(signInOptions.body).toMatchObject({ userVerification: "required", rpId: "localhost" });

    await businessMember(t.db, {
      email: "pk@example.com",
      name: "Passkey",
      role: "venue_operator",
    });
    const operator = client();
    expect((await signIn(operator, "pk@example.com")).status).toBe(200);
    const register = await operator.request("GET", "/api/auth/passkey/generate-register-options");
    expect(register.status).toBe(200);
    expect(register.body).toMatchObject({
      rp: { id: "localhost", name: "HashiNet" },
      authenticatorSelection: { userVerification: "required" },
    });
  });

  test("removing a passkey asks for proof first: an email code alone cannot", async () => {
    const person = await businessMember(t.db, {
      email: "rm@example.com",
      name: "Rm",
      role: "owner",
    });
    const id = Bun.randomUUIDv7();
    await t.db.passkey.create({
      data: {
        id,
        userId: person.id,
        publicKey: "test-key",
        credentialID: "test-credential",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      },
    });
    const c = client();
    expect((await signIn(c, "rm@example.com")).status).toBe(200);
    const removed = await c.request("POST", "/api/auth/passkey/delete-passkey", { id });
    expect(removed.status).toBe(403);
    expect(removed.body).toMatchObject({ code: "PROTECTION_REQUIRED" });
    expect(await t.db.passkey.count({ where: { userId: person.id } })).toBe(1);
  });
});

describe("recovery codes", () => {
  test("new codes need a protected session, and a code signs in once", async () => {
    await platformMember(t.db, { email: "rc@example.com", name: "Rc", role: "admin" });
    const first = client();
    await enrollAuthenticator(first, "rc@example.com");
    const made = await first.request("POST", "/api/auth/two-factor/generate-backup-codes", {});
    expect(made.status).toBe(200);
    const codes = (made.body as { backupCodes: string[] }).backupCodes;
    expect(codes.length).toBeGreaterThan(0);

    const c = client();
    expect((await signIn(c, "rc@example.com")).body).toMatchObject({ twoFactorRedirect: true });
    const used = await c.request("POST", "/api/auth/two-factor/verify-backup-code", {
      code: codes[0],
    });
    expect(used.status).toBe(200);
    // A recovery code is proof enough: the session may act.
    expect((await c.request("GET", "/api/me")).body).toMatchObject({ active: { access: "full" } });

    const again = client();
    await signIn(again, "rc@example.com");
    const reused = await again.request("POST", "/api/auth/two-factor/verify-backup-code", {
      code: codes[0],
    });
    expect(reused.status).toBe(401);
  });
});

describe("authenticator app", () => {
  test("an admin without one reaches only Account and security", async () => {
    await platformMember(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
    const c = client();
    expect((await signIn(c, "admin@example.com")).status).toBe(200);
    const me = await c.request("GET", "/api/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      active: { role: "admin", access: "account", capabilities: [] },
      protection: { required: true, authenticator: false },
    });
    const refused = await c.request("GET", "/api/venues");
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "PROTECTION_REQUIRED" });
  });

  test("once set up, sign-in needs both codes, and no device skips the second", async () => {
    await platformMember(t.db, { email: "owner@example.com", name: "Owner", role: "admin" });
    const first = client();
    const uri = await enrollAuthenticator(first, "owner@example.com");
    const enrolled = await first.request("GET", "/api/me");
    // Setting it up proves this session holds it, so the session may act at once.
    expect(enrolled.body).toMatchObject({
      active: { access: "full" },
      protection: { authenticator: true },
    });
    const again = await first.request("POST", "/api/auth/two-factor/enable", {});
    expect(again.status).toBe(400);

    const c = client();
    const challenged = await signIn(c, "owner@example.com");
    expect(challenged.body).toMatchObject({ twoFactorRedirect: true });
    expect((await c.request("GET", "/api/me")).status).toBe(401);
    const wrong = await c.request("POST", "/api/auth/two-factor/verify-totp", { code: "000000" });
    expect(wrong.status).toBe(401);
    const verified = await c.request("POST", "/api/auth/two-factor/verify-totp", {
      code: totp(uri),
      trustDevice: true,
    });
    expect(verified.status).toBe(200);
    expect((await c.request("GET", "/api/me")).status).toBe(200);
    const trusted = await t.db.verification.count({
      where: { identifier: { startsWith: "trust-device-" } },
    });
    expect(trusted).toBe(0);

    // Asked to trust this browser, HashiNet still asks for the authenticator next time.
    await c.request("POST", "/api/auth/sign-out", {});
    expect((await signIn(c, "owner@example.com")).body).toMatchObject({ twoFactorRedirect: true });
    expect((await c.request("GET", "/api/me")).status).toBe(401);
  });
});
