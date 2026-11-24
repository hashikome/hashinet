"use client";

import {
  groupedCode,
  type PackageRecord,
  type RouterList,
  type SaleResult,
  type VenuePackages,
  type VenuePaymentDetails,
  type VenueRecord,
  type VenueSelling,
} from "@hashinet/types";
import { QRCodeSVG } from "qrcode.react";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { when } from "@/lib/dates";
import { formatDuration } from "@/lib/duration";
import { LoadFailed, useLoad, usePrefetch, useRefreshAll } from "@/lib/load";
import { tsh } from "@/lib/money";
import { useCan, useSession } from "@/lib/session";
import { useSubmit } from "@/lib/submit";
import { useVenues } from "@/lib/venues";
import { Dialog } from "./dialog";
import { Icon } from "./icons";
import { Button, ButtonLink, Field, Pill, type PillKind, useToast } from "./ui";
import { VoucherCard, voucherLink } from "./voucher-card";

type Method = "cash" | "mobile_money";
const METHODS: [Method, string][] = [
  ["cash", "Cash"],
  ["mobile_money", "Mobile money"],
];

interface Sold {
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
  open: () => void;
}

const SellContext = createContext<Selling>({ can: false, paused: false, open: () => {} });
export const useSell = () => useContext(SellContext);

/**
 * Selling a voucher (ADR-0017): a voucher exists only by its sale. The shell holds the one Sell
 * dialog; the pages' Sell buttons and the phone's Sell tab open it.
 */
export function SellProvider({ children }: { children: ReactNode }) {
  const can = useCan();
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
      prefetch("payment-details", () => paymentDetailsAt(id), [id]);
    }
  }, [selling, ids, prefetch]);
  const value = {
    can: can("sale.record") && all.length > 0,
    paused: sellable.length === 0,
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
        Selling is paused: no router is serving guests.
      </span>
    </Button>
  ) : (
    <Button kind="primary" icon="plus" data-act="sell-open" onClick={sell.open}>
      Sell a voucher
    </Button>
  );
}

type Paused = Exclude<VenueSelling["state"], "selling">;

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

const devicesOf = (p: PackageRecord) =>
  `${formatDuration(p.durationMinutes)}, ${p.deviceLimit} ${p.deviceLimit === 1 ? "device" : "devices"}`;

function SellDialog({
  venues,
  onSold,
  onClose,
}: {
  venues: VenueRecord[];
  onSold: () => void;
  onClose: () => void;
}) {
  const { shown } = useVenues();
  const [venueId, setVenueId] = useState(
    (shown.find((v) => v.selling.state === "selling") ?? venues[0])?.id ?? "",
  );
  const [pkg, setPkg] = useState<PackageRecord | null>(null);
  const [sold, setSold] = useState<Sold | null>(null);
  const venue = venues.find((v) => v.id === venueId) ?? null;
  if (venue === null) return null;
  if (sold) {
    return (
      <SoldStep
        sold={sold}
        onClose={onClose}
        onAgain={() => {
          setSold(null);
          setPkg(null);
        }}
      />
    );
  }
  if (pkg) {
    return (
      <CheckStep
        venue={venue}
        pkg={pkg}
        onClose={onClose}
        onBack={() => setPkg(null)}
        onSold={(s) => {
          setSold(s);
          onSold();
        }}
      />
    );
  }
  return (
    <PickStep
      venues={venues}
      venue={venue}
      onVenue={setVenueId}
      onPick={setPkg}
      onClose={onClose}
    />
  );
}

function Close({ onClose }: { onClose: () => void }) {
  return (
    <button className="dialog-close" type="button" aria-label="Close" onClick={onClose}>
      <Icon name="close" size={16} />
    </button>
  );
}

/** Step 1: the packages as rows, one tap each; rows hold any number of packages. */
function PickStep({
  venues,
  venue,
  onVenue,
  onPick,
  onClose,
}: {
  venues: VenueRecord[];
  venue: VenueRecord;
  onVenue: (id: string) => void;
  onPick: (p: PackageRecord) => void;
  onClose: () => void;
}) {
  const sold = useLoad("venue-packages", () => packagesAt(venue.id), [venue.id]);
  const packages = sold.data?.packages ?? null;
  const first = useRef<HTMLButtonElement>(null);
  // Focus starts on the first package, as soon as there is one.
  useEffect(() => {
    if (packages?.length) first.current?.focus();
  }, [packages]);
  return (
    <Dialog label="Sell a voucher" className="sell" onClose={onClose}>
      <h2>Sell a voucher</h2>
      <p className="muted">Choose what the guest is buying.</p>
      {venues.length > 1 ? (
        <Field label="Venue" id="sv">
          <select
            id="sv"
            className="input"
            value={venue.id}
            onChange={(e) => onVenue(e.target.value)}
          >
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {sold.error ? (
        <LoadFailed error={sold.error} retry={sold.reload} />
      ) : packages === null ? null : packages.length ? (
        <div className="pkg-rows">
          {packages.map((p, i) => (
            <button
              key={p.id}
              ref={i === 0 ? first : null}
              className="pkg-row"
              type="button"
              onClick={() => onPick(p)}
            >
              <span>
                <b>{p.name}</b>
                <small>{devicesOf(p)}</small>
              </span>
              <span className="price">{tsh(p.priceTsh)}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">
          Nothing is on sale here. The owner puts packages on sale in Packages.
        </p>
      )}
      <Close onClose={onClose} />
    </Dialog>
  );
}

const packagesAt = (venueId: string) => api.get<VenuePackages>(`/api/venues/${venueId}/packages`);
const paymentDetailsAt = (venueId: string) =>
  api.get<VenuePaymentDetails>(`/api/venues/${venueId}/payment-details`);

/**
 * Step 2: the check, centred like the voucher, with the price large. For mobile money it shows where
 * to pay and needs the guest's mobile money number; Confirm sale means the money is in hand.
 */
function CheckStep({
  venue,
  pkg,
  onClose,
  onBack,
  onSold,
}: {
  venue: VenueRecord;
  pkg: PackageRecord;
  onClose: () => void;
  onBack: () => void;
  onSold: (s: Sold) => void;
}) {
  const [method, setMethod] = useState<Method>("cash");
  const [phone, setPhone] = useState("");
  const { busy, errors, run } = useSubmit();
  const mobile = method === "mobile_money";
  const details = useLoad("payment-details", () => paymentDetailsAt(venue.id), [venue.id]);
  const confirm = async () => {
    let result: SaleResult | null = null;
    const ok = await run(async () => {
      result = await api.post<SaleResult>("/api/sales", {
        venueId: venue.id,
        packageId: pkg.id,
        method,
        phone: phone.trim() || null,
      });
    }, null);
    if (ok && result) onSold({ venue, pkg, method, phone: phone.trim(), result });
  };
  return (
    <Dialog label="Confirm the sale" className="sell sell-c" onClose={onClose}>
      <h2>{pkg.name}</h2>
      <p className="muted">
        {venue.name} · {devicesOf(pkg)}
      </p>
      <p className="sell-big">{tsh(pkg.priceTsh)}</p>
      <div className="form">
        <fieldset className="field inline" aria-labelledby="paid-by">
          <span className="lbl" id="paid-by">
            Paid by
          </span>
          <div className="segs">
            {METHODS.map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={`seg${m === method ? " on" : ""}`}
                aria-pressed={m === method}
                onClick={() => setMethod(m)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        {!mobile ? null : details.error ? (
          // A failed load is not "no details": the seller would send the guest nowhere.
          <LoadFailed error={details.error} retry={details.reload} />
        ) : details.data === null ? null : details.data.ways.length ? (
          details.data.ways.map((w) => (
            <div className="pay-to" key={`${w.through}${w.number}`}>
              <span className="lbl">Pay to · {w.through}</span>
              <b>{w.number}</b>
              <small>{w.name}</small>
            </div>
          ))
        ) : (
          <p className="note">
            No payment details yet. An owner or manager adds them on the venue's page.
          </p>
        )}
        <Field
          label={mobile ? "Guest's mobile money number" : "Guest's mobile number (optional)"}
          id="sn"
          {...(errors.phone ? { error: `The number ${errors.phone}.` } : {})}
        >
          <input
            id="sn"
            className="input"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
      </div>
      <p className="small muted">
        {mobile
          ? `Confirm once the payment reaches ${venue.name}.`
          : "Confirm once the cash is in your hand."}
      </p>
      <div className="dialog-actions">
        <Button
          kind="primary"
          busy={busy}
          disabled={mobile && phone.replace(/\D/g, "").length < 10}
          onClick={confirm}
        >
          Confirm sale · {tsh(pkg.priceTsh)}
        </Button>
        <Button onClick={onBack}>Change package</Button>
      </div>
      <Close onClose={onClose} />
    </Dialog>
  );
}

/**
 * Step 3: the voucher, handed over. The WiFi's name comes first: joining the right network is where
 * guests stumble. Then its QR code, Sell another, Send (the device's share sheet) and Print.
 */
function SoldStep({
  sold,
  onClose,
  onAgain,
}: {
  sold: Sold;
  onClose: () => void;
  onAgain: () => void;
}) {
  const toast = useToast();
  const [ssid, setSsid] = useState(sold.venue.name);
  const { code } = sold.result;
  const link = voucherLink(code);
  useEffect(() => {
    let live = true;
    api
      .get<RouterList>("/api/routers")
      .then((r) => {
        const named = r.routers.find((x) => x.venueId === sold.venue.id && x.ssid);
        if (live && named?.ssid) setSsid(named.ssid);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sold.venue.id]);
  const send = async () => {
    const text = `Your WiFi voucher: ${groupedCode(code)}. Join ${ssid}, then open ${link}`;
    if (navigator.share) {
      // Closing the share sheet without sending is no failure.
      await navigator.share({ title: "WiFi voucher", text }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(text);
    toast("Copied. Paste it into a message to the guest.");
  };
  const texted = sold.result.texted;
  return (
    <Dialog label="Voucher sold" className="sale-card" onClose={onClose}>
      <h2>Voucher sold</h2>
      <p className="muted">
        {sold.pkg.name} · {tsh(sold.pkg.priceTsh)} ·{" "}
        {sold.method === "cash" ? "Cash" : "Mobile money"}
        {texted ? (
          <>
            {" "}
            · texted to <span className="nowrap">{sold.phone}</span>
          </>
        ) : null}
      </p>
      <p className="sold-wifi">
        Join <b>{ssid}</b>, then scan
      </p>
      <div className="sale-qr">
        <QRCodeSVG value={link} size={176} title={`QR code for voucher ${groupedCode(code)}`} />
      </div>
      <p className="sale-code">{groupedCode(code)}</p>
      <div className="actions">
        <Button kind="primary" onClick={onAgain}>
          Sell another
        </Button>
        <Button onClick={send}>Send</Button>
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      {/* What Print puts on a receipt printer: this one voucher, nothing else. */}
      <div className="tickets print-only">
        <VoucherCard
          n={1}
          face={{
            code,
            venue: sold.venue.name,
            price: Number(sold.pkg.priceTsh),
            packageName: sold.pkg.name,
            devices: sold.pkg.deviceLimit,
          }}
        />
      </div>
      <Close onClose={onClose} />
    </Dialog>
  );
}
