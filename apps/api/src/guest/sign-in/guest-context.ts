import type { GuestContext, PortalLook } from "@hashinet/types";

/**
 * What the portal shows a guest, built once for the guest at a router and for the Captive portal
 * editor's preview, so the preview cannot show what the portal does not.
 */
export function guestContext(input: {
  venueName: string;
  internet: boolean;
  /** Whether a price can be paid online now (mobile money is on, and its provider takes it). */
  payable: (priceTsh: string) => boolean;
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
    sellsOnline: input.selling && input.packages.some((p) => input.payable(p.priceTsh)),
    selling: input.selling,
    settings: {
      ...input.look,
      // With nothing on sale, a guest can only use a voucher: the portal opens on that page.
      opensOn: input.selling ? input.look.opensOn : "voucher",
      logoUrl: input.look.showLogo ? input.logoUrl : null,
    },
    // Nothing is on sale while its business can't sell.
    packages: (input.selling ? input.packages : []).map((p) => ({
      id: p.id,
      name: p.name,
      durationMinutes: p.durationMinutes,
      priceTsh: p.priceTsh,
      downloadSpeedMbps: p.downloadSpeedMbps,
      dataLimitGb: p.dataLimitGb,
      payable: input.payable(p.priceTsh),
    })),
  };
}
