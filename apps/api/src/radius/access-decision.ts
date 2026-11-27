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
  pinLocked: boolean;
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

export function isPeakHour(start: number | null, end: number | null, eatHour: number): boolean {
  if (start === null || end === null) return false;
  if (start <= end) return eatHour >= start && eatHour < end;
  // Wraps past midnight (e.g. 22 to 06).
  return eatHour >= start || eatHour < end;
}

/** Tanzania is UTC+3 all year (no daylight saving). */
export function eatHourOf(date: Date): number {
  return (date.getUTCHours() + 3) % 24;
}

/**
 * Whether a voucher's devices go at its throttled speed now: in its package's peak hours, or once
 * it has used the data the package throttles after. One rule for RADIUS, which sets the speed, and
 * the live monitor, which ends a session whose speed no longer holds.
 */
export function throttledNow(speed: PackageSpeed, usedBytes: bigint, now: Date): boolean {
  if (speed.throttledDownloadMbps === null || speed.throttledDownloadMbps <= 0) return false;
  const overData =
    speed.throttleAfterGb !== null && usedBytes >= BigInt(speed.throttleAfterGb) * GB;
  return overData || isPeakHour(speed.peakStartHour, speed.peakEndHour, eatHourOf(now));
}

/**
 * Whether a device may be online on `voucher` now, and on what terms (ADR-0015): time left from
 * HashiNet, and its speed, throttled while its package says so.
 */
export function terms(voucher: VoucherFacts, now: Date): Answer {
  if (voucher.blocked) return { accept: false, reason: "voucher_blocked" };
  if (voucher.pinLocked) return { accept: false, reason: "voucher_locked" };
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
