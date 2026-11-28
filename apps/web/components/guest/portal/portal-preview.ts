import type { GuestContext, GuestPaymentStarted, GuestPaymentStatus } from "@hashinet/types";
import type { Stage } from "./guest-portal";

/** A page of the portal as the Captive portal editor previews it. */
export type PreviewPage =
  | "voucher"
  | "wrong-code"
  | "run-out"
  | "in-use"
  | "pin-wrong"
  | "pin-wait"
  | "pin-locked"
  | "signing"
  | "sign-failed"
  | "online"
  | "buy"
  | "approve"
  | "pay-failed"
  | "paid"
  | "terms";

/** The editor's preview: the portal a guest gets, with this context, on this page, offline. */
export interface Preview {
  context: GuestContext;
  page: PreviewPage;
}

export const SAMPLE_CODE = "482913675204";

/** The preview's purchase: nothing is asked of the API. */
export const PREVIEW_PURCHASE: GuestPaymentStarted = { paymentId: "preview", secret: "preview" };

const inADay = () => new Date(Date.now() + 86_400_000).toISOString();

const paidAs = (state: GuestPaymentStatus["state"]): GuestPaymentStatus => ({
  state,
  code: state === "paid" ? SAMPLE_CODE : null,
  expiresAt: state === "paid" ? inADay() : null,
  online: state === "paid",
  ended: false,
  owed: false,
  sms: null,
  dst: null,
  switchPin: null,
});

/** Where the preview starts: the page, and the purchase it shows. */
export function previewState(page: PreviewPage): {
  stage: Stage;
  payment: GuestPaymentStarted | null;
  paid: GuestPaymentStatus | null;
  error: string | null;
} {
  const none = { payment: null, paid: null, error: null };
  const purchase = PREVIEW_PURCHASE;
  switch (page) {
    case "wrong-code":
      return {
        ...none,
        stage: { kind: "voucher" },
        error: "That code isn't right. Check it against your voucher.",
      };
    case "run-out":
      return {
        ...none,
        stage: { kind: "run-out", message: "This voucher has been used up." },
      };
    case "online":
      return {
        ...none,
        stage: { kind: "online", expiresAt: inADay(), givenBackMinutes: 0, pin: "1942" },
      };
    case "in-use":
      return { ...none, stage: { kind: "in-use", error: null } };
    case "pin-wrong":
      return {
        ...none,
        stage: { kind: "in-use", error: "That PIN isn't right. Check it and try again." },
      };
    case "pin-wait":
      return {
        ...none,
        stage: { kind: "pin-wait", until: new Date(Date.now() + 15 * 60_000).toISOString() },
      };
    case "pin-locked":
      return { ...none, stage: { kind: "pin-locked" } };
    case "signing":
    case "sign-failed":
    case "buy":
      return { ...none, stage: { kind: page } };
    case "terms":
      return { ...none, stage: { kind: "terms", back: "voucher" } };
    case "approve":
      return { ...none, stage: { kind: "buy" }, payment: purchase };
    case "pay-failed":
      return { ...none, stage: { kind: "buy" }, payment: purchase, paid: paidAs("failed") };
    case "paid":
      return { ...none, stage: { kind: "buy" }, payment: purchase, paid: paidAs("paid") };
    default:
      return { ...none, stage: { kind: "voucher" } };
  }
}
