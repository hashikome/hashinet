import type { BusinessDay } from "./analytics.ts";
import type { Region, Timestamp } from "./core.ts";
import type { RouterCondition } from "./network.ts";
import type { MembershipRole } from "./people.ts";

/** What a venue shows: its own branding, or the HashiNet default. */
/**
 * HashiNet's fee on a venue's net sales in a month (ADR-0013, 3): `rateBp` of it, `lowerRateBp`
 * on the part above `lowerRateAboveTsh`, and at least `minimumTsh` a serving venue. Rates are basis
 * points: 500 is 5%.
 */
export interface FeeTerms {
  rateBp: number;
  lowerRateBp: number;
  lowerRateAboveTsh: number;
  minimumTsh: number;
}

/** Where businesses pay HashiNet; a way left empty is not offered. */
export interface HashiNetPayTo {
  /** The Lipa namba, and the name a payment to it shows. */
  mobileMoney: string | null;
  mobileMoneyName: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccount: string | null;
  bankSwift: string | null;
  /** Whose account it is: Shikome Technology Limited. */
  accountName: string;
}

/** Who issues HashiNet's invoices, as an invoice prints it; its name is the account name. */
export interface HashiNetIssuer {
  postal: string | null;
  office: string | null;
  email: string | null;
  /** The company's incorporation number. */
  registration: string | null;
  tin: string | null;
}

/** `GET` and `PUT /api/billing/settings`: the terms new businesses start with, and where to pay. */
export interface BillingSettingsRecord {
  terms: FeeTerms;
  /** What a venue's second and each further site open before paying costs, once. */
  siteSlotTsh: number;
  payTo: HashiNetPayTo;
  issuer: HashiNetIssuer;
  /** When the platform admin last saved; null while today's terms apply. */
  updatedAt: Timestamp | null;
}

export interface BillingSettingsResponse {
  settings: BillingSettingsRecord;
}

/** What a business owes HashiNet for: a month's fees, or a venue's onboarding. */
export type InvoiceKind = "monthly_fees" | "onboarding" | "site_slot";

/**
 * Where an invoice stands: `overdue` once its due date has passed with anything left to pay,
 * whatever came in; `part_paid` before then with some paid; `cancelled` when it was withdrawn
 * before anything was paid, kept as history and never owed.
 */
export type InvoiceState = "due" | "part_paid" | "paid" | "overdue" | "cancelled";

/** One line of an invoice, as it was issued. */
export interface InvoiceLineRecord {
  /** A venue's name for its month's fee; what an onboarding line is. */
  label: string;
  venueId: string | null;
  /** An onboarding line's kind; null for a month's fee. */
  onboardingKind: OnboardingLineKind | null;
  /** A month's fee: the venue's net sales that month. */
  netSalesTsh: number | null;
  /** A month's fee: the share of the month a router served it (basis points), where a minimum applied. */
  servedBp: number | null;
  /** A month's fee: the prorated minimum, when that is what the venue owed. */
  minimumTsh: number | null;
  amountTsh: number;
}

/** Money that settled an invoice, or part of it. */
export interface InvoicePaymentRecord {
  /** The day it arrived, YYYY-MM-DD. */
  receivedOn: string;
  method: BillPaymentMethod;
  reference: string | null;
  /** The part of the payment that went to this invoice. */
  amountTsh: number;
}

export interface InvoiceRecord {
  id: string;
  /** INV-2026-12-0001. */
  number: string;
  businessId: string;
  businessName: string;
  kind: InvoiceKind;
  /** The month billed (YYYY-MM), for a month's fees. */
  period: string | null;
  /** The venue a one-off charge is for: its onboarding, or an extra site. */
  venueName: string | null;
  issuedAt: Timestamp;
  /** The last day to pay, YYYY-MM-DD. */
  dueOn: string;
  totalTsh: number;
  paidTsh: number;
  dueTsh: number;
  state: InvoiceState;
  lines: InvoiceLineRecord[];
  /** What settled it, oldest first. */
  payments: InvoicePaymentRecord[];
}

/** Who a business is to HashiNet's billing: its name, who is billed, its terms, where it pays. */
export interface BillingProfile {
  business: { id: string; name: string; region: string; area: string };
  /** Who it is billed to: the owner; null if the business has none. */
  owner: { name: string; email: string } | null;
  terms: FeeTerms;
  payTo: HashiNetPayTo;
}

/** A business's account with HashiNet (`GET /api/billing/account`): a bill, or the owner's Billing. */
export interface BillingAccount extends BillingProfile {
  /** Everything it has paid HashiNet. */
  paidTsh: number;
  dueTsh: number;
  overdueTsh: number;
  /** What is owed, oldest first: what a payment on the business settles first. */
  owed: InvoiceRecord[];
  /** Every invoice, newest first. */
  invoices: InvoiceRecord[];
  /** What it may do, as its bills or a hold set it (ADR-0014, 2). */
  access: ServiceAccessState;
}

/**
 * A business's bill over a period: `open` while its only fees are the month in progress, invoiced on
 * the 1st; `no_fee` with nothing to bill.
 */
export type BillState = "overdue" | "part_paid" | "due" | "paid" | "open" | "no_fee";

/** One business on the platform's Payments, for a period. */
export interface BillingRow {
  businessId: string;
  name: string;
  ownerName: string | null;
  /** Its venues with a router set up. */
  venues: number;
  /** Net sales in the period, the month in progress so far included. */
  salesTsh: number;
  /** The months' fees invoiced in the period. */
  feesTsh: number;
  /** One-off charges: issued in the period, or still unpaid. */
  oneOffTsh: number;
  billedTsh: number;
  paidTsh: number;
  dueTsh: number;
  /** The part of what is due that is past its date. */
  overdueTsh: number;
  /**
   * Everything the business owes, whatever the period: what a payment recorded on it settles,
   * oldest first.
   */
  owedTsh: number;
  state: BillState;
  monthsBilled: number;
  monthsPaid: number;
  /**
   * Its fee rate (basis points): its own, or what its fees came to as a share of its sales where
   * the lower band applied; and whether a minimum set any of them.
   */
  rateBp: number;
  lowerRate: boolean;
  minimum: boolean;
}

/** `GET /api/billing/overview?from=YYYY-MM&to=YYYY-MM`: every business's bill for the months. */
export interface BillingOverview {
  from: string;
  to: string;
  /** Every month there is to show, oldest first (YYYY-MM): from the first billed to this one. */
  months: string[];
  /** The month in progress is in the period: its fees are invoiced on this day. */
  invoicedOn: string | null;
  rows: BillingRow[];
  totals: {
    billedTsh: number;
    paidTsh: number;
    /** What was paid of what was billed (basis points); null with nothing billed. */
    collectedBp: number | null;
    dueTsh: number;
    overdueTsh: number;
    salesTsh: number;
    venues: number;
    owing: number;
    overdue: string[];
  };
}

/** `GET /api/billing/invoices/:id`: one invoice, with its business's header. */
export interface InvoiceResponse extends BillingProfile {
  invoice: InvoiceRecord;
}

/**
 * `GET` and `PUT /api/business`, and `PUT` and `DELETE /api/business/logo`: the business's name,
 * where it is (on its invoices) and its logo (ADR-0009, 1). Its owner changes them.
 */
export interface BusinessProfile {
  name: string;
  region: Region;
  area: string;
  /** Served from the portal's own origin; null while it has none. */
  logoUrl: string | null;
}

/**
 * How far the session may act (ADR-0011, 9): `full`; `setup`, an owner or manager in their first
 * 7 days before protecting their sign-in, who may get set up but not sell or serve; or `account`,
 * Account and security only.
 */
export type AccessLevel = "full" | "setup" | "account";

/** A business as HashiNet's team lists it (`GET /api/businesses`). */
export interface BusinessSummary {
  id: string;
  name: string;
  region: Region;
  area: string;
  /** Its owner, once the invitation is accepted. */
  owner: { name: string; email: string } | null;
  venues: {
    id: string;
    name: string;
    region: Region;
    area: string;
    routers: number;
    /** The worst of its routers; setting up while none has served. */
    condition: RouterCondition;
    stage: OnboardingStage;
    /** Its guests, as counts only (ADR-0014, 1): devices on a session at a router that answers,
     * and those whose time runs while their router is down. */
    onlineNow: number;
    midSession: number;
  }[];
  /** Across its routers: the worst of them, or setting up while none has served. */
  condition: RouterCondition;
  createdAt: Timestamp;
}

/** `GET /api/businesses`. */
export interface BusinessList {
  businesses: BusinessSummary[];
}

/**
 * `GET /api/businesses/:id`: a business as HashiNet's team sees it (ADR-0014, 1): who owns and
 * manages it, and each venue's way to serving guests. Its operators and guests are its own.
 */
export interface BusinessDetail {
  id: string;
  name: string;
  region: Region;
  area: string;
  createdAt: Timestamp;
  owner: { name: string; email: string; phone: string | null } | null;
  /** Its owners and managers, never its operators. */
  people: {
    membershipId: string;
    name: string;
    email: string;
    role: MembershipRole;
    /** A venue manager's venues; empty for those who reach the whole business. */
    venues: string[];
  }[];
  venues: BusinessSummary["venues"];
  serviceAccess: ServiceAccessDetail;
}

/** Why a business can't sell: its overdue bill, or a hold by HashiNet's team. */
export type SellingPause = "overdue" | "held";

/** What a business may do (ADR-0014, 2). */
export type ServiceAccess = "enabled" | "grace_period" | "read_only" | "suspended";
export type ServiceAccessReason =
  | "payment_overdue"
  | "payment_received"
  | "payment_arranged"
  | "policy_violation"
  | "customer_request"
  | "contract_ended"
  | "issue_resolved"
  | "other";

/**
 * A business's access now: by its bills, or held by hand until a day (or until changed). The
 * overdue facts are its bills', whether or not a hold overrides them.
 */
export interface ServiceAccessState {
  access: ServiceAccess;
  /** Whether it sells: not while read-only or suspended. The API decides; the web reads it. */
  selling: boolean;
  since: Timestamp | null;
  held: boolean;
  heldUntil: BusinessDay | null;
  /** Its oldest overdue month of fees' due date; null when nothing is overdue. */
  overdueSince: BusinessDay | null;
  /** What is overdue; null for a reader who doesn't see money (a platform operator). */
  overdueTsh: number | null;
  /** An earlier month was paid after its due date, so overdue fees end in read-only. */
  lateBefore: boolean;
  /** When its bills pause selling (14 days after the due date, for a business late before); null
   * when they never will, or already have. */
  pausesOn: BusinessDay | null;
}

/** One change to a business's access, as its owners were told; the note is HashiNet's team's. */
export interface ServiceAccessChangeRecord {
  id: string;
  access: ServiceAccess;
  held: boolean;
  heldUntil: BusinessDay | null;
  reason: ServiceAccessReason;
  note: string | null;
  message: string | null;
  /** Who set it by hand; null when its bills did. */
  by: string | null;
  at: Timestamp;
}

export interface ServiceAccessDetail extends ServiceAccessState {
  /** Newest first. */
  changes: ServiceAccessChangeRecord[];
}

export type IssueKind =
  | "router_offline"
  | "router_setup"
  | "venue_package"
  | "venue_setup"
  | "bill_due"
  | "selling_paused";
export type IssueStatus = "open" | "resolved";
export type IssueAction =
  | "opened"
  | "claimed"
  | "released"
  | "handed"
  | "taken_over"
  | "noted"
  | "step"
  | "resolved";

/** What a step or a resolution was, as bounded facts the web words. */
export type IssueEventData = Record<string, string | number | boolean | null>;

/** A person an issue can be handed to, or who holds it. */
export interface IssuePerson {
  membershipId: string;
  name: string;
  role: MembershipRole;
}

/**
 * Something that needs someone, in the reader's workspace (ADR-0011, 11). The API says who holds
 * it and what the reader may do; the web words it.
 */
export interface IssueRecord {
  id: string;
  kind: IssueKind;
  status: IssueStatus;
  business: { id: string; name: string } | null;
  venue: { id: string; name: string } | null;
  router: { id: string; name: string } | null;
  /** What took a router issue's router down when it opened; null for other kinds. */
  cause: RouterCondition | null;
  /** A bill issue: something owed is past its due date. */
  overdue: boolean;
  /** A bill issue or a selling-paused one: its business's access, and when its bills pause
   * selling; null for other kinds. */
  access: {
    state: ServiceAccess;
    selling: boolean;
    /** Set by HashiNet's team by hand, rather than by its bills. */
    held: boolean;
    pausesOn: BusinessDay | null;
  } | null;
  holder: IssuePerson | null;
  /** The reader holds it. */
  mine: boolean;
  /** Claim: nobody holds it. */
  canClaim: boolean;
  /** Take over: someone below the reader holds it. */
  canTakeOver: boolean;
  /** Release or hand it on: the reader holds it. */
  canRelease: boolean;
  /** Add a note: the reader holds it, or nobody does (noting claims it). */
  canNote: boolean;
  /** Held with no activity for a day: flagged, never released by itself. */
  stalled: boolean;
  openedAt: Timestamp;
  resolvedAt: Timestamp | null;
}

/** `GET /api/issues/count`: the open issues in the reader's reach, for the menu. */
export interface IssueCount {
  openCount: number;
}

/** After Release or Hand to: whether the reader still sees the issue (an operator doesn't). */
export interface IssueMoved {
  visible: boolean;
}

/** `GET /api/issues`. */
export interface IssueList {
  issues: IssueRecord[];
  /** Open issues in the reader's reach, for the menu's count. */
  openCount: number;
}

/** `GET /api/issues/:id`: the issue, what happened on it in order, and whom it can be handed to. */
export interface IssueDetail {
  issue: IssueRecord;
  events: {
    at: Timestamp;
    /** Null: HashiNet itself. */
    actor: IssuePerson | null;
    action: IssueAction;
    to: IssuePerson | null;
    note: string | null;
    data: IssueEventData | null;
  }[];
  handTo: IssuePerson[];
  /** Whom a venue's setup can go to when it is scheduled: HashiNet's team, operators included.
   * Empty except on a package issue the reader can schedule. */
  goesTo: IssuePerson[];
  /** Whom HashiNet's team calls about a venue's issue: its business's owner. Null for a business,
   * which is calling no one but itself. */
  contact: { name: string; email: string; phone: string | null } | null;
}

/** How a venue's router comes (ADR-0013, 2): connect its own, install one, launch with a line. */
export const ONBOARDING_PLANS = ["connect", "install", "launch"] as const;
export type OnboardingPlan = (typeof ONBOARDING_PLANS)[number];
/** How money reached HashiNet, as whoever records it says. */
export const BILL_PAYMENT_METHODS = ["mobile_money", "bank_transfer", "cash"] as const;
export type BillPaymentMethod = (typeof BILL_PAYMENT_METHODS)[number];
/** What a venue's onboarding is charged for, all on HashiNet's bill (ADR-0013, 2). */
export const ONBOARDING_LINE_KINDS = [
  "onboarding_fee",
  "mikrotik_router",
  "isp_router",
  "internet_line",
  "other",
] as const;
export type OnboardingLineKind = (typeof ONBOARDING_LINE_KINDS)[number];
/** Lines that must say what they are: the MikroTik router names its model, and Other says what it is. */
export const ONBOARDING_LINE_DESCRIBED: readonly OnboardingLineKind[] = [
  "mikrotik_router",
  "other",
];
/** The lines each plan starts with, for the team to price and change on the call. */
export const ONBOARDING_STARTING_LINES: Record<OnboardingPlan, OnboardingLineKind[]> = {
  connect: ["onboarding_fee"],
  install: ["onboarding_fee", "mikrotik_router"],
  launch: ["onboarding_fee", "mikrotik_router", "internet_line"],
};
export interface OnboardingLine {
  kind: OnboardingLineKind;
  /** A router's model, what the fee covers, or what "other" is. */
  description: string | null;
  /** Null for a reader who doesn't see what it costs: HashiNet's operators. */
  amountTsh: number | null;
}

/**
 * Where a venue is on its way to serving guests, decided by the API: the owner chooses how the
 * router comes, the team confirms the package, it is paid (when there is a charge), the setup is
 * scheduled, the router is added and reaches HashiNet, it is set up and serves, and the first
 * guest gets online.
 */
export type OnboardingStage =
  | "choose"
  | "confirm"
  | "pay"
  | "schedule"
  | "add-router"
  | "set-up"
  | "first-guest"
  | "done";

/** `GET /api/venues/:id/onboarding`. */
export interface VenueOnboarding {
  venue: { id: string; name: string };
  business: { id: string; name: string };
  stage: OnboardingStage;
  /** Null: not asked yet. A null plan: the owner asked to talk first. */
  preference: { plan: OnboardingPlan | null; at: Timestamp } | null;
  agreed: {
    plan: OnboardingPlan;
    /** In the order agreed; the onboarding fee first. */
    lines: OnboardingLine[];
    /** The lines together; 0 when there is nothing to charge; null for a reader who doesn't
     * see what it costs. */
    totalTsh: number | null;
    note: string | null;
    confirmedAt: Timestamp;
  } | null;
  /**
   * The package's invoice, for a reader who sees what it costs: null when there is nothing to
   * charge. The setup is scheduled once it is paid.
   */
  invoice: {
    id: string;
    number: string;
    totalTsh: number;
    paidTsh: number;
    dueTsh: number;
    dueOn: string;
    state: InvoiceState;
  } | null;
  /** The agreed setup day, YYYY-MM-DD. */
  setupDate: string | null;
  completedAt: Timestamp | null;
  /** The business's owner has an authenticator or a passkey: the venue may serve. */
  ownerProtected: boolean;
  /** What the owner gets ready for the first guest, who buys the first voucher (ADR-0013, 2). */
  ready: {
    packagesOnSale: number;
  };
  /** What the reader may do now, decided where each step is guarded. */
  may: { prefer: boolean; confirm: boolean; pay: boolean; schedule: boolean };
  /** The open package or setup issue, for HashiNet's team; null for a business. */
  issueId: string | null;
}
