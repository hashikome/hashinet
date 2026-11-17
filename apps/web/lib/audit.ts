import type { AuditAction, AuditChange, AuditEntry, AuditOutcome } from "@hashinet/types";
import type { PillKind } from "@/components/hearth/ui";

export const ACTION_NAME: Record<AuditAction, string> = {
  "membership.switch": "Switched workspace",
  "membership.role": "Changed a role",
  "membership.remove": "Removed from the team",
  "profile.update": "Updated their profile",
  "authenticator.replace": "Replaced their authenticator",
  "venue.create": "Added a venue",
  "venue.update": "Changed a venue",
  "venue.delete": "Removed a venue",
  "venue.payment_details.update": "Changed payment details",
  "router.create": "Added a router",
  "router.update": "Changed a router",
  "router.delete": "Removed a router",
  "router.bootstrap": "Made a router's setup script",
  "router.unreachable": "Router could not be reached",
  "router.push_failed": "Router refused a change",
  "router.sync_failed": "Router could not be brought up to date",
  "package.create": "Added a package",
  "package.update": "Changed a package",
  "package.delete": "Took a package off sale",
  "package.venue.assign": "Put a package on sale at a venue",
  "package.venue.unassign": "Took a package off sale at a venue",
  "voucher.read": "Looked at voucher codes",
  "voucher.refund": "Refunded a voucher",
  "voucher.release": "Released a voucher",
  "voucher.print": "Printed vouchers",
  "voucher.revoke": "Revoked a voucher",
  "voucher.provision_failed": "Router did not take a voucher",
  "voucher.provision_recovered": "Router took a voucher on retry",
  "session.terminate": "Ended a session",
  "device.block": "Blocked a device",
  "device.unblock": "Unblocked a device",
  "device.delete": "Removed a device",
  "sale.record": "Sold a voucher",
  "portal.defaults.update": "Changed the portal's defaults",
  "brand.update": "Changed a venue's branding",
  "brand.reset": "Restored a venue's default branding",
  "brand.image.upload": "Uploaded a logo or picture",
  "brand.image.remove": "Removed a logo or picture",
  "invitation.issue": "Sent an invitation",
  "invitation.resend": "Sent an invitation again",
  "invitation.revoke": "Revoked an invitation",
  "invitation.accept": "Accepted an invitation",
  "business.create": "Started a business",
  "onboarding.prefer": "Chose how the router comes",
  "onboarding.confirm": "Confirmed a venue's package",
  "onboarding.pay": "Recorded a package's payment",
  "onboarding.schedule": "Scheduled a setup",
};

export const OUTCOME: Record<AuditOutcome, [string, PillKind]> = {
  success: ["Success", "ok"],
  no_change: ["No change", "neutral"],
  failed: ["Failed", "bad"],
  denied: ["Denied", "bad"],
};

/** What a target without a name is called: its kind. */
const KIND: Record<string, string> = {
  voucher: "A voucher",
  device: "A device",
  session: "A session",
  payment: "A payment",
  invitation: "An invitation",
  portal: "The portal",
  user: "Their account",
  voucher_batch: "A batch of vouchers",
};

export const targetOf = (e: AuditEntry) => e.target.label ?? KIND[e.target.type] ?? e.target.type;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "status: unused → refunded", one line per field that changed; an id means nothing to a reader. */
export const changeLines = (e: AuditEntry): string[] => {
  if (e.change === null) return [];
  const { before, after } = e.change;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const value = (side: AuditChange, k: string) => (k in side ? side[k] : null) ?? null;
  const shown = (v: string | number | boolean | null) =>
    v === null ? "none" : String(v).replaceAll("_", " ");
  return keys
    .filter((k) => ![value(before, k), value(after, k)].some((v) => UUID.test(String(v))))
    .map((k) => `${k}: ${shown(value(before, k))} → ${shown(value(after, k))}`);
};
