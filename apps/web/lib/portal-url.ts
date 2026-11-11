/**
 * Where a printed QR code sends a phone: the web, which serves the portal. Set
 * `NEXT_PUBLIC_PORTAL_URL` when staff reach the admin at another address than guests do.
 */
export function portalOrigin(): string {
  if (process.env.NEXT_PUBLIC_PORTAL_URL) return process.env.NEXT_PUBLIC_PORTAL_URL;
  return typeof window === "undefined" ? "" : window.location.origin;
}

/** The link a printed or shown voucher carries: the portal's Join page, with the code in the fragment (ADR-0008). */
export function joinLink(code: string, origin: string = portalOrigin()): string {
  return `${origin}/join#code=${code}`;
}
