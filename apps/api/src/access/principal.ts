import type { MembershipRole, MembershipScope } from "@hashinet/types";

/** How far a session may act (ADR-0011, 9). */
export type AccessLevel =
  /** Everything the role allows. */
  | "full"
  /** A business owner or manager getting set up in their first 7 days, before protecting their
   * sign-in: everything except making something sellable or serving. */
  | "setup"
  /** Only Account and security: protect the sign-in, or sign in with the protection there is. */
  | "account";

export type SignInMethod = "email_code" | "authenticator" | "passkey" | "recovery_code";

/** Who is calling and as what: the session's active membership. Authorization reads only this. */
export interface Principal {
  /** The Better Auth session this request belongs to. */
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  membershipId: string;
  scope: MembershipScope;
  /** Null for the platform. */
  businessId: string | null;
  role: MembershipRole;
  /** The venues of a venue manager or venue operator; null when the role reaches every venue
   * in its scope. */
  venueIds: string[] | null;
  access: AccessLevel;
}

export const SETUP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Platform staff, business owners and managers protect their sign-in; operators may opt in. */
export function mustProtect(role: MembershipRole): boolean {
  return role !== "venue_operator";
}

export interface ProtectionFacts {
  role: MembershipRole;
  /** How this session signed in; null for a session from before the column existed. */
  signedInWith: SignInMethod | null;
  /** The person has an authenticator app or a passkey. */
  personProtected: boolean;
  membershipStartedAt: Date;
  now: Date;
}

/**
 * ADR-0011, 9, judged by the session as well as the person. A session signed in with an
 * authenticator, a passkey or a recovery code may act. An email code alone may not, for a role
 * that must protect its sign-in: such a person reaches only Account and security, except a
 * business owner or manager with no protection yet, who may get set up in their first 7 days.
 */
export function accessLevel(facts: ProtectionFacts): AccessLevel {
  if (!mustProtect(facts.role)) return "full";
  if (facts.signedInWith !== null && facts.signedInWith !== "email_code") return "full";
  const settingUp =
    facts.role !== "admin" &&
    facts.role !== "manager" &&
    facts.role !== "operator" &&
    !facts.personProtected &&
    facts.now.getTime() - facts.membershipStartedAt.getTime() < SETUP_DAYS * DAY_MS;
  return settingUp ? "setup" : "account";
}
