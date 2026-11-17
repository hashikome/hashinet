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
    if (!can("team.read")) {
      const icons: Record<string, IconName> = {
        "/businesses": "businesses",
        "/venues": "venues",
        "/routers": "routers",
      };
      return [...issues, ...manage.map((l) => ({ ...l, icon: icons[l.href] }))];
    }
    return [
      ...issues,
      ...(manage.length ? [{ label: "Manage", icon: "manage" as const, links: manage }] : []),
      {
        label: "Platform",
        icon: "platform",
        links: [
          { href: "/team", label: "Team" },
          ...(can("audit.read") ? [{ href: "/audit", label: "Audit log" }] : []),
        ],
      },
    ];
  }
  const top: NavLink[] = [{ href: "/overview", label: "Overview", icon: "overview" }];
  if (can("session.read"))
    top.push({ href: "/sessions", label: "Live sessions", icon: "sessions" });
  top.push(...issues);
  if (can("voucher.read")) top.push({ href: "/vouchers", label: "Vouchers", icon: "vouchers" });
  if (can("payment.read")) top.push({ href: "/payments", label: "Payments", icon: "payments" });
  const entries: NavEntry[] = [...top];
  // Each venue's page (its payment details) and its router, then the devices the venues have seen.
  const one = venues.length === 1;
  const manage = [
    ...(can("router.read")
      ? venues.flatMap((v) => [
          ...(can("payment_details.read")
            ? [{ href: `/venues/${v.id}`, label: one ? "Venue" : v.name }]
            : []),
          { href: `/venues/${v.id}/router`, label: one ? "Routers" : `${v.name}'s router` },
        ])
      : []),
    ...(can("device.read") ? [{ href: "/devices", label: "Devices" }] : []),
  ];
  if (manage.length) entries.push({ label: "Manage", icon: "manage", links: manage });
  const business = [
    ...(can("team.read") ? [{ href: "/team", label: "Team" }] : []),
    ...(can("audit.read") ? [{ href: "/audit", label: "Audit log" }] : []),
  ];
  if (business.length) entries.push({ label: "Business", icon: "team", links: business });
  if (can("package.read")) {
    entries.push({
      label: "Settings",
      icon: "settings",
      links: [{ href: "/packages", label: "Packages" }],
    });
  }
  return entries;
}
