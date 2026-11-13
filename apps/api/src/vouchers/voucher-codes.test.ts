import { describe, expect, test } from "bun:test";
import { CODE_LENGTH, groupedCode, normalCode } from "@hashinet/types";
import { generateCode, generateCodes } from "./voucher-codes.js";

describe("voucher codes", () => {
  test("twelve digits, with no prefix (ADR-0008)", () => {
    for (let i = 0; i < 1000; i++) expect(generateCode()).toMatch(/^\d{12}$/);
    expect(CODE_LENGTH).toBe(12);
  });

  test("every digit appears in every position, roughly evenly", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      for (const [at, digit] of [...generateCode()].entries()) {
        const key = `${at}:${digit}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(CODE_LENGTH * 10);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(400 * 0.75);
      expect(count).toBeLessThan(400 * 1.25);
    }
  });

  test("a code typed in groups, or with dashes, is the code", () => {
    expect(normalCode("4827 1693 6518")).toBe("482716936518");
    expect(normalCode(" 4827-1693-6518 ")).toBe("482716936518");
    expect(groupedCode("482716936518")).toBe("4827 1693 6518");
  });

  test("codes already taken are replaced, never repeated", async () => {
    let first = true;
    const codes = await generateCodes(50, async (candidates) => {
      // The first round reports half the candidates as taken.
      if (!first) return new Set();
      first = false;
      return new Set(candidates.slice(0, 25));
    });
    expect(new Set(codes).size).toBe(50);
  });

  test("a store that reports every code taken fails rather than loops", async () => {
    await expect(generateCodes(3, async (c) => new Set(c))).rejects.toThrow(/unique/);
  });
});
