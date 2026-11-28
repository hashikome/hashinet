"use client";

import {
  groupedCode,
  type PackageRecord,
  type SaleResult,
  type VenuePackages,
  type VenueRecord,
  wifiQrCode,
} from "@hashinet/types";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/duration";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";
import { useSubmit } from "@/lib/submit";
import { useVenues } from "@/lib/venues";
import { Dialog, DialogClose } from "../ui/dialog";
import { Button, Field, useToast } from "../ui/ui";
import { PayCard, paymentWayAt } from "../venues/payment-ways";
import { METHODS, type Method, type Sold } from "./sell";
import { VoucherCard } from "./voucher-card";

const devicesOf = (p: PackageRecord) =>
  `${formatDuration(p.durationMinutes)}, ${p.deviceLimit} ${p.deviceLimit === 1 ? "device" : "devices"}`;

export function SellDialog({
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
      <DialogClose onClose={onClose} />
    </Dialog>
  );
}

export const packagesAt = (venueId: string) =>
  api.get<VenuePackages>(`/api/venues/${venueId}/packages`);

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
  const here = useLoad("venue-payment-way", () => paymentWayAt(venue.id), [venue.id]);
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
        {!mobile ? null : here.error ? (
          // A failed load is not "no way to pay": the seller would send the guest nowhere.
          <LoadFailed error={here.error} retry={here.reload} />
        ) : here.data === null ? null : here.data.way ? (
          <PayCard way={here.data.way} />
        ) : (
          <p className="note">
            No way to pay by mobile money yet: an owner or business manager adds one in Settings ›
            Payments. Until then, sell for cash.
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
          // By mobile money the guest needs somewhere to pay; the API refuses a sale without it too.
          disabled={mobile && (!here.data?.way || phone.replace(/\D/g, "").length < 10)}
          onClick={confirm}
        >
          Confirm sale · {tsh(pkg.priceTsh)}
        </Button>
        <Button onClick={onBack}>Change package</Button>
      </div>
      <DialogClose onClose={onClose} />
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
  const { code } = sold.result;
  const wifi = sold.venue.wifiName;
  const send = async () => {
    const text = `Your WiFi voucher: ${groupedCode(code)}. Join the WiFi ${wifi}, then enter the code on the page that opens.`;
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
        Scan to join <b>{wifi}</b>, then enter the code
      </p>
      <div className="sale-qr">
        <QRCodeSVG value={wifiQrCode(wifi)} size={176} title={`QR code to join the WiFi ${wifi}`} />
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
            wifiName: wifi,
            price: Number(sold.pkg.priceTsh),
            packageName: sold.pkg.name,
            devices: sold.pkg.deviceLimit,
          }}
        />
      </div>
      <DialogClose onClose={onClose} />
    </Dialog>
  );
}
