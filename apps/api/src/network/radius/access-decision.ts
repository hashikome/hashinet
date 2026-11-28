import { businessHourOf } from "../../core/time/business-day.js";
import { normalMac } from "../mac.js";
import { packageCanThrottle, rateLimitFor, throttledRateLimitFor } from "../mikrotik/mikrotik.js";

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

/** A package's speeds and when it is throttled, as a query selects them. */
export const PACKAGE_SPEED_SELECT = {
  downloadSpeedMbps: true,
  uploadSpeedMbps: true,
  throttledDownloadMbps: true,
  throttledUploadMbps: true,
  peakStartHour: true,
  peakEndHour: true,
  throttleAfterGb: true,
} as const;

/** A package's speeds and when it is throttled: in its peak hours, or past its data. */
export interface PackageSpeed {
  downloadSpeedMbps: number;
  uploadSpeedMbps: number | null;
  throttledDownloadMbps: number | null;
  throttledUploadMbps: number | null;
  peakStartHour: number | null;
  peakEndHour: number | null;
  throttleAfterGb: number | null;
}

/** A voucher as an answer needs it. */
export interface VoucherFacts {
  id: string;
  expiresAt: Date | null;
  deviceLimit: number;
  /** Its data cap: no place once it is used. */
  dataLimitGb: number | null;
  /** What its sessions have used, up and down. */
  usedBytes: bigint;
  blocked: boolean;
  speed: PackageSpeed;
}

export type Answer =
  | {
      accept: true;
      voucherId: string;
      sessionSeconds: number;
      rateLimit: string | null;
      throttled: boolean;
    }
  | { accept: false; reason: string };

const GB = 1024n ** 3n;

function isPeakHour(start: number | null, end: number | null, hour: number): boolean {
  if (start === null || end === null) return false;
  if (start <= end) return hour >= start && hour < end;
  // Wraps past midnight (e.g. 22 to 06).
  return hour >= start || hour < end;
}

/** What a voucher's sessions have used, up and down, from their summed counters. */
export function bytesUsed(sum: {
  uploadBytes: bigint | null;
  downloadBytes: bigint | null;
}): bigint {
  return (sum.uploadBytes ?? 0n) + (sum.downloadBytes ?? 0n);
}

/**
 * Whether a voucher's devices go at its throttled speed now: in its package's peak hours, or once
 * it has used the data the package throttles after. One rule for RADIUS, which sets the speed, and
 * the live monitor, which ends a session whose speed no longer holds.
 */
export function throttledNow(speed: PackageSpeed, usedBytes: bigint, now: Date): boolean {
  if (!packageCanThrottle(speed)) return false;
  const overData =
    speed.throttleAfterGb !== null && usedBytes >= BigInt(speed.throttleAfterGb) * GB;
  return overData || isPeakHour(speed.peakStartHour, speed.peakEndHour, businessHourOf(now));
}

/**
 * Whether a device may be online on `voucher` now, and on what terms (ADR-0015): time left from
 * HashiNet, and its speed, throttled while its package says so. Wrong switch PINs never stop a
 * device here: they stop only moves to a new device, which the portal checks.
 */
export function terms(voucher: VoucherFacts, now: Date): Answer {
  if (voucher.blocked) return { accept: false, reason: "voucher_blocked" };
  if (voucher.expiresAt === null) return { accept: false, reason: "not_started" };
  const sessionSeconds = Math.floor((voucher.expiresAt.getTime() - now.getTime()) / 1000);
  if (sessionSeconds <= 0) return { accept: false, reason: "expired" };
  if (voucher.dataLimitGb !== null && voucher.usedBytes >= BigInt(voucher.dataLimitGb) * GB) {
    return { accept: false, reason: "data_used" };
  }
  const throttled = throttledNow(voucher.speed, voucher.usedBytes, now);
  const rateLimit = throttled ? throttledRateLimitFor(voucher.speed) : rateLimitFor(voucher.speed);
  return { accept: true, voucherId: voucher.id, sessionSeconds, rateLimit, throttled };
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
