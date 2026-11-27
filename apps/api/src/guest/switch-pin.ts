import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/** Wrong PINs in a row that make a voucher wait, and that lock it until staff release it. */
export const PIN_WAIT_AFTER = 5;
export const PIN_LOCK_AFTER = 10;
export const PIN_WAIT_MINUTES = 15;

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
  const given = Buffer.from(pinHmac(key, voucherId, pin), "hex");
  const kept = Buffer.from(stored, "hex");
  return given.length === kept.length && timingSafeEqual(given, kept);
}

/** After a wrong PIN: the count, and a wait or a lock when it reaches one. */
export function afterWrongPin(
  tries: number,
  now: Date,
): {
  pinWrongTries: number;
  pinWaitUntil: Date | null;
  pinLockedAt: Date | null;
} {
  const count = Math.min(tries + 1, PIN_LOCK_AFTER);
  return {
    pinWrongTries: count,
    pinWaitUntil:
      count === PIN_WAIT_AFTER ? new Date(now.getTime() + PIN_WAIT_MINUTES * 60_000) : null,
    pinLockedAt: count >= PIN_LOCK_AFTER ? now : null,
  };
}
