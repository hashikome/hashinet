"use client";

import { groupedCode, wifiQrCode } from "@hashinet/types";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef } from "react";
import { tsh } from "@/lib/money";

export interface CardFace {
  code: string;
  venue: string;
  /** The WiFi its QR code joins. */
  wifiName: string;
  price: number;
  packageName: string;
  devices: number;
}

/**
 * A printed voucher, 100 by 46 mm (prototype `voucherCard`): a stub to keep with its number, and
 * the card the guest takes, with the price, what it buys, the code, and a QR code that joins the
 * venue's WiFi.
 */
export function VoucherCard({ face, n }: { face: CardFace; n: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const price = tsh(face.price);
  const devices = `${face.devices} ${face.devices === 1 ? "device" : "devices"}`;
  const code = groupedCode(face.code);
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
            <b>Scan to join our WiFi</b>Then enter this code
          </div>
          <span className="ticket-code">{code}</span>
        </div>
        <div className="ticket-qr">
          <QRCodeSVG
            value={wifiQrCode(face.wifiName)}
            size={106}
            marginSize={0}
            title={`QR code to join the WiFi ${face.wifiName}`}
          />
        </div>
      </div>
    </div>
  );
}
