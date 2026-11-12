import { createHmac, randomInt } from "node:crypto";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP, twoFactor } from "better-auth/plugins";
import type { SignInMethod } from "../access/principal.js";
import type { AppConfig } from "../config/config.js";
import type { PrismaClient } from "../database/client.js";
import type { EmailSender } from "../email/email-sender.js";
import { captureFailure } from "../observability/telemetry.js";
import { consumeSignInCode } from "./sign-in-code-budget.js";
import { SIGN_IN_CODE_MINUTES, signInCodeEmail } from "./sign-in-code-email.js";

export const AUTH_BASE_PATH = "/api/auth";
export const BETTER_AUTH = Symbol("BETTER_AUTH");

export interface AuthDependencies {
  config: AppConfig;
  db: PrismaClient;
  email: EmailSender;
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Better Auth, configured to ADR-0007 rather than to the library's defaults:
 *
 * - Email one-time codes only. No passwords, no sign-up: a code is sent only to someone with an
 *   active membership, and every caller gets the same answer whether or not they have one.
 * - Codes are stored under an HMAC keyed by the auth secret, so a database copy does not
 *   reveal them (a bare hash of six digits is reversed by trying a million).
 * - A person with an authenticator app must give its code after the email code: the
 *   two-factor gate is widened to the email-code sign-in (`withEmailCodeGate`). No device is
 *   ever trusted to skip it. Each session records how it signed in, which the access guard reads
 *   for ADR-0011's protection rule.
 * - Rate limits are on in every environment and kept in PostgreSQL, shared by every process;
 *   a per-person budget (`consumeSignInCode`) limits codes sent whatever address asks.
 * - Someone with no active membership cannot get a code or a session.
 * - Passkeys sign in on their own, and only with user verification (ADR-0011, 9).
 * - Library telemetry is off.
 */
export function createAuth({ config, db, email }: AuthDependencies) {
  const otpKey = config.auth.secret;
  return betterAuth({
    appName: "HashiNet",
    baseURL: config.appUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.auth.secret,
    trustedOrigins: [config.frontendOrigin],
    database: prismaAdapter(db, { provider: "postgresql" }),
    emailAndPassword: { enabled: false },
    session: {
      additionalFields: {
        // Written only by HashiNet: the access guard and `POST /api/me/membership`, and the
        // create hook below.
        activeMembershipId: { type: "string", required: false, input: false },
        signedInWith: { type: "string", required: false, input: false },
        provedAt: { type: "date", required: false, input: false },
      },
    },
    telemetry: { enabled: false },
    advanced: {
      database: { generateId: () => Bun.randomUUIDv7() },
      ipAddress: { trustedProxies: config.auth.trustedProxies },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimit",
      // The library allows three code requests and three sign-ins per minute per address.
      // Second-factor checks get a minute-long window too, rather than ten seconds.
      customRules: {
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            const member = await db.membership.findFirst({
              where: { userId: session.userId, status: "active" },
            });
            if (!member) {
              throw new APIError("FORBIDDEN", {
                code: "ACCOUNT_INACTIVE",
                message: "This account cannot sign in.",
              });
            }
            const signedInWith = signInMethodOf(ctx?.path);
            return {
              data: {
                ...session,
                signedInWith,
                provedAt: signedInWith === "email_code" ? null : new Date(),
              },
            };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/email-otp/send-verification-otp") {
          if (ctx.body?.type !== "sign-in") {
            throw new APIError("BAD_REQUEST", { message: "Only sign-in codes are sent." });
          }
          // Decided before the library creates a code: once it has, it replaces the previous
          // one, so refusing later would void the code the person last received. Refusals
          // give the library's own answer.
          const address = String(ctx.body?.email ?? "").toLowerCase();
          if (!(await maySendSignInCode(db, address))) return ctx.json({ success: true });
        }
        if (ctx.path === "/two-factor/verify-backup-code" && typeof ctx.body?.code === "string") {
          // Recovery codes are read off paper: any case, spaces or a missing dash still match.
          return {
            context: {
              body: { ...ctx.body, code: normalRecoveryCode(ctx.body.code), trustDevice: false },
            },
          };
        }
        if (ctx.path.startsWith("/two-factor/verify-") && ctx.body?.trustDevice === true) {
          // HashiNet trusts no device to skip the authenticator (withEmailCodeGate).
          return { context: { body: { ...ctx.body, trustDevice: false } } };
        }
        if (ctx.path === "/two-factor/enable") {
          // Enabling again would replace the authenticator with a session alone.
          const current = await getSessionFromCtx(ctx);
          if (current?.user.twoFactorEnabled === true) {
            throw new APIError("BAD_REQUEST", {
              code: "TWO_FACTOR_ALREADY_ENABLED",
              message: "An authenticator app is already set up.",
            });
          }
        }
        if (CHANGES_PROTECTION.has(ctx.path)) {
          // Removing a passkey or making new recovery codes asks for proof first: a passkey, an
          // authenticator code or a recovery code in the last 2 hours (ADR-0011, 9).
          const current = await getSessionFromCtx(ctx);
          if (!current || !(await provedRecently(db, current.session.id))) {
            throw new APIError("FORBIDDEN", {
              code: "PROOF_REQUIRED",
              message: "Confirm it's you with your passkey, authenticator app or a recovery code.",
            });
          }
        }
        if (ADDS_PROTECTION.has(ctx.path)) {
          // Someone who already has protection adds more only from a session that used it:
          // otherwise an email inbox alone could add its own second factor (ADR-0011, 9).
          const current = await getSessionFromCtx(ctx);
          if (current && (await hasProtection(db, current.user.id))) {
            const row = await db.session.findUnique({ where: { id: current.session.id } });
            if (row === null || row.signedInWith === null || row.signedInWith === "email_code") {
              throw new APIError("FORBIDDEN", {
                code: "PROTECTION_REQUIRED",
                message: "Sign in with your passkey or authenticator app to add another.",
              });
            }
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        // After hooks run for failures too, with the error as the result: a wrong code proves
        // nothing.
        if (ctx.context.returned instanceof APIError) return;
        // A passkey, an authenticator code or a recovery code proves the session afresh, whether it
        // signs in or confirms a change.
        if (PROVES.has(ctx.path)) {
          const proving = await getSessionFromCtx(ctx);
          if (proving) {
            await db.session.updateMany({
              where: { id: proving.session.id },
              data: { provedAt: new Date() },
            });
          }
        }
        // A person's first protection, set up from an email-code session, proves the session
        // holds it, so the session counts as protected from then on (ADR-0011, 9). Someone who
        // already had protection cannot reach here from an email-code session (`hooks.before`),
        // and a session that already used protection is left as it signed in.
        const proved =
          ctx.path === "/two-factor/verify-totp"
            ? "authenticator"
            : ctx.path === "/passkey/verify-registration"
              ? "passkey"
              : null;
        if (proved === null) return;
        const current = await getSessionFromCtx(ctx);
        if (!current) return;
        await db.session.updateMany({
          where: { id: current.session.id, signedInWith: "email_code" },
          data: { signedInWith: proved },
        });
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: SIGN_IN_CODE_MINUTES * 60,
        allowedAttempts: 5,
        disableSignUp: true,
        storeOTP: {
          hash: async (otp) => createHmac("sha256", otpKey).update(otp).digest("base64url"),
        },
        // Reached only for an active member within their budget (`maySendSignInCode`). Not
        // awaited, so the answer does not wait on Resend.
        sendVerificationOTP: async ({ email: address, otp }) => {
          void email.send(signInCodeEmail(address, otp)).catch(captureFailure);
        },
      }),
      withEmailCodeGate(
        twoFactor({
          issuer: "HashiNet",
          allowPasswordless: true,
          backupCodeOptions: { customBackupCodesGenerate: recoveryCodes },
        }),
      ),
      // A passkey counts only with user verification (the device unlock), requested and checked
      // at registration and at every sign-in, so it is two factors whatever holds it
      // (ADR-0011, 9). It is bound to the web's host; WebAuthn allows `localhost` without HTTPS.
      passkey({
        rpID: new URL(config.frontendOrigin).hostname,
        rpName: "HashiNet",
        origin: config.frontendOrigin,
        authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      }),
    ],
  });
}

/** The routes that add a second factor or a passkey. */
const ADDS_PROTECTION: ReadonlySet<string> = new Set([
  "/two-factor/enable",
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
]);

/** Letters and digits that can't be mistaken for one another on paper: no 0, O, 1, I or L. */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Eight recovery codes such as K7QM-2XFD (40 bits each), each working once. */
export function recoveryCodes(): string[] {
  return Array.from({ length: 8 }, () => {
    const chars = Array.from(
      { length: 8 },
      () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
    );
    return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
  });
}

/** A recovery code as typed, in the form it was issued. */
export function normalRecoveryCode(typed: string): string {
  const clean = typed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : typed.trim();
}

/** The routes whose success proves the person's protection. */
const PROVES: ReadonlySet<string> = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/passkey/verify-authentication",
  "/passkey/verify-registration",
]);

/** How long a proof lets someone change their protection without asking again. */
export const PROOF_HOURS = 2;

/** Whether the session proved the person's protection in the last 2 hours. */
export async function provedRecently(db: PrismaClient, sessionId: string): Promise<boolean> {
  const row = await db.session.findUnique({ where: { id: sessionId }, select: { provedAt: true } });
  return row?.provedAt != null && Date.now() - row.provedAt.getTime() < PROOF_HOURS * 3_600_000;
}

/** The routes that change the protection a person already has. */
const CHANGES_PROTECTION: ReadonlySet<string> = new Set([
  "/passkey/delete-passkey",
  "/two-factor/generate-backup-codes",
]);

/** Whether the person already has an authenticator app or a passkey. */
async function hasProtection(db: PrismaClient, userId: string): Promise<boolean> {
  const [user, passkeys] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } }),
    db.passkey.count({ where: { userId } }),
  ]);
  return user?.twoFactorEnabled === true || passkeys > 0;
}

/**
 * Whether a sign-in code may be created for this address: it belongs to someone with an active
 * membership, and takes one from their budget. Every address costs the same lookup.
 */
async function maySendSignInCode(db: PrismaClient, address: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { email: address },
    include: { memberships: { where: { status: "active" }, take: 1 } },
  });
  if (!user || user.memberships.length === 0) return false;
  return consumeSignInCode(db, user.id);
}

/**
 * How a session signed in, from the route that created it. An email code followed by the
 * authenticator creates its session at the authenticator's route, so an `email_code` session
 * had nothing after the code. Anything unknown counts as the weakest.
 */
export function signInMethodOf(path: string | undefined): SignInMethod {
  if (path === "/two-factor/verify-totp") return "authenticator";
  if (path === "/two-factor/verify-backup-code") return "recovery_code";
  if (path?.startsWith("/passkey/")) return "passkey";
  return "email_code";
}

const TRUST_DEVICE_COOKIE = "trust_device";

/** The request headers with any "trust this device" cookie removed. */
function withoutTrustCookie(headers: HeadersInit | null): Headers {
  const copy = new Headers(headers ?? {});
  const cookie = copy.get("cookie");
  if (cookie !== null) {
    const kept = cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => !part.split("=")[0]?.endsWith(TRUST_DEVICE_COOKIE));
    copy.set("cookie", kept.join("; "));
  }
  return copy;
}

/**
 * The two-factor plugin gates only the password-style sign-ins (`/sign-in/email` and
 * similar), and the email-code plugin knows nothing of a second factor, so on its own an
 * enrolled authenticator would never be asked for. This widens the plugin's own gate to
 * `/sign-in/email-otp` rather than reimplementing it: the gate deletes the session the code
 * created and issues the two-factor challenge. It also hides any "trust this device" cookie
 * from the gate, so no device skips the second factor; none is issued either (`hooks.before`).
 */
function withEmailCodeGate<TPlugin extends ReturnType<typeof twoFactor>>(plugin: TPlugin): TPlugin {
  const after = plugin.hooks?.after;
  const gate = after?.[0];
  if (!gate || after.length !== 1) {
    // A library upgrade changed the hook layout; refuse to start rather than sign people in
    // without their second factor.
    throw new Error("The Better Auth two-factor plugin no longer has exactly one sign-in gate");
  }
  return {
    ...plugin,
    hooks: {
      ...plugin.hooks,
      after: [
        {
          matcher: (context) => gate.matcher(context) || context.path === "/sign-in/email-otp",
          handler: async (context) =>
            gate.handler({ ...context, headers: withoutTrustCookie(context.headers ?? null) }),
        },
      ],
    },
  };
}
