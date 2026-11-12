"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef } from "react";
import { tsh } from "./ui";

/** "4827 1693 6518": a code in the three groups it is printed and read aloud in. */
export const grouped = (code: string) => code.replace(/(\d{4})(?=\d)/g, "$1 ");

/** Where a printed card's QR code opens: the portal, the code in the fragment (ADR-0008). */
export function voucherLink(code: string): string {
  const origin =
    process.env.NEXT_PUBLIC_PORTAL_URL ??
    (typeof window === "undefined" ? "" : window.location.origin);
  return `${origin}/join#code=${code}`;
}

export interface CardFace {
  code: string;
  venue: string;
  price: number;
  packageName: string;
  devices: number;
}

/**
 * A printed voucher, 100 by 46 mm (prototype `voucherCard`): a stub to keep with its number, and
 * the card the guest takes, with the price, what it buys, the code and its QR code.
 */
export function VoucherCard({ face, n }: { face: CardFace; n: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const price = tsh(face.price);
  const devices = `${face.devices} ${face.devices === 1 ? "device" : "devices"}`;
  const code = grouped(face.code);
  // On a phone the card scales to the width it has; on paper it is always 100 mm.
  useEffect(() => {
    const fit = () => {
      const card = ref.current;
      if (!card?.parentElement) return;
      const small = matchMedia("(max-width: 900px)").matches;
      card.style.zoom = small ? String(Math.min(card.parentElement.clientWidth / 378, 1)) : "";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className="ticket" ref={ref}>
      <div className="ticket-stub">
        <b>No. {n}</b>
        <div>
          {price.replace(" ", " ")}
          <br />
          {face.packageName}
          <br />
          {devices}
        </div>
        <span className="ticket-num">{code}</span>
      </div>
      <div className="ticket-card">
        <div className={`ticket-top${face.venue.length > 26 ? " long" : ""}`}>
          <span>{face.venue}</span>
        </div>
        <div className="ticket-text">
          <div>
            <b className="ticket-price">{price}</b>
            <div className="ticket-buys">
              {face.packageName}, {devices}
            </div>
          </div>
          <div className="ticket-join">
            <b>Join our WiFi</b>Then scan, or enter this code
          </div>
          <span className="ticket-code">{code}</span>
        </div>
        <div className="ticket-qr">
          <QRCodeSVG
            value={voucherLink(face.code)}
            size={106}
            marginSize={0}
            title={`QR code for voucher ${code}`}
          />
        </div>
      </div>
    </div>
  );
}
