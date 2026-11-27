import type { PortalLook } from "@hashinet/types";
import type { Prisma } from "../generated/prisma/client.js";
import { contentOf, HASHINET_COLOURS, HASHINET_PORTAL, lookOf } from "./portal-input.js";

type Tx = Prisma.TransactionClient;

/**
 * The portal is a template copied down (ADR-0009): the platform's starts a new business's, a
 * business's starts each new venue's. A later change to one never reaches what was copied from it.
 */

/** What a new business starts with: the platform's content in the default theme's colours. */
export async function platformLook(tx: Tx): Promise<PortalLook> {
  const [settings, theme] = await Promise.all([
    tx.portalSetting.findFirst(),
    tx.portalTheme.findFirst({ where: { isDefault: true } }),
  ]);
  return {
    ...(settings ? contentOf(settings) : HASHINET_PORTAL),
    ...(theme ? { pageColor: theme.pageColor, buttonColor: theme.buttonColor } : HASHINET_COLOURS),
  };
}

/** A new business's template, from the platform's. */
export async function copyToBusiness(tx: Tx, businessId: string): Promise<void> {
  await tx.businessPortal.create({ data: { businessId, ...(await platformLook(tx)) } });
}

/** A new venue's portal, from its business's template. */
export async function copyToVenue(tx: Tx, venueId: string, businessId: string): Promise<void> {
  const template = await tx.businessPortal.findUnique({ where: { businessId } });
  const look = template ? lookOf(template) : await platformLook(tx);
  await tx.venuePortal.create({ data: { venueId, ...look } });
}
