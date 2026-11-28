import { timingSafeEqual } from "node:crypto";

/** Whether two secrets' bytes are equal, in time that doesn't say how much of them matched. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
