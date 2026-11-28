import { describe, expect, test } from "bun:test";
import {
  afterVoucherWrongPin,
  afterWrongPin,
  makePin,
  needsPin,
  obviousPin,
  pinHmac,
  pinMatches,
} from "./switch-pin.js";

const KEY = Buffer.alloc(32, 7);

describe("the switch PIN", () => {
  test("four digits, never an obvious one", () => {
    for (const pin of ["0000", "7777", "1234", "6789", "9876", "4321", "1212", "0909"]) {
      expect(obviousPin(pin)).toBe(true);
    }
    for (const pin of ["1942", "0517", "8306"]) expect(obviousPin(pin)).toBe(false);
    for (let i = 0; i < 200; i++) {
      const pin = makePin();
      expect(pin).toMatch(/^\d{4}$/);
      expect(obviousPin(pin)).toBe(false);
    }
  });

  test("kept only as an HMAC bound to its voucher", () => {
    const stored = pinHmac(KEY, "v1", "1942");
    expect(stored).toHaveLength(64);
    expect(stored).not.toContain("1942");
    expect(pinMatches(KEY, "v1", "1942", stored)).toBe(true);
    expect(pinMatches(KEY, "v1", "1943", stored)).toBe(false);
    expect(pinMatches(KEY, "v2", "1942", stored)).toBe(false);
    expect(pinMatches(Buffer.alloc(32, 8), "v1", "1942", stored)).toBe(false);
  });

  test("a device's third wrong PIN waits 15 minutes; its sixth locks it", () => {
    const now = new Date("2026-11-28T10:00:00Z");
    expect(afterWrongPin(0, now)).toEqual({ wrongTries: 1, waitUntil: null, lockedAt: null });
    expect(afterWrongPin(1, now)).toEqual({ wrongTries: 2, waitUntil: null, lockedAt: null });
    expect(afterWrongPin(2, now)).toEqual({
      wrongTries: 3,
      waitUntil: new Date("2026-11-28T10:15:00Z"),
      lockedAt: null,
    });
    expect(afterWrongPin(3, now)).toEqual({ wrongTries: 4, waitUntil: null, lockedAt: null });
    expect(afterWrongPin(5, now)).toEqual({ wrongTries: 6, waitUntil: null, lockedAt: now });
    // Never past the lock, which the table's CHECK holds to.
    expect(afterWrongPin(6, now).wrongTries).toBe(6);
  });

  test("a voucher's fifteenth wrong PIN in the hour waits 15 minutes, and each after it again", () => {
    const start = new Date("2026-11-28T10:00:00Z");
    const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
    expect(afterVoucherWrongPin({ wrongPins: 0, wrongPinsSince: null }, start)).toEqual({
      wrongPins: 1,
      wrongPinsSince: start,
      pinWaitUntil: null,
    });
    expect(afterVoucherWrongPin({ wrongPins: 13, wrongPinsSince: start }, at(10))).toEqual({
      wrongPins: 14,
      wrongPinsSince: start,
      pinWaitUntil: null,
    });
    expect(afterVoucherWrongPin({ wrongPins: 14, wrongPinsSince: start }, at(10))).toEqual({
      wrongPins: 15,
      wrongPinsSince: start,
      pinWaitUntil: at(25),
    });
    // After the wait, still within the hour: the sixteenth waits again.
    expect(afterVoucherWrongPin({ wrongPins: 15, wrongPinsSince: start }, at(30))).toEqual({
      wrongPins: 15,
      wrongPinsSince: start,
      pinWaitUntil: at(45),
    });
    // Over an hour after the first, the count starts again.
    expect(afterVoucherWrongPin({ wrongPins: 15, wrongPinsSince: start }, at(61))).toEqual({
      wrongPins: 1,
      wrongPinsSince: at(61),
      pinWaitUntil: null,
    });
  });

  test("asked of a new device, or a known one with every place held, once the voucher has one", () => {
    const inUse = { status: "active", pinHmac: "h" };
    expect(needsPin(inUse, false, false)).toBe(true);
    expect(needsPin(inUse, true, true)).toBe(true);
    expect(needsPin(inUse, true, false)).toBe(false);
    expect(needsPin({ status: "unused", pinHmac: null }, false, true)).toBe(false);
    expect(needsPin({ status: "active", pinHmac: null }, false, true)).toBe(false);
  });
});
