import { paidOf } from "../billing/business-lock.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** A slot is paid once its invoice is settled in full; a granted slot (no invoice) always is. */
export function slotPaid(slot: {
  invoice: { totalTsh: number; allocations: { amountTsh: number }[] } | null;
}): boolean {
  if (slot.invoice === null) return true;
  return paidOf(slot.invoice) >= slot.invoice.totalTsh;
}

export const SLOT_SELECT = {
  id: true,
  createdAt: true,
  invoiceId: true,
  invoice: {
    select: {
      number: true,
      totalTsh: true,
      allocations: { select: { amountTsh: true } },
    },
  },
} as const satisfies Prisma.SiteSlotSelect;

/**
 * Which of a venue's sites are open before paying: the first comes with the venue, and each paid
 * slot opens one more, in the order they were added. The rest wait for payment, and never reach a
 * router. The one rule for the venue's page, its routers and provisioning.
 */
export async function openSites(db: Db, venueId: string) {
  const [sites, slots] = await Promise.all([
    db.venueSite.findMany({
      where: { venueId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { addedBy: { select: { user: { select: { name: true } } } } },
    }),
    db.siteSlot.findMany({
      where: { venueId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: SLOT_SELECT,
    }),
  ]);
  const paid = slots.filter(slotPaid).length;
  return { sites, slots, openCount: Math.min(sites.length, 1 + paid) };
}

/** The host names a venue's routers let guests open before paying. */
export async function openHosts(db: Db, venueId: string): Promise<string[]> {
  const { sites, openCount } = await openSites(db, venueId);
  return sites.slice(0, openCount).map((s) => s.host);
}
