import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

/**
 * The rule for what a venue sells: its business's active packages, narrowed to the ones assigned
 * to it when there are any. Never another business's. Null when the venue doesn't exist.
 */
export async function onSaleWhere(
  db: Pick<PrismaClient, "venue" | "venuePackage">,
  venueId: string,
): Promise<Prisma.PackageWhereInput | null> {
  const venue = await db.venue.findUnique({ where: { id: venueId } });
  if (!venue) return null;
  const assigned = await db.venuePackage.findMany({
    where: { venueId },
    select: { packageId: true },
  });
  const ids = assigned.map((a) => a.packageId);
  return {
    businessId: venue.businessId,
    isActive: true,
    ...(ids.length === 0 ? {} : { id: { in: ids } }),
  };
}
