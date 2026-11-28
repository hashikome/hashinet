import type { DecimalString, Timestamp } from "./core.ts";

// A voucher exists only by its sale (ADR-0017): `unused` is sold and not used yet.
// `pending_activation`: redeemed, but the router has not yet confirmed the hotspot user.
// Nothing treats it as usable until the router read-back succeeds. `refunded`: its price went back
// while it was unused, and it no longer works.
export type VoucherStatus =
  | "unused"
  | "pending_activation"
  | "active"
  | "expired"
  | "used"
  | "refunded";

export interface VoucherRecord {
  id: string;
  packageId: string | null;
  venueId: string | null;
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
  refundedAt: Timestamp | null;
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
  /** When its voucher's time runs out; null for one with no end. */
  voucherExpiresAt: Timestamp | null;
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

export type SmsDelivery = "sending" | "sent" | "delivered" | "failed" | "unconfirmed";

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
  /** Whether the code is texted to the guest's number: a number was given and SMS is on. */
  texted: boolean;
}

/**
 * Voucher codes are 12 digits (ADR-0008), printed and read aloud in three groups of four, stored
 * without spaces.
 */
export const CODE_LENGTH = 12;

/** "4827 1693 6518": a code in the three groups it is printed and read aloud in. */
export function groupedCode(code: string): string {
  return code.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/**
 * What a voucher's QR code holds: the venue's WiFi, as phone cameras read a WiFi QR code. Scanning
 * it offers to join; with no internet yet the phone opens the portal, and the guest types the code.
 * A guest network has no password (`nopass`); `\ ; , : "` in a name are escaped.
 */
export function wifiQrCode(wifiName: string): string {
  return `WIFI:T:nopass;S:${wifiName.replace(/([\\;,:"])/g, "\\$1")};;`;
}

/** A code as someone typed or printed it ("4827 1693 6518"), in the form it is stored. */
export function normalCode(typed: string): string {
  return typed.replace(/[\s-]/g, "");
}
