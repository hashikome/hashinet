import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { apiError } from "./error-envelope.js";

/** Parses a request body or query, or answers 400 `VALIDATION_FAILED` naming each field. */
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  const details: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".") || "body";
    details[path] ??= issue.message;
  }
  throw new BadRequestException(
    apiError("VALIDATION_FAILED", "Check the highlighted fields.", details),
  );
}

/** One line of text: trimmed, no control characters (names reach printed vouchers and the portal). */
export const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, "must be one line of text");

/** Paragraph text: line breaks allowed, other control characters not. */
export const paragraph = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (text) => [...text].every((c) => c === "\n" || /^[^\p{Cc}]$/u.test(c)),
      "cannot contain control characters",
    );
