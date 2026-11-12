import type { Auth } from "../auth/create-auth.js";
import type { PrismaClient } from "../database/client.js";
import { accessLevel, type Principal, type SignInMethod } from "./principal.js";
import { resolveMembership } from "./resolve-membership.js";

/**
 * The principal for a request's session, or null when there is no session or the person has no
 * active membership. One rule for every way in: the HTTP guard and the live view's websocket.
 */
export async function principalFromSession(
  db: PrismaClient,
  auth: Auth,
  headers: Headers,
): Promise<Principal | null> {
  const found = await auth.api.getSession({ headers });
  if (!found) return null;
  const session = await db.session.findUnique({ where: { id: found.session.id } });
  if (!session) return null;
  const membership = await resolveMembership(db, session);
  if (!membership) return null;
  const passkeys = await db.passkey.count({ where: { userId: session.userId } });
  return {
    sessionId: session.id,
    userId: session.userId,
    email: found.user.email,
    name: found.user.name,
    membershipId: membership.id,
    scope: membership.scope,
    businessId: membership.businessId,
    role: membership.role,
    venueIds:
      membership.role === "venue_manager" || membership.role === "venue_operator"
        ? membership.venues.map((v) => v.venueId)
        : null,
    access: accessLevel({
      role: membership.role,
      signedInWith: (session.signedInWith as SignInMethod | null) ?? null,
      personProtected: found.user.twoFactorEnabled === true || passkeys > 0,
      membershipStartedAt: membership.createdAt,
      now: new Date(),
    }),
  };
}
