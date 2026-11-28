import { randomInt } from "node:crypto";
import { CODE_LENGTH } from "@hashinet/types";
import type { PrismaService } from "../../core/database/prisma.service.js";

/**
 * A voucher code (ADR-0008: 12 digits, 10^12 codes, about 40 bits) from a cryptographic
 * generator; `randomInt` draws each digit without bias.
 */
export function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += String(randomInt(10));
  return code;
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

/** A code no voucher has yet: drawn, and drawn again for any a voucher already holds. */
export async function unusedCode(db: PrismaService): Promise<string> {
  const [code = ""] = await generateCodes(1, async (candidates) => {
    const taken = await db.voucher.findMany({
      where: { code: { in: candidates } },
      select: { code: true },
    });
    return new Set(taken.map((t) => t.code));
  });
  return code;
}
