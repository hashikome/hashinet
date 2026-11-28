import type { MembershipRole } from "@hashinet/types";

/** A role's rank inside its scope: higher outranks lower (ADR-0011, 6 and 11). */
const RANK: Record<MembershipRole, number> = {
  admin: 3,
  manager: 2,
  operator: 1,
  owner: 4,
  business_manager: 3,
  venue_manager: 2,
  venue_operator: 1,
};

const SCOPE_ROLES = {
  platform: ["admin", "manager", "operator"],
  business: ["owner", "business_manager", "venue_manager", "venue_operator"],
} as const satisfies Record<string, readonly MembershipRole[]>;

/** Whether `a` outranks `b`, in the same scope. */
export const outranks = (a: MembershipRole, b: MembershipRole) => RANK[a] > RANK[b];

/**
 * The roles someone may invite, give or take away: only those below their own, in their own scope.
 * Nobody gives more than they have (ADR-0011, 6).
 */
export function assignableRoles(role: MembershipRole): MembershipRole[] {
  const scope = (SCOPE_ROLES.platform as readonly MembershipRole[]).includes(role)
    ? "platform"
    : "business";
  return SCOPE_ROLES[scope].filter((r) => outranks(role, r));
}
