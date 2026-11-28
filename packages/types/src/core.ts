import type { MembershipRole } from "./people.ts";

/** ISO 8601 timestamp in UTC. */
export type Timestamp = string;
/** Decimal amount in whole or fractional TSH, serialised as a string. */
export type DecimalString = string;

/** Every error the API answers with (Better Auth's `/api/auth` routes keep their own shape). */
export interface ApiError {
  /** Stable and machine-readable, such as `VALIDATION_FAILED` or `NOT_FOUND`. */
  code: string;
  message: string;
  /** Field problems for `VALIDATION_FAILED`, keyed by field path; otherwise null. */
  details: Record<string, string> | null;
}

/** Every action the audit log records (ADR-0012): a closed list, each with its own bounded change. */
export const AUDIT_ACTIONS = [
  "membership.switch",
  "membership.role",
  "membership.remove",
  "profile.update",
  "authenticator.remove",
  "authenticator.replace",
  "venue.create",
  "venue.update",
  "venue.delete",
  // Recorded before ways to pay moved to the business; kept so those rows still read.
  "venue.payment_details.update",
  "venue.payment_way.choose",
  "venue.site.add",
  "venue.site.remove",
  "payment_way.create",
  "payment_way.update",
  "payment_way.delete",
  "router.create",
  "router.update",
  "router.delete",
  "router.bootstrap",
  "router.unreachable",
  "router.sync_failed",
  "router.time_given_back",
  "package.create",
  "package.update",
  "package.delete",
  // Recorded before a venue's prices: kept so those rows still read.
  "package.venue.assign",
  "package.venue.unassign",
  "package.venue.set",
  "voucher.read",
  "voucher.refund",
  "voucher.release",
  // Kept for rows recorded before vouchers existed only by their sale (ADR-0017); nothing records them now.
  "voucher.print",
  "voucher.revoke",
  "session.terminate",
  "device.block",
  "device.unblock",
  "device.delete",
  "sale.record",
  "portal.defaults.update",
  "portal.defaults.reset",
  "portal.theme.add",
  "portal.theme.default",
  "portal.theme.remove",
  "portal.business.update",
  "business.profile.update",
  "business.logo.upload",
  "business.logo.remove",
  "portal.business.reset",
  "fees.update",
  "billing.payment",
  "billing.remind",
  "brand.update",
  "brand.reset",
  "brand.image.upload",
  "brand.image.remove",
  "invitation.issue",
  "invitation.resend",
  "invitation.revoke",
  "invitation.accept",
  "business.create",
  "business.access",
  "onboarding.prefer",
  "onboarding.confirm",
  // Slice 3's payments by hand, before invoices; kept for the rows already in the log.
  "onboarding.pay",
  "onboarding.schedule",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditCategory = "change" | "read" | "auth";
export type AuditOutcome = "success" | "no_change" | "failed" | "denied";
/** A bounded before and after: statuses, prices, roles, counts. Never names, emails, codes,
 * tokens or addresses. */
export type AuditChange = Record<string, string | number | boolean | null>;

/** One audit row as the Audit log page shows it. Names are read when answering. */
export interface AuditEntry {
  id: string;
  createdAt: Timestamp;
  actor: { name: string; role: MembershipRole } | null;
  action: AuditAction;
  category: AuditCategory;
  /** `label` names a venue, router, package, business or person; null for everything else. */
  target: { type: string; id: string | null; label: string | null };
  /** Null for HashiNet's own events. */
  business: { id: string; name: string } | null;
  venue: { id: string; name: string } | null;
  outcome: AuditOutcome;
  change: { before: AuditChange; after: AuditChange } | null;
}

export interface AuditList {
  entries: AuditEntry[];
  nextBefore: string | null;
}

/** A device on a router's hotspot right now, as the router reports it. */
export interface LiveClient {
  id: string;
  /** The voucher code the device signed in with. */
  user: string;
  mac: string;
  ip: string;
  uptime: string;
  idleTime: string;
  bytesIn: number;
  bytesOut: number;
}

/**
 * A message on the live socket (`/ws/live`). Hotspot updates reach admins and the managers of
 * that venue; provisioning transcripts reach admins only.
 */
export type LiveMessage =
  | {
      type: "hotspot_update";
      routerId: string;
      routerName: string;
      venueId: string;
      venueName: string;
      timestamp: Timestamp;
      clients: LiveClient[];
    }
  | {
      type: "provision_log";
      event: {
        runId: string;
        seq: number;
        at: Timestamp;
        level: "debug" | "info" | "warn" | "error";
        phase: "connect" | "command" | "step" | "summary";
        scope: string;
        message: string;
        /** The RouterOS command, with secret parameters already redacted (`password=***`). */
        command: string | null;
        params: string[] | null;
        durationMs: number | null;
        outcome: "ok" | "failed" | "unsupported" | "skipped" | null;
      };
    };

/** A business's and a venue's region is chosen from these, never typed. */
export const REGIONS = [
  "Arusha",
  "Dar es Salaam",
  "Dodoma",
  "Geita",
  "Iringa",
  "Kagera",
  "Kaskazini Pemba",
  "Kaskazini Unguja",
  "Katavi",
  "Kigoma",
  "Kilimanjaro",
  "Kusini Pemba",
  "Kusini Unguja",
  "Lindi",
  "Manyara",
  "Mara",
  "Mbeya",
  "Mjini Magharibi",
  "Morogoro",
  "Mtwara",
  "Mwanza",
  "Njombe",
  "Pwani",
  "Rukwa",
  "Ruvuma",
  "Shinyanga",
  "Simiyu",
  "Singida",
  "Songwe",
  "Tabora",
  "Tanga",
] as const;
export type Region = (typeof REGIONS)[number];
