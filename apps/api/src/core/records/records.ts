import type { PackageRecord, SessionRecord, VoucherRecord } from "@hashinet/types";
import type { Package, Voucher, WifiSession } from "../../generated/prisma/client.js";

/**
 * Database rows as API records (`@hashinet/types`), and the conventions every record follows:
 * decimals as strings, timestamps as ISO 8601 UTC, byte counters as numbers. Each function returns
 * the full record type, so a field added to either side fails the typecheck until it is mapped.
 * An area whose record needs its own rules maps it beside them (`router-record.ts`,
 * `venue-record.ts`, `invoice-record.ts`) with these helpers.
 */

export const iso = (date: Date): string => date.toISOString();
export const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);

/** Byte counters fit in a JavaScript number far beyond any voucher (2^53 bytes is 8 PB). */
export function bytes(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Byte counter exceeds 2^53");
  return Number(value);
}

export function packageRecord(row: Package): PackageRecord {
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    description: row.description,
    durationMinutes: row.durationMinutes,
    downloadSpeedMbps: row.downloadSpeedMbps,
    uploadSpeedMbps: row.uploadSpeedMbps,
    dataLimitGb: row.dataLimitGb,
    deviceLimit: row.deviceLimit,
    priceTsh: row.priceTsh.toFixed(2),
    features: row.features,
    isActive: row.isActive,
    throttledDownloadMbps: row.throttledDownloadMbps,
    throttledUploadMbps: row.throttledUploadMbps,
    peakStartHour: row.peakStartHour,
    peakEndHour: row.peakEndHour,
    throttleAfterGb: row.throttleAfterGb,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function voucherRecord(row: Voucher): VoucherRecord {
  return {
    id: row.id,
    packageId: row.packageId,
    venueId: row.venueId,
    redeemedByDeviceId: row.redeemedByDeviceId,
    code: row.code,
    status: row.status,
    dataLimitGb: row.dataLimitGb,
    dataUsedBytes: bytes(row.dataUsedBytes),
    durationMinutes: row.durationMinutes,
    priceTsh: row.priceTsh.toFixed(2),
    activatedAt: isoOrNull(row.activatedAt),
    expiresAt: isoOrNull(row.expiresAt),
    refundedAt: isoOrNull(row.refundedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function sessionRecord(
  row: WifiSession & {
    voucher: { code: string; expiresAt: Date | null } | null;
    package: { name: string } | null;
    venue: { name: string } | null;
    router: { name: string } | null;
  },
): SessionRecord {
  return {
    id: row.id,
    status: row.status,
    deviceId: row.deviceId,
    macAddress: row.macAddress,
    ipAddress: row.ipAddress,
    deviceName: row.deviceName,
    deviceType: row.deviceType,
    voucherId: row.voucherId,
    voucherCode: row.voucher?.code ?? null,
    voucherExpiresAt: isoOrNull(row.voucher?.expiresAt ?? null),
    packageId: row.packageId,
    packageName: row.package?.name ?? null,
    venueId: row.venueId,
    venueName: row.venue?.name ?? null,
    routerId: row.routerId,
    routerName: row.router?.name ?? null,
    startedAt: iso(row.startedAt),
    endedAt: isoOrNull(row.endedAt),
    durationSeconds: row.durationSeconds,
    uploadBytes: bytes(row.uploadBytes),
    downloadBytes: bytes(row.downloadBytes),
    uploadSpeedMbps: row.uploadSpeedMbps?.toFixed(2) ?? null,
    downloadSpeedMbps: row.downloadSpeedMbps?.toFixed(2) ?? null,
    signalStrengthDbm: row.signalStrengthDbm,
    isThrottled: row.isThrottled,
    terminationReason: row.terminationReason,
  };
}
