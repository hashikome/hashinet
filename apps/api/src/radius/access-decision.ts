import { rateLimitFor, throttledRateLimitFor } from "../services/mikrotik.js";

/** What an Access-Request asks: a code the API admitted, or a device coming back by its address. */
export type AccessAsk =
  | { kind: "code"; code: string; mac: string }
  | { kind: "mac"; mac: string }
  | { kind: "unknown" };

/** How a request names itself: a MAC login's user is the calling station; anything else is a code. */
export function askOf(
  userName: string | null,
  callingStation: string | null,
  pap: string | null,
): AccessAsk {
  const mac = normalMac(callingStation);
  if (userName === null || mac === null) return { kind: "unknown" };
  if (normalMac(userName) === mac) return { kind: "mac", mac };
  // The API signs a device in with the code as user and password; a login typed on the router's own
  // page never reaches here (no http login method), so a mismatch is refused.
  if (pap === null || pap !== userName) return { kind: "unknown" };
  return { kind: "code", code: userName.toUpperCase(), mac };
}

/** "52:54:00:4a:00:10" or "52-54-00-4A-00-10" as HashiNet keeps it, or null. */
export function normalMac(value: string | null): string | null {
  if (value === null) return null;
  const hex = value.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)?.join(":") ?? null;
}

/** A voucher as an answer needs it. */
export interface VoucherFacts {
  id: string;
  expiresAt: Date | null;
  deviceLimit: number;
  dataLimitGb: number | null;
  dataUsedBytes: bigint;
  pinLocked: boolean;
  speed: {
    downloadSpeedMbps: number;
    uploadSpeedMbps: number | null;
    throttledDownloadMbps: number | null;
    throttledUploadMbps: number | null;
  };
}

export type Answer =
  | { accept: true; voucherId: string; sessionSeconds: number; rateLimit: string | null }
  | { accept: false; reason: string };

const GB = 1024n ** 3n;

/**
 * Whether a device may be online on `voucher` now, and on what terms (ADR-0015): time left from
 * HashiNet, and its speed, throttled once its data is used.
 */
export function terms(voucher: VoucherFacts, now: Date): Answer {
  if (voucher.pinLocked) return { accept: false, reason: "voucher_locked" };
  if (voucher.expiresAt === null) return { accept: false, reason: "not_started" };
  const sessionSeconds = Math.floor((voucher.expiresAt.getTime() - now.getTime()) / 1000);
  if (sessionSeconds <= 0) return { accept: false, reason: "expired" };
  const usedUp =
    voucher.dataLimitGb !== null && voucher.dataUsedBytes >= BigInt(voucher.dataLimitGb) * GB;
  const rateLimit = usedUp ? throttledRateLimitFor(voucher.speed) : rateLimitFor(voucher.speed);
  if (usedUp && rateLimit === null) return { accept: false, reason: "data_used" };
  return { accept: true, voucherId: voucher.id, sessionSeconds, rateLimit };
}

/**
 * A device coming back by its address: it may take a place on a voucher it used before only if it
 * already holds one (its own session, still listed) or one is plainly free. Otherwise it lands on
 * the portal, where the API checks who holds the place and asks for the switch PIN.
 */
export function comesBack(
  voucher: VoucherFacts,
  online: { mac: string }[],
  mac: string,
  now: Date,
): Answer {
  const holds = online.some((s) => s.mac === mac);
  if (!holds && online.length >= voucher.deviceLimit) return { accept: false, reason: "in_use" };
  return terms(voucher, now);
}
