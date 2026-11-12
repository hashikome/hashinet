import type { PrismaClient } from "../database/client.js";
import type { MembershipRole } from "../generated/prisma/enums.js";

/** Highest authority first: the platform before a business, then down each ladder (ADR-0011, 7). */
const AUTHORITY: Record<MembershipRole, number> = {
  admin: 0,
  manager: 1,
  operator: 2,
  owner: 3,
  business_manager: 4,
  venue_manager: 5,
  venue_operator: 6,
};

/**
 * The membership a session acts as. The one it already holds, while still active; otherwise
 * the person's last-used active membership, or their highest-authority one, which is then
 * stored on the session. Null when the person has no active membership: they cannot sign in.
 */
export async function resolveMembership(
  db: PrismaClient,
  session: { id: string; userId: string; activeMembershipId: string | null },
) {
  const memberships = await db.membership.findMany({
    where: { userId: session.userId, status: "active" },
    include: { venues: { select: { venueId: true } } },
  });
  const current = memberships.find((m) => m.id === session.activeMembershipId);
  if (current) return current;
  const chosen =
    [...memberships].sort(
      (a, b) =>
        (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0) ||
        AUTHORITY[a.role] - AUTHORITY[b.role],
    )[0] ?? null;
  if (chosen) {
    await db.$transaction([
      db.session.update({ where: { id: session.id }, data: { activeMembershipId: chosen.id } }),
      db.membership.update({ where: { id: chosen.id }, data: { lastUsedAt: new Date() } }),
    ]);
  }
  return chosen;
}
