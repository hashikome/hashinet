/** Whether every word of a search appears in the text, ignoring case and order. */
export function matchesSearch(search: string, ...fields: (string | null)[]): boolean {
  const text = fields.join(" ").toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => text.includes(w));
}
