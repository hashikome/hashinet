import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

/**
 * Whether a business's owner has protected their sign-in, with an authenticator or a passkey.
 * Until they have, none of its venues serves guests (ADR-0011, 9).
 */
export async function ownerProtected(
  db: PrismaClient | Prisma.TransactionClient,
  businessId: string,
): Promise<boolean> {
  const owner = await db.membership.findFirst({
    where: { businessId, role: "owner", status: "active" },
    select: {
      user: { select: { twoFactorEnabled: true, _count: { select: { passkeys: true } } } },
    },
  });
  return Boolean(owner && (owner.user.twoFactorEnabled === true || owner.user._count.passkeys > 0));
}
