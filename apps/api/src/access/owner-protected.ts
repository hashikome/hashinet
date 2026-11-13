import { hasProtection } from "../auth/create-auth.js";
import type { PrismaClient } from "../generated/prisma/client.js";

/**
 * Whether a business's owner has protected their sign-in (`hasProtection`: an authenticator or a
 * passkey). Until they have, none of its venues serves guests (ADR-0011, 9).
 */
export async function ownerProtected(
  db: Pick<PrismaClient, "membership" | "user" | "passkey">,
  businessId: string,
): Promise<boolean> {
  const owner = await db.membership.findFirst({
    where: { businessId, role: "owner", status: "active" },
    select: { userId: true },
  });
  return owner !== null && (await hasProtection(db, owner.userId));
}
