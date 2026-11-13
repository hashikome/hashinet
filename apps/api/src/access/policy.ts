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
  "voucher.print": BUSINESS_ALL,
  "voucher.revoke": BUSINESS_MANAGERS,
  "session.read": BUSINESS_ALL,
  "session.terminate": BUSINESS_ALL,
  "device.read": BUSINESS_ALL,
  "guest.count": PLATFORM_ALL,
  // A device's blocked status is shared by every business today; until blocking is per business
  // (slice 2), only those who reach the whole business block.
  "device.block": WHOLE_BUSINESS,
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
  // Businesses: only HashiNet invites them (ADR-0011, 5); its whole team sees who is pending.
  "business.read": PLATFORM_ALL,
  "business.invite": PLATFORM_STAFF,
  // HashiNet's team: its admin and managers see and invite it; who may give which role is by rank
  // (access/rank.ts). A business's team comes with its own slice.
  "team.read": PLATFORM_STAFF,
  // Issues: everything that needs someone, worked in each workspace by its own people; operators
  // of a business see what is theirs on Today instead (redesign-admin, Issues).
  "issue.read": [...PLATFORM_ALL, ...BUSINESS_MANAGERS],
  "issue.work": [...PLATFORM_ALL, ...BUSINESS_MANAGERS],
  "team.manage": PLATFORM_STAFF,
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
const NEEDS_PROTECTION: ReadonlySet<Action> = new Set(["voucher.print", "sale.record"]);

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
