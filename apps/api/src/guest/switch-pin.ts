import { createHmac, randomInt } from "node:crypto";
import { sameBytes } from "../crypto/same-bytes.js";

/**
 * A device's wrong PINs in a row on a voucher that make it wait, and that lock it out of moving the
 * voucher until a release (ADR-0015, 4). Other devices, and those holding a place, go on.
 */
const PIN_WAIT_AFTER = 3;
const PIN_LOCK_AFTER = 6;
const PIN_WAIT_MS = 15 * 60_000;
/**
 * A voucher's wrong PINs from any devices within the hour that make every move to it wait: a MAC
 * address costs nothing to change, so the per-device count alone doesn't limit guessing.
 */
const VOUCHER_WRONG_PINS = 15;
const VOUCHER_WRONG_PIN_WINDOW_MS = 3_600_000;

/** What a release clears from a voucher: its PIN, and the count of wrong ones from any device. */
export const PIN_RELEASED = {
  pinHmac: null,
  wrongPins: 0,
  wrongPinsSince: null,
  pinWaitUntil: null,
} as const;

/**
 * Whether a device needs the switch PIN to take a place on the voucher: one in use whose PIN is
 * set, for a device new to it, or a known one whose places all hold devices still there.
 */
export function needsPin(
  voucher: { status: string; pinHmac: string | null },
  known: boolean,
  full: boolean,
): boolean {
  return voucher.status !== "unused" && voucher.pinHmac !== null && (!known || full);
}

/** All one digit, a straight run either way, or one pair twice: what someone would try first. */
export function obviousPin(pin: string): boolean {
  const d = [...pin].map(Number);
  const step = (d[1] ?? 0) - (d[0] ?? 0);
  const run =
    (step === 1 || step === -1 || step === 0) &&
    d.every((x, i) => i === 0 || x - (d[i - 1] ?? 0) === step);
  return run || (pin[0] === pin[2] && pin[1] === pin[3]);
}

/** A switch PIN: four random digits from a secure generator, never an obvious one (ADR-0015, 4). */
export function makePin(): string {
  for (;;) {
    const pin = String(randomInt(0, 10_000)).padStart(4, "0");
    if (!obviousPin(pin)) return pin;
  }
}

/** What is stored: an HMAC under the PIN key, bound to the voucher, so a copied row reveals nothing. */
export function pinHmac(key: Buffer, voucherId: string, pin: string): string {
  return createHmac("sha256", key).update(`${voucherId}:${pin}`).digest("hex");
}

export function pinMatches(key: Buffer, voucherId: string, pin: string, stored: string): boolean {
  return sameBytes(Buffer.from(pinHmac(key, voucherId, pin), "hex"), Buffer.from(stored, "hex"));
}

/** After a device's wrong PIN: its count, and a wait or a lock when it reaches one. */
export function afterWrongPin(
  tries: number,
  now: Date,
): { wrongTries: number; waitUntil: Date | null; lockedAt: Date | null } {
  const count = Math.min(tries + 1, PIN_LOCK_AFTER);
  return {
    wrongTries: count,
    waitUntil: count === PIN_WAIT_AFTER ? new Date(now.getTime() + PIN_WAIT_MS) : null,
    lockedAt: count >= PIN_LOCK_AFTER ? now : null,
  };
}

/**
 * After a wrong PIN from any device, the voucher's count: from the first in the hour, starting
 * again once that is over an hour old. The fifteenth, and each after it within the hour, makes
 * every move wait 15 minutes; a right PIN doesn't take any back.
 */
export function afterVoucherWrongPin(
  voucher: { wrongPins: number; wrongPinsSince: Date | null },
  now: Date,
): { wrongPins: number; wrongPinsSince: Date; pinWaitUntil: Date | null } {
  const since = voucher.wrongPinsSince;
  const counting = since !== null && now.getTime() - since.getTime() <= VOUCHER_WRONG_PIN_WINDOW_MS;
  const count = Math.min((counting ? voucher.wrongPins : 0) + 1, VOUCHER_WRONG_PINS);
  return {
    wrongPins: count,
    wrongPinsSince: counting ? since : now,
    pinWaitUntil: count >= VOUCHER_WRONG_PINS ? new Date(now.getTime() + PIN_WAIT_MS) : null,
  };
}
