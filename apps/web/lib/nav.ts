import type { Me, MembershipRole, VenueRecord } from "@hashinet/types";
import type { IconName } from "@/components/hearth/icons";

export interface NavLink {
  href: string;
  label: string;
  /** A space's own menu (Help, Account and security) is words alone. */
  icon?: IconName;
}
export interface NavGroup {
  label: string;
  icon: IconName;
  links: { href: string; label: string }[];
}
/** A plain heading over the links that follow (Help's areas). */
export interface NavHeading {
  heading: string;
}
export type NavEntry = NavLink | NavGroup | NavHeading;

/** The prototype's names for each role (app.js `roleName`). */
export const ROLE_NAME: Record<MembershipRole, string> = {
  admin: "Admin",
  manager: "Manager",
  operator: "Operator",
  owner: "Owner",
  business_manager: "Business manager",
  venue_manager: "Venue manager",
  venue_operator: "Venue operator",
};

/** Where a workspace opens: the platform's worklist, or the business's Overview. */
export const homeOf = (me: Me) => (me.active.scope === "platform" ? "/issues" : "/overview");

/**
 * The menu, from what the workspace may do (`capabilities`) and only the screens that exist; the
 * prototype's other entries arrive with their slices.
 */
export function navOf(me: Me, venues: VenueRecord[]): NavEntry[] {
  const can = (action: string) => me.active.capabilities.includes(action);
  // Analytics: Usage and Sales, sharing one period (prototype `analytics`).
  const analytics = can("analytics.read")
    ? [
        { href: "/analytics/usage", label: "Usage" },
        { href: "/analytics/sales", label: "Sales" },
      ]
    : [];
  const issues: NavLink[] = can("issue.read")
    ? [{ href: "/issues", label: "Issues", icon: "issues" }]
    : [];
  if (me.active.scope === "platform") {
    const manage = can("business.read")
      ? [
          { href: "/businesses", label: "Businesses" },
          { href: "/venues", label: "Venues" },
          { href: "/routers", label: "Routers" },
        ]
      : [];
    // Operators have a short list with no groups: sections would only add clicks.
    // HashiNet's own Payments: what businesses owe it.
    if (can("billing.overview"))
      issues.push({ href: "/billing", label: "Payments", icon: "payments" });
    if (!can("team.read")) {
      const icons: Record<string, IconName> = {
        "/businesses": "businesses",
        "/venues": "venues",
        "/routers": "routers",
      };
      return [
        ...issues,
        ...analytics.map((l) => ({ ...l, icon: "analytics" as const })),
        ...manage.map((l) => ({ ...l, icon: icons[l.href] })),
      ];
    }
    return [
      ...issues,
      ...(analytics.length
        ? [{ label: "Analytics", icon: "analytics" as const, links: analytics }]
        : []),
      ...(manage.length ? [{ label: "Manage", icon: "manage" as const, links: manage }] : []),
      {
        label: "Platform",
        icon: "platform",
        links: [
          { href: "/team", label: "Team" },
          ...(can("audit.read") ? [{ href: "/audit", label: "Audit log" }] : []),
        ],
      },
      ...(can("fees.read")
        ? [
            {
              label: "Settings",
              icon: "settings" as const,
              links: [
                { href: "/fees", label: "Fees" },
                ...(can("portal.defaults.read")
                  ? [{ href: "/settings/portal", label: "Captive portal" }]
                  : []),
              ],
            },
          ]
        : []),
    ];
  }
  const top: NavLink[] = [{ href: "/overview", label: "Overview", icon: "overview" }];
  if (can("session.read"))
    top.push({ href: "/sessions", label: "Live sessions", icon: "sessions" });
  top.push(...issues);
  if (can("voucher.read")) top.push({ href: "/vouchers", label: "Vouchers", icon: "vouchers" });
  if (can("payment.read")) top.push({ href: "/payments", label: "Payments", icon: "payments" });
  // Owners also pay HashiNet, so they alone have Billing, beside what guests pay them.
  if (can("billing.read")) top.push({ href: "/billing", label: "Billing", icon: "billing" });
  const entries: NavEntry[] = [...top];
  if (analytics.length) entries.push({ label: "Analytics", icon: "analytics", links: analytics });
  // Venues (each venue's page), each venue's router, then the devices the venues have seen.
  const one = venues.length === 1;
  const manage = [
    ...(can("venue.list") ? [{ href: "/venues", label: "Venues" }] : []),
    ...(can("router.read")
      ? venues.map((v) => ({
          href: `/venues/${v.id}/router`,
          label: one ? "Routers" : `${v.name}'s router`,
        }))
      : []),
    ...(can("device.read") ? [{ href: "/devices", label: "Devices" }] : []),
  ];
  if (manage.length) entries.push({ label: "Manage", icon: "manage", links: manage });
  const business = [
    ...(can("team.read") ? [{ href: "/team", label: "Team" }] : []),
    ...(can("audit.read") ? [{ href: "/audit", label: "Audit log" }] : []),
  ];
  if (business.length) entries.push({ label: "Business", icon: "team", links: business });
  const settings = [
    ...(can("business.profile.read") ? [{ href: "/settings/general", label: "General" }] : []),
    ...(can("payment_way.read") ? [{ href: "/settings/payments", label: "Payments" }] : []),
    ...(can("package.read") ? [{ href: "/packages", label: "Packages" }] : []),
    ...(can("brand.read") && can("brand.update")
      ? [{ href: "/settings/portal", label: "Captive portal" }]
      : []),
  ];
  if (settings.length) entries.push({ label: "Settings", icon: "settings", links: settings });
  return entries;
}
