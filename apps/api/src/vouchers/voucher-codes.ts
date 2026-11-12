import { randomInt } from "node:crypto";

/**
 * 12 digits (ADR-0008): typed on a phone's number keypad, printed and read aloud in three groups
 * of four. 10^12 codes (39.9 bits), so with 100,000 codes live a guess succeeds about once in 10
 * million tries; redemption is rate-limited as well. Stored without spaces; a leading 0 is fine.
 */
export const CODE_LENGTH = 12;

/** A voucher code from a cryptographic generator; `randomInt` draws each digit without bias. */
export function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += String(randomInt(10));
  return code;
}

/** "4827 1693 6518": a code in the three groups it is printed and read aloud in. */
export function groupedCode(code: string): string {
  return code.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** A code as someone typed or printed it ("4827 1693 6518"), in the form it is stored. */
export function normalCode(typed: string): string {
  return typed.replace(/[\s-]/g, "");
}

/**
 * `count` distinct codes that `taken` does not already hold. A collision at 40 bits is rare,
 * but a batch must never fail or repeat because of one.
 */
export async function generateCodes(
  count: number,
  taken: (codes: string[]) => Promise<Set<string>>,
): Promise<string[]> {
  const codes = new Set<string>();
  for (let round = 0; round < 5 && codes.size < count; round++) {
    const candidates = new Set<string>();
    while (candidates.size < count - codes.size) {
      const code = generateCode();
      if (!codes.has(code)) candidates.add(code);
    }
    const existing = await taken([...candidates]);
    for (const code of candidates) if (!existing.has(code)) codes.add(code);
  }
  if (codes.size < count) throw new Error("Could not generate unique voucher codes");
  return [...codes];
}
