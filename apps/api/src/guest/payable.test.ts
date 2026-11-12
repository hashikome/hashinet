import { describe, expect, test } from "bun:test";
import { isPayable, MINIMUM_PAYMENT_TSH } from "./guest.service.js";

describe("what can be paid online", () => {
  test("whole shillings from the provider's minimum", () => {
    expect(isPayable(String(MINIMUM_PAYMENT_TSH))).toBe(true);
    expect(isPayable(String(MINIMUM_PAYMENT_TSH - 1))).toBe(false);
    expect(isPayable("1500.50")).toBe(false);
  });
});
