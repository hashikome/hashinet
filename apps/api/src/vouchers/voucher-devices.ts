import type { Prisma } from "../generated/prisma/client.js";

/** How many of a voucher's devices may be online at once, across its venue's routers (ADR-0015). */
export function deviceLimitOf(pkg: { deviceLimit: number } | null): number {
  return pkg?.deviceLimit ?? 1;
}

/**
 * Takes devices off a voucher by their addresses, which name a device whatever its row: a device
 * taken off signs in again at the portal, or the router would let it back by its address.
 */
export function takeDevicesOff(
  db: Pick<Prisma.TransactionClient, "voucherDevice">,
  voucherId: string,
  macs: string[],
): Promise<Prisma.BatchPayload> {
  return db.voucherDevice.deleteMany({
    where: { voucherId, device: { macAddress: { in: macs } } },
  });
}
