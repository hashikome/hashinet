import type { SellingPause, ServiceAccess } from "@hashinet/types";

/** A business can't sell while it is read-only or suspended (ADR-0014, 2). */
export const sellingStopped = (access: ServiceAccess) =>
  access === "read_only" || access === "suspended";

/** Why a business can't sell: its overdue bill, or a hold by HashiNet's team; null while it sells. */
export const pauseOf = (b: { access: ServiceAccess; accessHeld: boolean }): SellingPause | null =>
  sellingStopped(b.access) ? (b.accessHeld ? "held" : "overdue") : null;
