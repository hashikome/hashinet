import type { DecimalString, Timestamp } from "./core.ts";
import type { SmsDelivery } from "./sales.ts";

/** The portal page a guest sees first. */
export type PortalStart = "voucher" | "buy";

/**
 * What a portal says and does (ADR-0009): the page it opens on, whether it shows a logo, and its
 * wording. The platform's starts a new business's; a business's starts each new venue's.
 */
export interface PortalContent {
  opensOn: PortalStart;
  showLogo: boolean;
  /** The heading on the voucher and buy pages. */
  welcome: string;
  voucherText: string;
  buyText: string;
  /** Where a guest with no voucher buys one in person; empty for "at the venue". */
  whereToBuy: string;
  /** A number guests can call to find the seller (+255…), shown to anyone on the WiFi; optional. */
  contactPhone: string | null;
  requireTerms: boolean;
  /** Shown behind "the venue's terms" when `requireTerms`. */
  terms: string;
}

/**
 * A business's or venue's portal: its content and two colours, the page's and its button's. Every
 * other colour the portal uses is worked out from these two, so it stays readable.
 */
export interface PortalLook extends PortalContent {
  pageColor: string;
  buttonColor: string;
}

/** A pair of colours every business can pick; one is what a new business starts with. */
export interface PortalTheme {
  id: string;
  name: string;
  pageColor: string;
  buttonColor: string;
  isDefault: boolean;
}

/** `GET`, `PUT` and `DELETE /api/portal`: what a new business starts with, and the themes. */
export interface PlatformPortal {
  content: PortalContent;
  themes: PortalTheme[];
  /** When it was last saved; null while HashiNet's own apply. */
  updatedAt: Timestamp | null;
}

/**
 * `GET`, `PUT` and `DELETE /api/portal/business` (what the business's new venues start with) and
 * `/api/venues/:id/portal` (a venue's own), with what the editor's preview shows.
 */
export interface PortalEditor {
  look: PortalLook;
  themes: PortalTheme[];
  /**
   * The logo guests see when it is shown: the venue's own, else the business's; null for none.
   * `own` is true when it is the venue's own.
   */
  logo: { url: string | null; own: boolean };
  /** What the preview shows: as a guest at this venue, or at a new venue of the business. */
  preview: GuestContext;
  updatedAt: Timestamp;
}

/** What the portal page shows a guest: `POST /api/guest/context`. */
export interface GuestContext {
  venueName: string;
  /**
   * Whether the router reaches the internet. Without it the portal says so and takes no code, so a
   * guest's paid time doesn't start for nothing.
   */
  internet: boolean;
  /**
   * Whether guests buy here with mobile money: it is set up and a package can be paid for. Else the
   * plans are read, with where to buy in person.
   */
  sellsOnline: boolean;
  /**
   * Whether the business sells at all: not while it is read-only or suspended (ADR-0014, 2). The
   * portal then shows no plans, and a voucher already sold still signs in.
   */
  selling: boolean;
  /** The venue's portal, with the logo to show; null shows none. */
  settings: PortalLook & { logoUrl: string | null };
  /** What this venue sells, for reading; buying arrives with payments. */
  packages: {
    id: string;
    name: string;
    durationMinutes: number;
    priceTsh: DecimalString;
    downloadSpeedMbps: number;
    dataLimitGb: number | null;
    /** Whether a guest can buy it here with mobile money. */
    payable: boolean;
  }[];
}

/** `POST /api/guest/redeem`: the router reports the device online on this voucher. */
export interface RedeemResult {
  /** Where to go now the device is online, when it was a safe web address. */
  dst: string | null;
  expiresAt: Timestamp | null;
  /** Paid time given back after outages, already in `expiresAt`: the portal says so. */
  givenBackMinutes: number;
  /**
   * The voucher's switch PIN, made at its first sign-in and returned this once (ADR-0015, 4): the
   * portal shows it with the code. Null on every later sign-in.
   */
  switchPin: string | null;
}

/** `GET /api/capabilities`: each is on once its provider's credentials are set. */
export interface Capabilities {
  mobileMoney: boolean;
  sms: boolean;
}

/** `POST /api/guest/payments`: `secret` proves this session paid, and is shown nowhere else. */
export interface GuestPaymentStarted {
  paymentId: string;
  secret: string;
}

/** `POST /api/guest/payments/status`: what the session that paid sees. */
export interface GuestPaymentStatus {
  state: "pending" | "paid" | "failed";
  /** Until the voucher ends. */
  code: string | null;
  expiresAt: Timestamp | null;
  /** The router reports this device online, on a voucher still running. */
  online: boolean;
  /** The voucher has run out: this purchase is over, and the guest can buy again. */
  ended: boolean;
  /** Paid, but the router has not confirmed yet: HashiNet keeps trying. */
  owed: boolean;
  sms: SmsDelivery | null;
  dst: string | null;
  /**
   * The voucher's switch PIN, made when this device was signed in and returned to the paying session
   * this once (ADR-0015, 4): the portal shows it with the code. Null on every other answer.
   */
  switchPin: string | null;
}

/** `POST /api/guest/session`: a device's time and data, for the router's status pages. */
export interface GuestSession {
  active: boolean;
  time: { unlimited: boolean; secondsRemaining: number | null; expiresAt: Timestamp | null } | null;
  data: {
    unlimited: boolean;
    usedBytes: number;
    limitBytes: number | null;
    remainingBytes: number | null;
  } | null;
}
