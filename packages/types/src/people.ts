import type { Region, Timestamp } from "./core.ts";
import type { AccessLevel, SellingPause } from "./platform.ts";

/** One of the person's memberships, for the account menu's workspaces. */
export interface MembershipSummary {
  id: string;
  scope: MembershipScope;
  role: MembershipRole;
  /** Null for the platform. Its logo heads the admin for its people; null shows its initial. */
  business: { id: string; name: string; logoUrl: string | null } | null;
}

/** How the dashboard looks; `system` follows the device. */
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/**
 * The signed-in person (`GET /api/me`). The web draws navigation and buttons from `capabilities`,
 * never from the role.
 */
export interface Me {
  id: string;
  email: string;
  name: string;
  /** Kept per person, so it follows them in every workspace and on every device. */
  theme: ThemePreference;
  memberships: MembershipSummary[];
  active: MembershipSummary & {
    /** The venues of a venue manager or operator; null when the role reaches every venue. */
    venueIds: string[] | null;
    access: AccessLevel;
    capabilities: string[];
    /** Why its business can't sell, while it is read-only or suspended (ADR-0014, 2): an overdue
     * bill, or held so by HashiNet's team; null while it sells. Selling and package actions then
     * stay in view, paused, and say why. */
    pause: SellingPause | null;
  };
  protection: {
    /** Platform staff, owners and managers must protect their sign-in. */
    required: boolean;
    authenticator: boolean;
    passkeys: number;
    /** While `access` is `setup`: when the 7 days to get set up without protection end. */
    setupEndsAt: Timestamp | null;
    /** Until when this session's proof holds for the 2-hour changes; null when it has none. */
    provedUntil: Timestamp | null;
    /** For each change to protection: whether it asks for proof first now, and what it accepts. */
    proof: Record<ProofAction, ProofRule>;
  };
}

/** One of the signed-in person's passkeys, as Account › Sign-in lists it. */
export interface MyPasskey {
  id: string;
  name: string | null;
  /** The WebAuthn credential, so "Try it" can ask the device for this passkey alone. */
  credentialId: string;
  createdAt: Timestamp | null;
  /** When it last signed in or confirmed a change; null if never. */
  lastUsedAt: Timestamp | null;
}

/** The factors that prove a session is the person's own. */
export type ProofFactor = "passkey" | "authenticator" | "recovery_code";

/** The changes to protection that ask for proof first (ADR-0011, 9). */
export type ProofAction =
  | "add"
  | "removePasskey"
  | "newRecoveryCodes"
  | "replaceAuthenticator"
  | "removeAuthenticator";

export interface ProofRule {
  /** Whether the session must prove itself before this change, now. */
  needed: boolean;
  /** The factors this change accepts, strongest first. */
  accepts: ProofFactor[];
  /** How long a proof counts for it: 2 hours, or a few minutes for the ones asked each time. */
  holdsMinutes: number;
}

/** How long proving it's you lets someone change their sign-in without asking again. */
export const PROOF_HOURS = 2;

/** Where a membership acts, and its role there (ADR-0011). */
export type MembershipScope = "platform" | "business";
export type PlatformRole = "admin" | "manager" | "operator";
export type BusinessRole = "owner" | "business_manager" | "venue_manager" | "venue_operator";
export type MembershipRole = PlatformRole | BusinessRole;
/** Every role someone can be invited to; a business's owner comes only with the business. */
export const INVITED_ROLES = [
  "manager",
  "operator",
  "business_manager",
  "venue_manager",
  "venue_operator",
] as const satisfies readonly MembershipRole[];
/** Roles that work at chosen venues of their business, not all of them. */
export const VENUE_ROLES = [
  "venue_manager",
  "venue_operator",
] as const satisfies readonly BusinessRole[];

/** A pending invitation, as the platform's Businesses page lists it. */
export interface InvitationRecord {
  id: string;
  email: string;
  scope: MembershipScope;
  role: MembershipRole;
  /** Null for a new business's owner and for a platform role. */
  businessId: string | null;
  /** The venues a venue manager or venue operator is invited to; empty for every other role. */
  venueIds: string[];
  invitedBy: string | null;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

export interface InvitationList {
  invitations: InvitationRecord[];
}

/** What the invitation page shows before anything is entered: never a business or a person. */
export interface InvitationPreview {
  email: string;
  /** Starting a new business, joining HashiNet's team, or joining a business's team, in `role`. */
  kind: "business_owner" | "platform_member" | "business_member";
  /** For a member: the role offered. */
  role: MembershipRole | null;
  /** For a business member: the business they join. */
  businessName: string | null;
  expiresAt: Timestamp;
}

/** One person on a team, as its Team page lists them. */
export interface TeamMember {
  membershipId: string;
  name: string;
  email: string;
  role: MembershipRole;
  /** The venues of a venue manager or venue operator; empty for a role over every venue. */
  venueIds: string[];
  joinedAt: Timestamp;
  /** When they last worked in this workspace; null if never yet. */
  lastUsedAt: Timestamp | null;
  /** Whether the reader may change their role or remove them (by rank, ADR-0011, 6). */
  manageable: boolean;
}

/** `GET /api/team`: the reader's team and its pending invitations. */
export interface TeamList {
  members: TeamMember[];
  invitations: InvitationRecord[];
  /** The roles the reader may invite, give or take away. */
  assignable: MembershipRole[];
}

/** Accepting an invitation to start a business: three steps, saved only at the last. */
export interface AcceptBusinessInvitation {
  token: string;
  person: { name: string; phone: string };
  business: { name: string; region: Region; area: string };
  venue: { name: string; region: Region; area: string };
}

/** After accepting, the person signs in with a code like everyone; nothing signs them in here. */
export interface AcceptedInvitation {
  email: string;
  /** The new business, for an owner; null for HashiNet's team. */
  businessId: string | null;
}
