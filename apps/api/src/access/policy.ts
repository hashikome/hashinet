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
  "venue.create": [...PLATFORM_STAFF, "owner"],
  "venue.update": [...PLATFORM_STAFF, ...WHOLE_BUSINESS],
  "venue.delete": PLATFORM_STAFF,
  // Whoever sells at a venue reads where guests pay; its owner and managers keep it (ADR-0017, 4).
  "payment_details.read": BUSINESS_ALL,
  "payment_details.update": BUSINESS_MANAGERS,
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
  // The portal: HashiNet's defaults are the platform's (ADR-0011, 3); a business's managers brand
  // their own venues.
  "portal.defaults.read": PLATFORM_ALL,
  "portal.defaults.update": PLATFORM_STAFF,
  "brand.read": BUSINESS_ALL,
  "brand.update": BUSINESS_MANAGERS,
  // What businesses pay HashiNet: its admin and managers read the terms and where to pay; only the
  // admin changes them, and a change reaches only businesses added after it (ADR-0013, 3).
  "fees.read": PLATFORM_STAFF,
  "fees.update": ["admin"],
  // A business's invoices: HashiNet's admin and managers, and the business's owner alone, who
  // pays them (ADR-0011, 3).
  "billing.read": [...PLATFORM_STAFF, "owner"],
  // Businesses: only HashiNet invites them (ADR-0011, 5); its whole team sees who is pending.
  "business.read": PLATFORM_ALL,
  "business.invite": PLATFORM_STAFF,
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
