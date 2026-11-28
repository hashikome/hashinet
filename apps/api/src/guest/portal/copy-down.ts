import type { PortalLook } from "@hashinet/types";
import type {
  BusinessPortal,
  Prisma,
  PrismaClient,
  VenuePortal,
} from "../../generated/prisma/client.js";
import { contentOf, HASHINET_COLOURS, HASHINET_PORTAL, lookOf } from "./portal-input.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The portal is a template copied down (ADR-0009): the platform's starts a new business's, a
 * business's starts each new venue's. A later change to one never reaches what was copied from it.
 * Every business and venue gets its copy when it is created; a row found missing (a business or
 * venue made outside the services) is copied then, exactly as its creation would have.
 */

/** What a new business starts with: the platform's content in the default theme's colours. */
export async function platformLook(db: Db): Promise<PortalLook> {
  const [settings, theme] = await Promise.all([
    db.portalSetting.findFirst(),
    db.portalTheme.findFirst({ where: { isDefault: true } }),
  ]);
  return {
    ...(settings ? contentOf(settings) : HASHINET_PORTAL),
    ...(theme ? { pageColor: theme.pageColor, buttonColor: theme.buttonColor } : HASHINET_COLOURS),
  };
}

/** A new business's template, from the platform's. */
export async function copyToBusiness(db: Db, businessId: string): Promise<BusinessPortal> {
  return db.businessPortal.create({ data: { businessId, ...(await platformLook(db)) } });
}

/** A business's template: what its new venues start with. */
export async function templateOf(db: Db, businessId: string): Promise<BusinessPortal> {
  return (
    (await db.businessPortal.findUnique({ where: { businessId } })) ??
    copyToBusiness(db, businessId)
  );
}

/**
 * A new venue's portal, from its business's template; a business's second venue starts as its
 * first looks, since with one venue the business is that venue (owner, 28 November 2026).
 */
export async function copyToVenue(
  db: Db,
  venueId: string,
  businessId: string,
): Promise<VenuePortal> {
  const others = await db.venue.findMany({
    where: { businessId, id: { not: venueId } },
    select: { portal: true },
    take: 2,
  });
  const only = others.length === 1 ? (others[0]?.portal ?? null) : null;
  const look = lookOf(only ?? (await templateOf(db, businessId)));
  return db.venuePortal.create({ data: { venueId, ...look } });
}

/** A venue's portal. */
export async function portalOf(db: Db, venueId: string, businessId: string): Promise<VenuePortal> {
  return (
    (await db.venuePortal.findUnique({ where: { venueId } })) ??
    copyToVenue(db, venueId, businessId)
  );
}
