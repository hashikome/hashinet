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
  "device.block": BUSINESS_MANAGERS,
  "device.delete": WHOLE_BUSINESS,
  "payment.read": BUSINESS_ALL,
  "sale.record": BUSINESS_ALL,
  "customer.read": BUSINESS_MANAGERS,
  "analytics.read": [...PLATFORM_ALL, ...BUSINESS_MANAGERS],
  "revenue.read": [...PLATFORM_STAFF, ...WHOLE_BUSINESS],
  // The portal: HashiNet's defaults are the platform's (ADR-0011, 3); a business's managers brand
  // their own venues.
  "portal.defaults.read": PLATFORM_ALL,
  "portal.defaults.update": PLATFORM_STAFF,
  "brand.read": BUSINESS_ALL,
  "brand.update": BUSINESS_MANAGERS,
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
