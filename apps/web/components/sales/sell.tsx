"use client";

import type { PackageRecord, SaleResult, VenueRecord, VenueSelling } from "@hashinet/types";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { when } from "@/lib/dates";
import { usePrefetch, useRefreshAll } from "@/lib/load";
import { useCan, useSession } from "@/lib/session";
import { useVenues } from "@/lib/venues";
import { PausedDialog as AccessPausedDialog } from "../platform/bill-paused";
import { Dialog } from "../ui/dialog";
import { Button, ButtonLink, Pill, type PillKind } from "../ui/ui";
import { paymentWayAt } from "../venues/payment-ways";
import { packagesAt, SellDialog } from "./sell-dialog";

export type Method = "cash" | "mobile_money";
export const METHODS: [Method, string][] = [
  ["cash", "Cash"],
  ["mobile_money", "Mobile money"],
];

export interface Sold {
  venue: VenueRecord;
  pkg: PackageRecord;
  method: Method;
  phone: string;
  result: SaleResult;
}

interface Selling {
  /** Whether the reader sells: Sell shows, even while it is paused. */
  can: boolean;
  /** No venue in reach has a router serving guests: Sell stays, quieter, and a tap says why. */
  paused: boolean;
  /** Paused because the business can't sell: its overdue bill, or HashiNet's team (ADR-0014, 2). */
  billPaused: boolean;
  open: () => void;
}

const SellContext = createContext<Selling>({
  can: false,
  paused: false,
  billPaused: false,
  open: () => {},
});
export const useSell = () => useContext(SellContext);

/**
 * Selling a voucher (ADR-0017): a voucher exists only by its sale. The shell holds the one Sell
 * dialog; the pages' Sell buttons and the phone's Sell tab open it.
 */
export function SellProvider({ children }: { children: ReactNode }) {
  const can = useCan();
  const { me } = useSession();
  const { all } = useVenues();
  const [open, setOpen] = useState(false);
  // A sale changes Today, Vouchers and Payments: whatever is on screen asks again behind it.
  const refreshAll = useRefreshAll();
  const sellable = all.filter((v) => v.selling.state === "selling");
  // Sell opens full: what it shows is loaded before it is asked for, and refreshed when it opens.
  const prefetch = usePrefetch();
  const selling = can("sale.record");
  const ids = sellable.map((v) => v.id).join(",");
  useEffect(() => {
    if (!selling) return;
    for (const id of ids.split(",").filter(Boolean)) {
      prefetch("venue-packages", () => packagesAt(id), [id]);
      prefetch("venue-payment-way", () => paymentWayAt(id), [id]);
    }
  }, [selling, ids, prefetch]);
  const value = {
    can: can("sale.record") && all.length > 0,
    paused: sellable.length === 0,
    billPaused: me.active.pause !== null,
    open: () => setOpen(true),
  };
  return (
    <SellContext.Provider value={value}>
      {children}
      {!open ? null : value.paused ? (
        <PausedDialog onClose={() => setOpen(false)} />
      ) : (
        <SellDialog venues={sellable} onSold={refreshAll} onClose={() => setOpen(false)} />
      )}
    </SellContext.Provider>
  );
}

/** A page's Sell button, hidden on a phone where the Sell tab stands in for it. */
export function SellButton() {
  const sell = useSell();
  if (!sell.can) return null;
  return sell.paused ? (
    // Not disabled: a disabled button explains nothing, and a tap here says why.
    <Button
      kind="primary"
      icon="plus"
      className="paused"
      aria-disabled="true"
      aria-describedby="sell-paused"
      data-act="sell-open"
      onClick={sell.open}
    >
      Sell a voucher
      <span className="sr" id="sell-paused">
        {sell.billPaused
          ? "Selling is paused: the business can't sell right now."
          : "Selling is paused: no router is serving guests."}
      </span>
    </Button>
  ) : (
    <Button kind="primary" icon="plus" data-act="sell-open" onClick={sell.open}>
      Sell a voucher
    </Button>
  );
}

type Paused = Exclude<VenueSelling["state"], "selling" | "paused">;

/** Each reason Sell can be paused, as the router's condition says it, and what to check. */
const PAUSED: Record<
  Paused,
  { pill: string; kind: PillKind; why: (venue: string) => string; check: string; tell: string }
> = {
  offline: {
    pill: "Router offline",
    kind: "bad",
    why: (v) =>
      `A voucher sold now couldn't be used at ${v}, so selling waits for the router. It comes back by itself as soon as the router is online.`,
    check: "Check it has power and its lights are on, and that the internet line works.",
    tell: "is offline",
  },
  "no-internet": {
    pill: "No internet",
    kind: "bad",
    why: (v) =>
      `The router is on, but its internet line isn't working, so a voucher sold now couldn't be used at ${v}. Selling comes back by itself once the internet does.`,
    check:
      "Check the internet router: its lights, the cable into the MikroTik router's port 1, and its data bundle.",
    tell: "has no internet",
  },
  "needs-attention": {
    pill: "Router needs attention",
    kind: "bad",
    why: (v) =>
      `A voucher sold now couldn't be used at ${v}, so selling waits for the router. It comes back by itself as soon as the router is serving.`,
    check: "It answers, but HashiNet can't bring it up to date. Its page says what failed.",
    tell: "needs attention",
  },
  "not-set-up": {
    pill: "Router not set up yet",
    kind: "wait",
    why: (v) =>
      `A voucher sold now couldn't be used at ${v}, so selling starts once its router is set up.`,
    check: "",
    tell: "isn't set up yet",
  },
};

/**
 * Why Sell is paused, and what to do: whoever runs the venue goes to its router or its setup; at the
 * counter the seller tells them. Selling comes back by itself once a router serves, and guests get
 * back the time an outage took.
 */
function PausedDialog({ onClose }: { onClose: () => void }) {
  const can = useCan();
  const { me } = useSession();
  const { shown, all } = useVenues();
  const venue = shown[0] ?? all[0];
  if (!venue || venue.selling.state === "selling") return null;
  const { selling } = venue;
  if (selling.state === "paused") return <AccessPausedDialog what="sell" onClose={onClose} />;
  const words = PAUSED[selling.state];
  const down = selling.state !== "not-set-up";
  const runsIt = can("router.read") && me.active.role !== "venue_operator";
  const since = down && selling.since ? ` since ${when(selling.since)}` : "";
  const kept = down ? " Guests get back the time the outage takes." : "";
  return (
    <Dialog label="Selling is paused" className="sell" onClose={onClose}>
      <h2>Selling is paused</h2>
      <p className="sell-state">
        <Pill kind={words.kind}>{`${words.pill}${since}`}</Pill>
      </p>
      <p>{words.why(venue.name)}</p>
      {runsIt ? (
        words.check || kept ? (
          <p className="note">{`${words.check}${kept}`.trim()}</p>
        ) : null
      ) : (
        <p className="note">{`Tell your manager the router ${words.tell}.${kept}`}</p>
      )}
      <div className="dialog-actions">
        {runsIt ? (
          <ButtonLink kind="primary" href={down ? `/venues/${venue.id}/router` : "/overview"}>
            {down ? "Open the router" : "See the setup"}
          </ButtonLink>
        ) : null}
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
