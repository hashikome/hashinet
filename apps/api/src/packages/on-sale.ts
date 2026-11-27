import type { Package, Prisma, PrismaClient } from "../generated/prisma/client.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** One of a venue's packages, as the venue has it. */
export interface VenuePackage {
  /** As the business has it, at the business's price. */
  package: Package;
  /** What the venue charges: its own price where it set one. */
  priceTsh: Prisma.Decimal;
  /** The venue's own price for a business package; null while it follows the business's. */
  ownPriceTsh: Prisma.Decimal | null;
  onSale: boolean;
  /** The venue's own package, sold only there. */
  own: boolean;
}

/**
 * A venue's packages (ADR-0011, 4): its business's active ones, each on sale unless the venue
 * stopped selling it, at the venue's own price where it set one; and its own. Never another
 * business's or another venue's own. Cheapest first. Null when the venue doesn't exist. The one
 * rule for Sell, the portal, onboarding and Packages.
 */
export async function venueCatalogue(db: Db, venueId: string): Promise<VenuePackage[] | null> {
  const venue = await db.venue.findUnique({ where: { id: venueId }, select: { businessId: true } });
  if (!venue) return null;
  const rows = await db.package.findMany({
    where: { businessId: venue.businessId, isActive: true, OR: [{ venueId: null }, { venueId }] },
    include: { venues: { where: { venueId } } },
    orderBy: { createdAt: "asc" },
  });
  return rows
    .map(({ venues, ...p }) => {
      const set = venues[0] ?? null;
      return {
        package: p,
        priceTsh: set?.priceTsh ?? p.priceTsh,
        ownPriceTsh: set?.priceTsh ?? null,
        onSale: p.venueId === venueId || set?.onSale !== false,
        own: p.venueId === venueId,
      };
    })
    .sort((a, b) => Number(a.priceTsh) - Number(b.priceTsh));
}

/** What a venue sells, at its prices, cheapest first; null when the venue doesn't exist. */
export async function onSalePackages(db: Db, venueId: string): Promise<Package[] | null> {
  const all = await venueCatalogue(db, venueId);
  return all === null
    ? null
    : all.filter((p) => p.onSale).map((p) => ({ ...p.package, priceTsh: p.priceTsh }));
}
