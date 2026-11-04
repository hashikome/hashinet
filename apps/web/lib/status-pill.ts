import type { VoucherStatus } from "@hashifi/types";

/**
 * One palette for every status pill in the admin. Three meanings, each defined once for both themes,
 * with an inset ring so a chip has an edge on any surface. Pass one as `className` on a `<Badge>`.
 */
export const statusPill = {
  /** Alive: online, active, paid, connected. Ember means this and nothing else. */
  success: "bg-primary/15 text-ember ring-1 ring-inset ring-primary/30",
  /** Needs a human: failed, suspended, revoked. */
  danger: "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20",
  /** Everything else: pending, finished, closed. */
  neutral: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
} as const;

export function voucherStatusPill(status: VoucherStatus): string {
  if (status === "active") return statusPill.success;
  if (status === "revoked") return statusPill.danger;
  return statusPill.neutral;
}
