import type { PortalContent, PortalLook } from "@hashinet/types";
import { z } from "zod";
import { oneLine, paragraph } from "../../core/http/validation.js";
import { mobileNumber } from "../../sales/payments/payment-input.js";

/** HashiNet's own, until the platform saves its own: what a new business's portal starts with. */
export const HASHINET_PORTAL: PortalContent = {
  opensOn: "voucher",
  showLogo: true,
  welcome: "Welcome to fast WiFi",
  voucherText: "Enter your voucher code to get online.",
  buyText: "Choose your time and pay with mobile money. You're online in a moment.",
  whereToBuy: "",
  contactPhone: null,
  requireTerms: true,
  terms:
    "Use this WiFi for lawful purposes only. Don't share your voucher code or switch PIN. Time runs from when you first join and doesn't pause. We may limit speeds at busy times. Vouchers aren't refundable once used.",
};

/** HashiNet's colours, should the platform have no default theme. */
export const HASHINET_COLOURS = { pageColor: "#0D1B2A", buttonColor: "#F59E2A" };

/** A colour as the colour picker gives it, kept in capitals so equal colours compare equal. */
export const colour = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, "must be a colour such as #F59E2A")
  .transform((value) => value.toUpperCase());

/** What a portal says and does, as the Captive portal form sends all of it. */
export const contentInput = z.object({
  opensOn: z.enum(["voucher", "buy"]),
  showLogo: z.boolean(),
  welcome: oneLine(120).min(1, "is required"),
  voucherText: oneLine(240),
  buyText: oneLine(240),
  whereToBuy: oneLine(240),
  /** Optional: an empty field shows no number. */
  contactPhone: z.union([z.literal("").transform(() => null), z.null(), mobileNumber]),
  requireTerms: z.boolean(),
  terms: paragraph(2000),
}) satisfies z.ZodType<PortalContent, unknown>;

/** A business's or venue's: the content and its two colours. */
export const lookInput = contentInput.extend({
  pageColor: colour,
  buttonColor: colour,
}) satisfies z.ZodType<PortalLook, unknown>;

export const themeInput = z.object({
  name: oneLine(60).min(1, "is required"),
  pageColor: colour,
  buttonColor: colour,
});

/** The columns a look is stored in, from a row that has them and maybe more. */
export function lookOf(row: PortalLook): PortalLook {
  return {
    pageColor: row.pageColor,
    buttonColor: row.buttonColor,
    ...contentOf(row),
  };
}

export function contentOf(row: PortalContent): PortalContent {
  return {
    opensOn: row.opensOn,
    showLogo: row.showLogo,
    welcome: row.welcome,
    voucherText: row.voucherText,
    buyText: row.buyText,
    whereToBuy: row.whereToBuy,
    contactPhone: row.contactPhone,
    requireTerms: row.requireTerms,
    terms: row.terms,
  };
}
