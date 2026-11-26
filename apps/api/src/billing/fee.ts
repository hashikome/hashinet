import type { FeeTerms } from "@hashinet/types";

/**
 * HashiNet's fee rules (ADR-0013, 3; ADR-0017, 9), pure so they are tested on their own. Money is
 * whole shillings; each venue's fee is rounded once, to the nearest shilling.
 */

/**
 * The fee on a venue's net sales in a month, by marginal bands: `rateBp` up to `lowerRateAboveTsh`,
 * `lowerRateBp` on the part above, so selling one more voucher never raises the rate. Net sales
 * below zero (a month refunding more than it sold) pay nothing.
 */
export function feeOnSales(netSalesTsh: number, terms: FeeTerms): number {
  const sales = Math.max(0, netSalesTsh);
  const lower = Math.min(sales, terms.lowerRateAboveTsh);
  const upper = sales - lower;
  return Math.round((lower * terms.rateBp + upper * terms.lowerRateBp) / 10_000);
}

/** A venue's month, as far as its fee goes. */
export interface VenueMonth {
  netSalesTsh: number;
  /**
   * The share of the month a router served it, from 0 to 1; null when the minimum does not apply
   * at all (before the first full month after its setup, or with no router set up).
   */
  servedShare: number | null;
}

/** What a venue owes for a month, and the minimum when that is what set it. */
export function venueFee(
  month: VenueMonth,
  terms: FeeTerms,
): { feeTsh: number; minimumTsh: number | null } {
  const fee = feeOnSales(month.netSalesTsh, terms);
  if (month.servedShare === null) return { feeTsh: fee, minimumTsh: null };
  // The minimum is prorated by the share of the month the venue was served (owner, 26 November).
  const minimum = Math.round(terms.minimumTsh * Math.min(1, Math.max(0, month.servedShare)));
  return fee >= minimum
    ? { feeTsh: fee, minimumTsh: null }
    : { feeTsh: minimum, minimumTsh: minimum };
}

/** An interval of time; `end` null is still going. */
export interface Span {
  start: Date;
  end: Date | null;
}

/**
 * The share of `[from, to)` in which at least one router served a venue: a venue is down only
 * while every one of its routers is in an outage. `outages` holds each router's outages; a venue
 * with no router counts as never served.
 */
export function servedShare(from: Date, to: Date, outages: Span[][], now: Date): number {
  const length = to.getTime() - from.getTime();
  if (length <= 0 || outages.length === 0) return 0;
  const end = Math.min(to.getTime(), now.getTime());
  // Each router's outages, clipped to the month, as +1 at a start and -1 at an end.
  const edges: [number, number][] = [];
  for (const router of outages) {
    for (const o of router) {
      const a = Math.max(o.start.getTime(), from.getTime());
      const b = Math.min(o.end?.getTime() ?? end, end);
      if (b > a) edges.push([a, 1], [b, -1]);
    }
  }
  // An end before a start at the same instant, so touching outages don't count as overlapping.
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let down = 0;
  let open = 0;
  let since = 0;
  for (const [at, step] of edges) {
    if (open === outages.length) down += at - since;
    open += step;
    since = at;
  }
  return Math.max(0, (length - down) / length);
}
