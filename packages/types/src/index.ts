// The API's JSON contract, shared by the API and its clients. Framework-free: no runtime
// code, no Prisma or ORM types. JSON carries decimals as strings, timestamps as ISO 8601
// strings, and an absent value as `null`, never `undefined`.

/** ISO 8601 timestamp in UTC. */
export type Timestamp = string;
/** Decimal amount in whole or fractional TSH, serialised as a string. */
export type DecimalString = string;

// `pending_activation`: redeemed, but the router has not yet confirmed the hotspot user.
// Nothing treats it as usable until the router read-back succeeds.
export type VoucherStatus =
  | "unused"
  | "pending_activation"
  | "active"
  | "expired"
  | "used"
  | "revoked";

export interface PackageRecord {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  downloadSpeedMbps: number;
  uploadSpeedMbps: number | null;
  dataLimitGb: number | null;
  deviceLimit: number;
  priceTsh: DecimalString;
  features: string[];
  isActive: boolean;
  throttledDownloadMbps: number | null;
  throttledUploadMbps: number | null;
  peakStartHour: number | null;
  peakEndHour: number | null;
  throttleAfterGb: number | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface VoucherRecord {
  id: string;
  batchId: string | null;
  packageId: string | null;
  venueId: string | null;
  /** The device that redeemed it. */
  redeemedByDeviceId: string | null;
  code: string;
  status: VoucherStatus;
  dataLimitGb: number | null;
  dataUsedBytes: number;
  /** Whole minutes; null inherits the package's. */
  durationMinutes: number | null;
  priceTsh: DecimalString;
  activatedAt: Timestamp | null;
  expiresAt: Timestamp | null;
  revokedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** `GET /api/vouchers` row. */
export interface VoucherListItem extends VoucherRecord {
  packageName: string | null;
  venueName: string | null;
}

/** `GET /api/vouchers`: newest first, a page at a time. */
export interface VoucherList {
  vouchers: VoucherListItem[];
  /** Pass as `before` for the next page; null on the last page. */
  nextBefore: string | null;
}

/** A batch of vouchers made together, usually for printing. */
export interface VoucherBatchRecord {
  id: string;
  venueId: string | null;
  venueName: string | null;
  packageId: string | null;
  packageName: string | null;
  createdById: string | null;
  quantity: number;
  /** The date by which its cards must be used, or null. */
  expiresAt: Timestamp | null;
  createdAt: Timestamp;
  /** How many of its vouchers are in each status. */
  counts: Record<VoucherStatus, number>;
}

/** `GET /api/vouchers/batches`. */
export interface VoucherBatchList {
  batches: VoucherBatchRecord[];
}

/** A voucher with what its printed card shows. */
export interface PrintableVoucher extends VoucherListItem {
  downloadSpeedMbps: number | null;
  uploadSpeedMbps: number | null;
  /** How many devices it serves at once, from its package. */
  deviceLimit: number;
}

/** `GET /api/vouchers/batches/:id` and `POST /api/vouchers/batches`: a batch and its cards. */
export interface VoucherBatchDetail {
  batch: VoucherBatchRecord;
  vouchers: PrintableVoucher[];
}

/** `POST /api/vouchers/revoke`. */
export interface RevokeResult {
  /** Vouchers revoked now; ones already finished are left as they were. */
  revoked: number;
}

/**
 * The captive portal's wording, colours and voucher defaults (`GET` and `PUT /api/portal`).
 * There are no uploaded images: HashiNet's logo ships with the web. Until an admin saves, the
 * API answers with its defaults and `updatedAt` is null.
 */
export interface PortalSettingsRecord {
  brandName: string;
  headline: string;
  message: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  radius: number;
  voucherLabel: string;
  voucherHelp: string;
  ticketTitle: string;
  ticketFooter: string;
  requireTerms: boolean;
  isActive: boolean;
  /** When an admin last saved it; null while the defaults apply. */
  updatedAt: Timestamp | null;
}

/** What a venue shows: its own branding, or the HashiNet default. */
export interface BrandRecord extends PortalSettingsRecord {
  /** Served from the portal's own origin; null shows HashiNet's logo. */
  logoUrl: string | null;
  backgroundUrl: string | null;
}

/** `GET`, `PUT` and `DELETE /api/venues/:id/brand`. */
export interface VenueBrandResponse {
  brand: BrandRecord;
  /** False while the venue shows the HashiNet default. */
  isCustom: boolean;
}

/** `POST /api/vouchers/print`: chosen vouchers with what their cards show. */
export interface PrintableVouchersResponse {
  vouchers: PrintableVoucher[];
}

export interface PortalSettingsResponse {
  settings: PortalSettingsRecord;
}

/** One of the person's memberships, for the account menu's workspaces. */
export interface MembershipSummary {
  id: string;
  scope: MembershipScope;
  role: MembershipRole;
  /** Null for the platform. */
  business: { id: string; name: string } | null;
}

/**
 * How far the session may act (ADR-0011, 9): `full`; `setup`, an owner or manager in their first
 * 7 days before protecting their sign-in, who may get set up but not sell or serve; or `account`,
 * Account and security only.
 */
export type AccessLevel = "full" | "setup" | "account";

/** The signed-in person (`GET /api/me`): who they are, their workspaces, and what the active one
 * allows. The web draws navigation and buttons from `capabilities`, never from the role. */
/** A business as HashiNet's team lists it (`GET /api/businesses`). */
export interface BusinessSummary {
  id: string;
  name: string;
  region: Region;
  area: string;
  /** Its owner, once the invitation is accepted. */
  owner: { name: string; email: string } | null;
  venues: { id: string; name: string; routers: number }[];
  /** Across its routers: the worst of them, or setting up while none has served. */
  condition: RouterCondition;
  createdAt: Timestamp;
}

/** `GET /api/businesses`. */
export interface BusinessList {
  businesses: BusinessSummary[];
}

export type IssueKind = "router_offline" | "venue_package" | "venue_setup";
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
  holder: IssuePerson | null;
  /** The reader holds it. */
  mine: boolean;
  /** Claim: nobody holds it. */
  canClaim: boolean;
  /** Take over: someone below the reader holds it. */
  canTakeOver: boolean;
  /** Held with no activity for a day: flagged, never released by itself. */
  stalled: boolean;
  /** Bounded facts its kind needs. */
  data: Record<string, string | number | boolean | null>;
  openedAt: Timestamp;
  resolvedAt: Timestamp | null;
  lastActivityAt: Timestamp;
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
  }[];
  handTo: IssuePerson[];
}

/** How the dashboard looks; `system` follows the device. */
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export interface Me {
  id: string;
  email: string;
  name: string;
  /** Kept per person, so it follows them in every workspace and on every device. */
  theme: ThemePreference;
  memberships: MembershipSummary[];
  active: MembershipSummary & {
    /** The venues of a venue manager or operator; null when the role reaches every venue. */
    venueIds: string[] | null;
    access: AccessLevel;
    capabilities: string[];
  };
  protection: {
    /** Platform staff, owners and managers must protect their sign-in. */
    required: boolean;
    authenticator: boolean;
    passkeys: number;
    /** While `access` is `setup`: when the 7 days to get set up without protection end. */
    setupEndsAt: Timestamp | null;
    /**
     * Until when this session's proof holds: removing a passkey, new recovery codes or replacing
     * the authenticator ask for proof first after it. Null when it has none.
     */
    provedUntil: Timestamp | null;
    /** Whether a change to protection, or adding to it, asks for proof first now. */
    proofNeeded: { change: boolean; add: boolean };
  };
}

/** Every error the API answers with (Better Auth's `/api/auth` routes keep their own shape). */
export interface ApiError {
  /** Stable and machine-readable, such as `VALIDATION_FAILED` or `NOT_FOUND`. */
  code: string;
  message: string;
  /** Field problems for `VALIDATION_FAILED`, keyed by field path; otherwise null. */
  details: Record<string, string> | null;
}

export type VenueStatus = "active" | "inactive" | "maintenance";

export interface VenueRecord {
  id: string;
  name: string;
  /** Host names guests can open before paying. */
  allowedSites: string[];
  businessId: string;
  region: Region;
  /** The area or street, as the owner types it. */
  area: string;
  status: VenueStatus;
  routerCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** `GET /api/venues`. */
export interface VenueList {
  venues: VenueRecord[];
}

/** `GET` and `PUT /api/venues/:id`, and `POST /api/venues`. */
export interface VenueResponse {
  venue: VenueRecord;
}

export type RouterStatus = "online" | "offline" | "provisioning" | "error";

/** A router as the API shows it. Credentials and tunnel keys never leave the API. */
export interface RouterRecord {
  id: string;
  venueId: string;
  venueName: string;
  name: string;
  model: string | null;
  identity: string | null;
  /** The router's address on its venue LAN. */
  ipAddress: string;
  hotspotGatewayIp: string | null;
  macAddress: string | null;
  apiUsername: string | null;
  /** Whether an API password is stored; the password itself is never returned. */
  hasApiPassword: boolean;
  enableHotspot: boolean;
  hotspotName: string | null;
  hotspotInterface: string | null;
  ssid: string | null;
  networkRange: string | null;
  /**
   * Extra RouterOS commands run at provisioning. Admins only: null for managers, since it may
   * hold credentials.
   */
  provisioningCommand: string | null;
  /** The router's address in the management tunnel, once allocated. */
  tunnelAddress: string | null;
  rosVersion: string | null;
  architecture: string | null;
  provisionedAt: Timestamp | null;
  lastSeenAt: Timestamp | null;
  uptimeSeconds: number;
  connectedDevices: number;
  status: RouterStatus;
  /** What the owner does next with this router. */
  stage: RouterStage;
  condition: RouterCondition;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Where a router stands in the owner's journey: what to do next. */
export type RouterStage = "connect" | "set-up" | "serving";

/**
 * How a router, or a business across its routers, is doing, as every page says it: being set up
 * until it first serves; then serving, offline, or needing attention (an error).
 */
export type RouterCondition = "setting-up" | "serving" | "offline" | "needs-attention";

export type RouterSetupPhaseStatus = "pending" | "running" | "pass" | "warn" | "fail" | "skipped";

export interface RouterSetupPhase {
  id: string;
  title: string;
  status: RouterSetupPhaseStatus;
  detail: string | null;
}

/** `POST /api/routers/:id/verify`: the router's health, check by check. */
export interface RouterChecks {
  /** False when something proves the hotspot is not serving. */
  ok: boolean;
  checks: {
    id: string;
    title: string;
    status: "pass" | "warn" | "fail" | "skipped";
    detail: string;
    /** What to do about it, when there is something to do. */
    fix?: string;
  }[];
  /** What a machine cannot prove: it still needs a phone. */
  manual: string[];
  summary: { pass: number; warn: number; fail: number; skipped: number };
}

/** `GET /api/routers/:id/journey`, and the answer to starting a setup. */
export interface RouterJourney {
  stage: RouterStage;
  /** Whether the API has reached the router recently. */
  connected: boolean;
  running: boolean;
  /** A run stopped by a restart, not by the router. */
  interrupted: boolean;
  /** The last finished run's outcome, or null before the first. */
  ok: boolean | null;
  finishedAt: Timestamp | null;
  phases: RouterSetupPhase[];
  /** What stopped the last run, and how to fix it. */
  blockers: { reason: string; fix: string | null }[];
}

/** `GET /api/routers`. */
export interface RouterList {
  routers: RouterRecord[];
}

/** `GET` and `PUT /api/routers/:id`, `POST /api/routers`, and `POST /api/routers/:id/sync`. */
export interface RouterResponse {
  router: RouterRecord;
}

/** `GET /api/routers/provisioning-backlog`: guests waiting on a router, in the caller's venues. */
export interface ProvisioningBacklog {
  stuckVouchers: number;
  unprovisionedPayments: number;
}

/**
 * `POST /api/routers/:id/bootstrap-script`. Carries the router's API password, the one response
 * that does: it has to be typed into the router.
 */
export interface BootstrapScriptResponse {
  script: string;
  warnings: string[];
  resolved: {
    routerName: string;
    ipAddress: string;
    lanCidr: string;
    gatewayIp: string;
    apiUsername: string;
    apiPassword: string;
    apiPort: number;
    ssid: string;
    apiPasswordGenerated: boolean;
  };
  /** Whether the script opens the management tunnel. */
  tunnel: boolean;
}

/** `GET /api/packages`: the packages on sale, each with where it sells. */
export interface PackageList {
  packages: (PackageRecord & {
    /** The venues it is sold at; empty means every venue. */
    venueIds: string[];
  })[];
}

/** `GET` and `PUT /api/packages/:id`, and `POST /api/packages`. */
export interface PackageResponse {
  package: PackageRecord;
}

/** `GET /api/venues/:venueId/packages`: what the venue sells. */
export interface VenuePackages {
  /** The active packages on sale at the venue. */
  packages: PackageRecord[];
  /** The packages assigned to the venue, active or not. */
  assignedPackageIds: string[];
  /** True when the venue has no assignments, and so sells every active package. */
  sellsAll: boolean;
}

export type DeviceStatus = "active" | "blocked";

/**
 * A guest device: one MAC address the network saw. Not a person, so it carries no name, phone
 * or email of its owner. Usage and online state count only the caller's venues.
 */
export interface DeviceRecord {
  id: string;
  macAddress: string;
  lastIpAddress: string | null;
  /** The name the device reported, such as a phone's host name. */
  deviceName: string | null;
  deviceType: string | null;
  status: DeviceStatus;
  /** Connected now, and not blocked. */
  isOnline: boolean;
  downloadBytes: number;
  uploadBytes: number;
  firstSeenAt: Timestamp;
  lastActiveAt: Timestamp | null;
}

/** `GET /api/devices`: newest first, a page at a time, with counts over every match. */
export interface DeviceList {
  devices: DeviceRecord[];
  nextBefore: string | null;
  stats: { total: number; online: number; offline: number; blocked: number };
}

/** `GET /api/devices/:id` and `PUT /api/devices/:id/status`. */
export interface DeviceResponse {
  device: DeviceRecord;
}

export type SessionStatus = "connected" | "disconnected" | "expired" | "terminated";

/** One stay of a device on a venue's network, under one voucher. */
export interface SessionRecord {
  id: string;
  status: SessionStatus;
  deviceId: string | null;
  macAddress: string;
  ipAddress: string | null;
  deviceName: string | null;
  deviceType: string | null;
  voucherId: string | null;
  voucherCode: string | null;
  packageId: string | null;
  packageName: string | null;
  venueId: string | null;
  venueName: string | null;
  routerId: string | null;
  routerName: string | null;
  startedAt: Timestamp;
  endedAt: Timestamp | null;
  durationSeconds: number;
  uploadBytes: number;
  downloadBytes: number;
  uploadSpeedMbps: DecimalString | null;
  downloadSpeedMbps: DecimalString | null;
  signalStrengthDbm: number | null;
  isThrottled: boolean;
  terminationReason: string | null;
}

/** `GET /api/sessions`: newest first, a page at a time, with totals over every match. */
export interface SessionList {
  sessions: SessionRecord[];
  nextBefore: string | null;
  stats: { total: number; connected: number; uploadBytes: number; downloadBytes: number };
}

/** `GET /api/sessions/:id` and `POST /api/sessions/:id/terminate`. */
export interface SessionResponse {
  session: SessionRecord;
}

/** A business month in Africa/Dar_es_Salaam, as YYYY-MM. */
export type BusinessMonth = string;
/** A business day in Africa/Dar_es_Salaam, as YYYY-MM-DD. */
export type BusinessDay = string;

/**
 * How money came in: mobile money, a card payment, or cash (a staff-recorded cash sale, or a
 * printed voucher sold for cash, counted when the router confirms it).
 */
export type RevenueSource = "mobile_money" | "card" | "cash";

/** `GET /api/analytics/summary`, over the caller's venues. */
export interface AnalyticsSummary {
  activeSessions: number;
  totalSessions: number;
  devices: number;
  weeklyUploadBytes: number;
  weeklyDownloadBytes: number;
  allTimeUploadBytes: number;
  allTimeDownloadBytes: number;
  /** This business month's revenue; null for managers, who are not shown revenue. */
  revenueThisMonthTsh: DecimalString | null;
}

/**
 * `GET /api/analytics/today` (a business's own): today so far, by the Dar es Salaam day, over the
 * caller's venues or one of them. Sales follow the one definition of revenue.
 */
export interface TodaySummary {
  day: BusinessDay;
  /** Devices connected now. */
  onlineNow: number;
  sold: number;
  takingsTsh: DecimalString;
  /** The same weekday a week ago, up to this time of day, to compare with. */
  lastWeekTakingsTsh: DecimalString;
  /** Every package sold today, the most sold first. */
  byPackage: {
    packageId: string | null;
    name: string | null;
    sold: number;
    takingsTsh: DecimalString;
  }[];
}

/** `GET /api/analytics/daily-usage`: every business day in the range, including empty ones. */
export interface DailyUsage {
  days: {
    date: BusinessDay;
    uploadBytes: number;
    downloadBytes: number;
    /** Null for managers. */
    revenueTsh: DecimalString | null;
  }[];
}

/** `GET /api/analytics/monthly` (admins): the last six business months, oldest first. */
export interface MonthlyTrend {
  months: { month: BusinessMonth; revenueTsh: DecimalString; newDevices: number }[];
}

export interface Share {
  count: number;
  /** Whole percent of the total. */
  percentage: number;
}

/** `GET /api/analytics/packages`: active vouchers by package, in the caller's venues. */
export interface PackageShares {
  packages: (Share & { packageId: string | null; packageName: string | null })[];
}

/** `GET /api/analytics/devices`: devices by the type they reported, in the caller's venues. */
export interface DeviceTypeShares {
  types: (Share & { type: string })[];
}

/** `GET /api/analytics/venues` (admins): the ten venues with the most revenue. */
export interface TopVenues {
  venues: { venueId: string; venueName: string; devices: number; revenueTsh: DecimalString }[];
}

/** `GET /api/revenue/summary` (admins). Revenue is paid payments plus confirmed cash vouchers. */
export interface RevenueSummary {
  month: BusinessMonth;
  today: DecimalString;
  thisMonth: DecimalString;
  lastMonth: DecimalString;
  allTime: DecimalString;
  /** Whole percent against the month before, or null when that month had none. */
  monthGrowthPct: number | null;
  bySource: Record<RevenueSource, { allTime: DecimalString; month: DecimalString }>;
}

/** `GET /api/revenue/by-package` (admins). */
export interface RevenueByPackage {
  month: BusinessMonth;
  packages: {
    packageId: string | null;
    packageName: string | null;
    revenueTsh: DecimalString;
    sales: number;
  }[];
}

/** `GET /api/revenue/by-venue` (admins). */
export interface RevenueByVenue {
  month: BusinessMonth;
  venues: { venueId: string | null; venueName: string | null; revenueTsh: DecimalString }[];
}

/**
 * `GET /api/payments/received` (a business's own): what guests paid in a month, by the one
 * definition of revenue: every sale recorded or paid online, and every printed voucher once a
 * guest used it. Newest first, a page at a time.
 */
export interface PaymentsReceived {
  month: BusinessMonth;
  /** Whether `month` is this month, so its figures are "so far". */
  current: boolean;
  /** This month and the months with payments, newest first, for choosing another. */
  months: BusinessMonth[];
  totalTsh: DecimalString;
  count: number;
  payments: {
    id: string;
    source: RevenueSource;
    /** A sale recorded or paid online, or a printed voucher a guest used. */
    kind: "sale" | "printed";
    amountTsh: DecimalString;
    packageName: string | null;
    venueName: string | null;
    /** The provider's reference for a mobile-money payment. Never a phone. */
    reference: string | null;
    occurredAt: Timestamp;
  }[];
  /** Pass as `before` for the next page; null on the last. */
  nextBefore: string | null;
}

/** `GET /api/revenue/transactions` (admins): the month's latest 50. */
export interface RevenueTransactions {
  month: BusinessMonth;
  transactions: {
    id: string;
    source: RevenueSource;
    amountTsh: DecimalString;
    packageName: string | null;
    venueName: string | null;
    /** The provider's reference for a payment; null for a printed card. Never a phone. */
    reference: string | null;
    occurredAt: Timestamp;
  }[];
}

/** Every action the audit log records (ADR-0012): a closed list, each with its own bounded change. */
export const AUDIT_ACTIONS = [
  "membership.switch",
  "membership.role",
  "membership.remove",
  "profile.update",
  "authenticator.replace",
  "venue.create",
  "venue.update",
  "venue.delete",
  "router.create",
  "router.update",
  "router.delete",
  "router.bootstrap",
  "router.unreachable",
  "router.push_failed",
  "router.sync_failed",
  "package.create",
  "package.update",
  "package.delete",
  "package.venue.assign",
  "package.venue.unassign",
  "voucher.read",
  "voucher.print",
  "voucher.revoke",
  "voucher.provision_failed",
  "voucher.provision_recovered",
  "session.terminate",
  "device.block",
  "device.unblock",
  "device.delete",
  "sale.record",
  "portal.defaults.update",
  "brand.update",
  "brand.reset",
  "brand.image.upload",
  "brand.image.remove",
  "invitation.issue",
  "invitation.resend",
  "invitation.revoke",
  "invitation.accept",
  "business.create",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditCategory = "change" | "read" | "auth";
export type AuditOutcome = "success" | "no_change" | "failed" | "denied";
/** A bounded before and after: statuses, prices, roles, counts. Never names, emails, codes,
 * tokens or addresses. */
export type AuditChange = Record<string, string | number | boolean | null>;

/** One audit row as the Audit log page shows it; labels are read when answering. */
export interface AuditEntry {
  id: string;
  createdAt: Timestamp;
  actor: { name: string; role: MembershipRole } | null;
  action: AuditAction;
  category: AuditCategory;
  target: { type: string; id: string | null; label: string | null };
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

/** What the portal page shows a guest: `POST /api/guest/context`. */
export interface GuestContext {
  venueName: string;
  /** Whether guests can buy here; until then the portal is for vouchers. */
  mobileMoney: boolean;
  settings: Pick<
    BrandRecord,
    | "brandName"
    | "headline"
    | "message"
    | "primaryColor"
    | "accentColor"
    | "backgroundColor"
    | "radius"
    | "voucherLabel"
    | "voucherHelp"
    | "requireTerms"
    | "logoUrl"
    | "backgroundUrl"
  >;
  /** What this venue sells, for reading; buying arrives with payments. */
  packages: {
    id: string;
    name: string;
    durationMinutes: number;
    priceTsh: DecimalString;
    downloadSpeedMbps: number;
    dataLimitGb: number | null;
    /** Whether a guest can buy it here with mobile money. */
    payable: boolean;
  }[];
}

/** `POST /api/guest/redeem`: the router reports the device online on this voucher. */
export interface RedeemResult {
  /** Where to go now the device is online, when it was a safe web address. */
  dst: string | null;
  expiresAt: Timestamp | null;
}

/** `GET /api/capabilities`: each is on once its provider's credentials are set. */
export interface Capabilities {
  mobileMoney: boolean;
  sms: boolean;
}

export type SmsDelivery = "sending" | "sent" | "delivered" | "failed" | "unconfirmed";

/** `POST /api/guest/payments`: `secret` proves this session paid, and is shown nowhere else. */
export interface GuestPaymentStarted {
  paymentId: string;
  secret: string;
}

/** `POST /api/guest/payments/status`: what the session that paid sees. */
export interface GuestPaymentStatus {
  state: "pending" | "paid" | "failed";
  /** Until the voucher ends. */
  code: string | null;
  expiresAt: Timestamp | null;
  /** The router reports this device online, on a voucher still running. */
  online: boolean;
  /** The voucher has run out: this purchase is over, and the guest can buy again. */
  ended: boolean;
  /** Paid, but the router has not confirmed yet: HashiNet keeps trying. */
  owed: boolean;
  sms: SmsDelivery | null;
  dst: string | null;
}

/** `GET /api/payments`. */
export interface PaymentRecord {
  id: string;
  phone: string | null;
  amountTsh: DecimalString;
  provider: "cash" | "mobile_money" | "card" | "manual";
  status: "pending" | "paid" | "failed" | "refunded" | "cancelled";
  packageName: string | null;
  venueName: string | null;
  createdAt: Timestamp;
  paidAt: Timestamp | null;
  owed: boolean;
  provisionError: string | null;
  sms: SmsDelivery | null;
}

export interface PaymentList {
  payments: PaymentRecord[];
}

/** `GET /api/customers`: people who have paid, within the staff member's venues. */
export interface CustomerRecord {
  id: string;
  phone: string;
  payments: number;
  totalTsh: DecimalString;
  lastPaidAt: Timestamp | null;
}

export interface CustomerList {
  customers: CustomerRecord[];
}

/** `POST /api/sales`: staff read this code out, or print it. */
export interface SaleResult {
  paymentId: string;
  code: string;
  routerConfirmed: boolean;
  sms: SmsDelivery | null;
}

/** `POST /api/guest/session`: a device's time and data, for the router's status pages. */
export interface GuestSession {
  active: boolean;
  time: { unlimited: boolean; secondsRemaining: number | null; expiresAt: Timestamp | null } | null;
  data: {
    unlimited: boolean;
    usedBytes: number;
    limitBytes: number | null;
    remainingBytes: number | null;
  } | null;
}

/** Tanzania's 31 regions: a business's and a venue's region is chosen from these, never typed. */
/**
 * Voucher codes are 12 digits (ADR-0008), printed and read aloud in three groups of four, stored
 * without spaces.
 */
export const CODE_LENGTH = 12;

/** "4827 1693 6518": a code in the three groups it is printed and read aloud in. */
export function groupedCode(code: string): string {
  return code.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** A code as someone typed or printed it ("4827 1693 6518"), in the form it is stored. */
export function normalCode(typed: string): string {
  return typed.replace(/[\s-]/g, "");
}

/** The lowest price of a package, and so of a voucher, in whole shillings. */
export const MINIMUM_PRICE_TSH = 500;

/** How long proving it's you lets someone change their sign-in without asking again. */
export const PROOF_HOURS = 2;

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

/** Where a membership acts, and its role there (ADR-0011). */
export type MembershipScope = "platform" | "business";
export type PlatformRole = "admin" | "manager" | "operator";
export type BusinessRole = "owner" | "business_manager" | "venue_manager" | "venue_operator";
export type MembershipRole = PlatformRole | BusinessRole;

/** A pending invitation, as the platform's Businesses page lists it (business-scopes M3). */
export interface InvitationRecord {
  id: string;
  email: string;
  scope: MembershipScope;
  role: MembershipRole;
  /** Null for a new business's owner and for a platform role. */
  businessId: string | null;
  invitedBy: string | null;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

export interface InvitationList {
  invitations: InvitationRecord[];
}

/** What the invitation page shows before anything is entered: never a business or a person. */
export interface InvitationPreview {
  email: string;
  /** Starting a new business, or joining HashiNet's team in `role`. */
  kind: "business_owner" | "platform_member";
  /** For a platform member: the role offered. */
  role: MembershipRole | null;
  expiresAt: Timestamp;
}

/** Accepting an invitation to HashiNet's team: the invitee's name, nothing else. */
export interface AcceptMemberInvitation {
  token: string;
  person: { name: string };
}

/** One person on a team, as its Team page lists them. */
export interface TeamMember {
  membershipId: string;
  name: string;
  email: string;
  role: MembershipRole;
  joinedAt: Timestamp;
  /** When they last worked in this workspace; null if never yet. */
  lastUsedAt: Timestamp | null;
  /** Whether the reader may change their role or remove them (by rank, ADR-0011, 6). */
  manageable: boolean;
}

/** `GET /api/team`: the reader's team and its pending invitations. */
export interface TeamList {
  members: TeamMember[];
  invitations: InvitationRecord[];
  /** The roles the reader may invite, give or take away. */
  assignable: MembershipRole[];
}

/** Accepting an invitation to start a business: three steps, saved only at the last. */
export interface AcceptBusinessInvitation {
  token: string;
  person: { name: string; phone: string };
  business: { name: string; region: Region; area: string };
  venue: { name: string; region: Region; area: string };
}

/** After accepting, the person signs in with a code like everyone; nothing signs them in here. */
export interface AcceptedInvitation {
  email: string;
  /** The new business, for an owner; null for HashiNet's team. */
  businessId: string | null;
}
