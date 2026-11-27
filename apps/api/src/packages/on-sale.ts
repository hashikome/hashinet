import type { Package, Prisma, PrismaClient } from "../generated/prisma/client.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * What a venue sells (ADR-0011, 4): its business's active packages it hasn't stopped selling, at
 * its own price where it set one, and its own packages. Never another business's or another
 * venue's own. Each comes back at the price the venue charges, cheapest first. Null when the venue
 * doesn't exist. The one rule for Sell, the portal and onboarding.
 */
export async function onSalePackages(db: Db, venueId: string): Promise<Package[] | null> {
  const venue = await db.venue.findUnique({ where: { id: venueId }, select: { businessId: true } });
  if (!venue) return null;
  const rows = await db.package.findMany({
    where: {
      businessId: venue.businessId,
      isActive: true,
      OR: [{ venueId: null }, { venueId }],
    },
    include: { venues: { where: { venueId } } },
    orderBy: { createdAt: "asc" },
  });
  return rows
    .filter((p) => p.venueId === venueId || p.venues[0]?.onSale !== false)
    .map(({ venues, ...p }) => ({ ...p, priceTsh: venues[0]?.priceTsh ?? p.priceTsh }))
    .sort((a, b) => Number(a.priceTsh) - Number(b.priceTsh));
}
