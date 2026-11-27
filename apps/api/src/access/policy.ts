import type { MembershipRole } from "@hashinet/types";

/**
 * The one place that says which role may take which action (ADR-0011, 8). Controllers name an
 * action with `@Can`; nothing else compares role names. Scope (which business, which venues) is
 * the principal's, applied by `venueScope`; this table says only whether the role may act at all.
 */
const PLATFORM_ALL = ["admin", "manager", "operator"] as const;
const PLATFORM_STAFF = ["admin", "manager"] as const;
const BUSINESS_ALL = ["owner", "business_manager", "venue_manager", "venue_operator"] as const;
const BUSINESS_MANAGERS = ["owner", "business_manager", "venue_manager"] as const;
const WHOLE_BUSINESS = ["owner", "business_manager"] as const;

export const POLICY = {
  // Venues and routers: HashiNet adds and configures routers (ADR-0011, 5); its operators run
  // connection checks; a business reads its own.
  "venue.read": [...PLATFORM_ALL, ...BUSINESS_ALL],
  // Venues in the menu: who looks after venues. Operators work the counter, and read their venue
  // through what they sell there (owner, 27 November 2026).
  "venue.list": [...PLATFORM_ALL, ...BUSINESS_MANAGERS],
  // A venue's sites open before paying: its owner and managers add and remove them (slice 5).
  "venue.site.manage": BUSINESS_MANAGERS,
  "venue.create": [...PLATFORM_STAFF, "owner"],
  "venue.update": [...PLATFORM_STAFF, ...WHOLE_BUSINESS],
  "venue.delete": PLATFORM_STAFF,
  // Where guests pay at the counter (ADR-0017, 4): the business's ways are kept by those who reach
  // the whole business, since every venue may read one out; a venue's managers choose its way, and
  // whoever sells there reads it.
  "payment_way.read": BUSINESS_MANAGERS,
  "payment_way.manage": WHOLE_BUSINESS,
  "venue.payment_way.read": BUSINESS_ALL,
  "venue.payment_way.choose": BUSINESS_MANAGERS,
  "router.read": [...PLATFORM_ALL, ...BUSINESS_ALL],
  "router.check": PLATFORM_ALL,
  "router.manage": PLATFORM_STAFF,
  // Installing: adding a router, its script and its setup. An operator does it only for a venue's
  // setup handed to them (`routers.service`'s `checkInstall`).
  "router.install": PLATFORM_ALL,
  // Packages: business-wide prices are the owner's alone (ADR-0011, 3).
  "package.read": [...PLATFORM_ALL, ...BUSINESS_ALL],
  "package.manage": ["owner"],
  "package.venue.assign": WHOLE_BUSINESS,
  // A venue manager adds packages sold only at their own venues (ADR-0011, 4); the owner and
  // business managers may too.
  "package.venue.own": BUSINESS_MANAGERS,
  // A business's guests: codes, sessions and devices are the business's; the platform sees
  // counts only (ADR-0014).
  "voucher.read": BUSINESS_ALL,
  // Refunds give money back, so they are an owner's or a manager's (ADR-0017, 7).
  "voucher.refund": BUSINESS_MANAGERS,
  // Whoever is at the counter frees a voucher for a guest whose phone changed (ADR-0015, 6).
  "voucher.release": BUSINESS_ALL,
  "session.read": BUSINESS_ALL,
  "session.terminate": BUSINESS_ALL,
  "device.read": BUSINESS_ALL,
  // Whoever is at the counter keeps a misusing device off; the block is the business's, at every
  // venue. Forgetting a device stays with those who reach the whole business.
  "device.block": BUSINESS_ALL,
  "device.delete": WHOLE_BUSINESS,
  "payment.read": BUSINESS_ALL,
  "sale.record": BUSINESS_ALL,
  "customer.read": BUSINESS_MANAGERS,
  "analytics.read": [...PLATFORM_ALL, ...BUSINESS_MANAGERS],
  // Revenue across businesses: its routes are not scoped to a business, so they stay the
  // platform's. A business reads its own takings from scoped routes (Overview, Payments).
  "revenue.read": PLATFORM_STAFF,
  // The captive portal (ADR-0009): what new businesses start with and the themes are the
  // platform's (ADR-0011, 3); what a business's new venues start with is changed by whoever reaches
  // the whole business; a venue's own by its owner and managers.
  "portal.defaults.read": PLATFORM_ALL,
  "portal.defaults.update": PLATFORM_STAFF,
  "portal.business.update": WHOLE_BUSINESS,
  "brand.read": BUSINESS_ALL,
  "brand.update": BUSINESS_MANAGERS,
  // What businesses pay HashiNet: its admin and managers read the terms and where to pay; only the
  // admin changes them, and a change reaches only businesses added after it (ADR-0013, 3).
  "fees.read": PLATFORM_STAFF,
  "fees.update": ["admin"],
  // A business's invoices: HashiNet's admin and managers, and the business's owner alone, who
  // pays them (ADR-0011, 3).
  "billing.read": [...PLATFORM_STAFF, "owner"],
  // Recording what came in and reminding an owner are HashiNet's admin's and managers' (ADR-0014, 4).
  // Every business's bills together: the platform's Payments.
  "billing.overview": PLATFORM_STAFF,
  "billing.record": PLATFORM_STAFF,
  "billing.remind": PLATFORM_STAFF,
  // Businesses: only HashiNet invites them (ADR-0011, 5); its whole team sees who is pending.
  "business.read": PLATFORM_ALL,
  "business.invite": PLATFORM_STAFF,
  // Service access by hand (ADR-0014, 4): the admin and managers hold and restore along the allowed
  // transitions; only the admin suspends, or makes any other change, as an audited override.
  "business.access": PLATFORM_STAFF,
  "business.suspend": ["admin"],
  "business.access.override": ["admin"],
  // Who sees a business's bill issues: the bill is the owner's; selling paused by it is its
  // managers' to know (operators find out from Sell).
  "issue.bill.read": ["owner"],
  "issue.selling.read": ["business_manager", "venue_manager"],
  // A team's admin or owner and managers see and invite it; who may give which role is by rank
  // (access/rank.ts).
  "team.read": [...PLATFORM_STAFF, ...BUSINESS_MANAGERS],
  // Issues: everything that needs someone, worked in each workspace by its own people; operators
  // of a business see what is theirs on Today instead.
  "issue.read": [...PLATFORM_ALL, ...BUSINESS_MANAGERS],
  "issue.work": [...PLATFORM_ALL, ...BUSINESS_MANAGERS],
  "team.manage": [...PLATFORM_STAFF, ...BUSINESS_MANAGERS],
  // A venue's way to serving guests (ADR-0013, 2): its owner says how the router should come;
  // HashiNet's admin and managers agree the package, record its payment and schedule the setup.
  "onboarding.read": [...PLATFORM_ALL, ...BUSINESS_MANAGERS],
  "onboarding.prefer": WHOLE_BUSINESS,
  "onboarding.manage": PLATFORM_STAFF,
  // The audit log: everyone but operators (ADR-0012).
  "audit.read": [...PLATFORM_ALL, ...BUSINESS_MANAGERS],
} as const satisfies Record<string, readonly MembershipRole[]>;

export type Action = keyof typeof POLICY;

/**
 * Actions that make something sellable or serving. Until an owner or manager protects their
 * sign-in they may set up for 7 days, but not these (ADR-0011, 9).
 */
const NEEDS_PROTECTION: ReadonlySet<Action> = new Set(["sale.record"]);

/**
 * Actions that sell or change what is sold: refused while the business is read-only or suspended
 * (ADR-0014, 2). Refunds and everything else stay open.
 */
const PAUSED_WHILE_READ_ONLY: ReadonlySet<Action> = new Set([
  "sale.record",
  "package.manage",
  "package.venue.assign",
  "package.venue.own",
]);

export function pausedWhileReadOnly(action: Action): boolean {
  return PAUSED_WHILE_READ_ONLY.has(action);
}

export function allows(role: MembershipRole, action: Action): boolean {
  return (POLICY[action] as readonly MembershipRole[]).includes(role);
}

export function needsProtectedSession(action: Action): boolean {
  return NEEDS_PROTECTION.has(action);
}

/** Every action the role may take: what the web draws navigation and buttons from. */
export function capabilitiesOf(role: MembershipRole): Action[] {
  return (Object.keys(POLICY) as Action[]).filter((action) => allows(role, action));
}
