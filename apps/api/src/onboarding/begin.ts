import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { openIssue, PLATFORM_WORKSPACE } from "../issues/issues.service.js";

export const packageKey = (venueId: string) => `venue-package:${venueId}`;
export const setupKey = (venueId: string) => `venue-setup:${venueId}`;

/**
 * A new venue starts at its package (ADR-0013, 2), in the transaction that creates it: the one
 * way a venue begins, wherever it is created, the seed included.
 */
export async function beginOnboarding(
  db: Prisma.TransactionClient | PrismaClient,
  venueId: string,
): Promise<void> {
  await db.venueOnboarding.create({ data: { venueId } });
  await openIssue(db, {
    ...PLATFORM_WORKSPACE,
    kind: "venue_package",
    key: packageKey(venueId),
    venueId,
    routerId: null,
    holderId: null,
  });
}
