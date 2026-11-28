/** "52:54:00:4a:00:10" or "52-54-00-4A-00-10" as HashiNet keeps it ("52:54:00:4A:00:10"), or null. */
export function normalMac(value: string | null): string | null {
  if (value === null) return null;
  const hex = value.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)?.join(":") ?? null;
}
