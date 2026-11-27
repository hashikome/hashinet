import type { GuestContext, PortalLook } from "@hashinet/types";

/**
 * The lowest amount the mobile-money provider (Snippe) takes. Not confirmed with Snippe yet (owner,
 * 13 November 2026); it may be TSh 1,000. It is separate from a voucher's lowest price (TSh 500): a
 * package below it still sells as printed vouchers, and is not offered for payment online.
 */
export const MINIMUM_PAYMENT_TSH = 500;

/** The provider takes whole TSH, from its minimum. */
export function isPayable(priceTsh: string): boolean {
  const amount = Number(priceTsh);
  return Number.isInteger(amount) && amount >= MINIMUM_PAYMENT_TSH;
}

/**
 * What the portal shows a guest, built once for the guest at a router and for the Captive portal
 * editor's preview, so the preview cannot show what the portal does not.
 */
export function guestContext(input: {
  venueName: string;
  internet: boolean;
  mobileMoney: boolean;
  selling: boolean;
  look: PortalLook;
  /** The logo to show when the look shows one; null for none. */
  logoUrl: string | null;
  packages: {
    id: string;
    name: string;
    durationMinutes: number;
    priceTsh: string;
    downloadSpeedMbps: number;
    dataLimitGb: number | null;
  }[];
}): GuestContext {
  return {
    venueName: input.venueName,
    internet: input.internet,
    mobileMoney: input.mobileMoney,
    selling: input.selling,
    settings: { ...input.look, logoUrl: input.look.showLogo ? input.logoUrl : null },
    // Nothing is on sale while its business can't sell.
    packages: (input.selling ? input.packages : []).map((p) => ({
      id: p.id,
      name: p.name,
      durationMinutes: p.durationMinutes,
      priceTsh: p.priceTsh,
      downloadSpeedMbps: p.downloadSpeedMbps,
      dataLimitGb: p.dataLimitGb,
      payable: isPayable(p.priceTsh),
    })),
  };
}
