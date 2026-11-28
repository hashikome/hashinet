import type { Prisma } from "../../generated/prisma/client.js";

/**
 * Holds a business's row until the transaction ends: one change at a time to its charges, ways to
 * pay and service access, as a payment holds it. False when there is no such business.
 */
export async function lockBusiness(
  tx: Prisma.TransactionClient,
  businessId: string,
): Promise<boolean> {
  const [locked] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
  return locked !== undefined;
}

/** What has been paid towards an invoice: the sum of its allocations. */
export const paidOf = (invoice: { allocations: { amountTsh: number }[] }) =>
  invoice.allocations.reduce((sum, a) => sum + a.amountTsh, 0);
