/** "820 MB", "1.4 GB": what a device used, in the decimal units phone plans are sold in. */
export function dataSize(bytes: number): string {
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
  if (bytes < 1e9) return `${Math.round(bytes / 1e6)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}
