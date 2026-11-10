import type { BrandRecord } from "@hashinet/types";

/**
 * Settings to draw a voucher with before the real ones load, or if they cannot. The API's own
 * defaults (`GET /api/portal`) apply everywhere else.
 */
export const initialPortalSettings: BrandRecord = {
  brandName: "HashiNet",
  headline: "Welcome to fast WiFi",
  message: "Enter your voucher code to get online.",
  primaryColor: "#F59E2A",
  accentColor: "#0D1B2A",
  backgroundColor: "#0D1B2A",
  radius: 18,
  voucherLabel: "Voucher code",
  voucherPrefix: "WIFI",
  voucherHelp: "Ask at the counter for a voucher.",
  ticketTitle: "Internet Access Voucher",
  ticketFooter: "Thank you for your purchase",
  requireTerms: true,
  isActive: true,
  updatedAt: null,
  logoUrl: null,
  backgroundUrl: null,
};
