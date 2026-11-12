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
export type NavEntry = NavLink | NavGroup;

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

/** Where a workspace opens. */
export const homeOf = (me: Me) => (me.active.scope === "platform" ? "/businesses" : "/overview");

/**
 * The menu, from what the workspace may do (`capabilities`) and only the screens that exist. Slice 1
 * builds a business's Overview, Vouchers, Payments, its router and Packages, and the platform's
 * Businesses; the prototype's other entries arrive with their slices.
 */
export function navOf(me: Me, venues: VenueRecord[]): NavEntry[] {
  const can = (action: string) => me.active.capabilities.includes(action);
  if (me.active.scope === "platform") {
    return can("business.read")
      ? [{ href: "/businesses", label: "Businesses", icon: "businesses" }]
      : [];
  }
  const top: NavLink[] = [{ href: "/overview", label: "Overview", icon: "overview" }];
  if (can("voucher.read")) top.push({ href: "/vouchers", label: "Vouchers", icon: "vouchers" });
  if (can("payment.read")) top.push({ href: "/payments", label: "Payments", icon: "payments" });
  const entries: NavEntry[] = [...top];
  if (can("router.read") && venues.length > 0) {
    entries.push({
      label: "Manage",
      icon: "manage",
      links: venues.map((v) => ({
        href: `/venues/${v.id}/router`,
        label: venues.length === 1 ? "Routers" : `${v.name}'s router`,
      })),
    });
  }
  if (can("package.read")) {
    entries.push({
      label: "Settings",
      icon: "settings",
      links: [{ href: "/packages", label: "Packages" }],
    });
  }
  return entries;
}
