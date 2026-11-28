import type { DecimalString, Region, Timestamp } from "./core.ts";

export interface PackageRecord {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  downloadSpeedMbps: number;
  uploadSpeedMbps: number | null;
  dataLimitGb: number | null;
  deviceLimit: number;
  priceTsh: DecimalString;
  features: string[];
  isActive: boolean;
  throttledDownloadMbps: number | null;
  throttledUploadMbps: number | null;
  peakStartHour: number | null;
  peakEndHour: number | null;
  throttleAfterGb: number | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** What a way to pay is; each asks for what a guest needs to pay it. */
export type PaymentWayKind = "lipa_namba" | "mobile_number" | "bank_account";

/**
 * One way guests pay a business by mobile money at its counters (ADR-0017, 4), as whoever sells reads
 * it out.
 */
export interface PaymentWay {
  kind: PaymentWayKind;
  /** Whose it is: a Lipa namba's provider (M-Pesa, CRDB), the mobile money network or
   * the bank; null only on a Lipa namba added before providers were asked. */
  provider: string | null;
  /** The Lipa namba, mobile money number or account number. */
  number: string;
  /** The name the payment shows to the guest, or the bank account's name. */
  name: string;
  /** A bank account's branch, when given. */
  branch: string | null;
  /** For the business's own people, such as "Lodge reception". */
  label: string | null;
  /** What whoever sells reads first: "Lipa namba", the network or the bank. A sale keeps it. */
  through: string;
}

/** A business's way to pay, as Settings › Payments lists it. */
export interface PaymentWayRecord extends PaymentWay {
  id: string;
  /** Venues with no choice of their own read it out; it can't be removed while it is. */
  isDefault: boolean;
  addedAt: string;
  /** Who added it; null once they have left. */
  addedBy: string | null;
  /** The venues that read it out, their own choice or the default, among those the reader sees. */
  venues: { id: string; name: string }[];
}

/** Where a guest paid at the counter: what it is paid through, its number and its name. */
export type PaidTo = Pick<PaymentWay, "through" | "number" | "name">;

/** `GET /api/payment-ways`: a business's ways to pay, the default first, then oldest first. */
export interface PaymentWayList {
  ways: PaymentWayRecord[];
}

/** `GET` and `PUT /api/venues/:id/payment-way`: the way whoever sells at a venue reads out. */
export interface VenuePaymentWay {
  /** What its sellers read out: its own choice, or the business's default; null when the business
   * has no way to pay yet, and mobile money can't be sold there. */
  way: PaymentWay | null;
  /** The venue's own choice; null when it uses the business's default. */
  choiceId: string | null;
}

export type VenueStatus = "active" | "inactive" | "maintenance";

/**
 * Whether a venue sells now. A voucher sold where no router serves guests can't be used, so selling
 * pauses: its routers are set up but offline, without internet or in need of attention (since they
 * were last seen serving), as their condition says it, or none is set up yet.
 */
export type VenueSelling =
  | { state: "selling" }
  /** Its business is read-only or suspended (ADR-0014, 2): nothing sells until it is restored. */
  | { state: "paused" }
  | { state: "offline" | "no-internet" | "needs-attention"; since: Timestamp | null }
  | { state: "not-set-up" };

export interface VenueRecord {
  id: string;
  name: string;
  businessId: string;
  region: Region;
  /** The area or street, as the owner types it. */
  area: string;
  status: VenueStatus;
  routerCount: number;
  /** Whether it sells now: only while one of its routers serves guests (set up and online). */
  selling: VenueSelling;
  /** The WiFi guests join here: its routers' network name, else the venue's name. */
  wifiName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** `GET /api/venues`. */
export interface VenueList {
  venues: VenueRecord[];
}

/** `GET` and `PUT /api/venues/:id`, and `POST /api/venues`. */
export interface VenueResponse {
  venue: VenueRecord;
}

/**
 * A site guests open before paying at a venue (slice 5): open, or waiting for its slot's payment.
 * Its cost: the first comes with the venue; each more is a slot paid for once, or granted to a site
 * open before slots existed.
 */
export interface VenueSiteRecord {
  id: string;
  host: string;
  note: string | null;
  state: "open" | "waiting";
  cost: "included" | "paid" | "due";
  /** What its slot costs; null when included. */
  slotTsh: number | null;
  /** The invoice for its slot, while it waits for payment; the owner downloads it. */
  invoice: { id: string; number: string } | null;
  addedAt: Timestamp;
  addedBy: string | null;
}

/** `GET /api/venues/:id/sites`: its sites, in the order they were added. */
export interface VenueSites {
  sites: VenueSiteRecord[];
  /** What adding one more open site costs: 0 while it comes with the venue or a slot is free. */
  nextCostTsh: number;
}

/** `GET /api/venues/:id`: the venue, and who runs it: its venue managers, or its owner when none. */
export interface VenueDetail extends VenueResponse {
  managers: { name: string; email: string }[];
}

/** `GET /api/packages`: the packages on sale, each with where it sells. */
/** `GET /api/packages`: the business's packages and its venues' own, within the reader's venues. */
export interface PackageList {
  packages: (PackageRecord & {
    /** A venue's own package, sold only there: its venue; null for the business's. */
    venue: { id: string; name: string } | null;
    /** Of the reader's venues, how many sell it, and how many of those at their own price. */
    soldAt: number;
    ownPrices: number;
  })[];
  /** How many venues the reader reaches. */
  venues: number;
}

/** `GET` and `PUT /api/packages/:id`, and `POST /api/packages`. */
export interface PackageResponse {
  package: PackageRecord;
}

/** `GET /api/venues/:venueId/packages`: what the venue sells. */
/** `GET /api/venues/:id/packages`: what a venue sells, and how it has each package (ADR-0011, 4). */
export interface VenuePackages {
  /** What it sells now, at its own prices, cheapest first. */
  packages: PackageRecord[];
  /** The business's packages as this venue has them, then the venue's own. */
  catalogue: {
    /** At the business's price; a venue's own package at its price. */
    package: PackageRecord;
    /** The venue's own price for a business package; null follows the business's. */
    ownPriceTsh: DecimalString | null;
    onSale: boolean;
    /** The venue's own package, sold only there. */
    own: boolean;
  }[];
}

/** The lowest price of a package, and so of a voucher, in whole shillings. */
export const MINIMUM_PRICE_TSH = 500;
