"use client";

import { groupedCode } from "@hashinet/types";
import { type ReactNode, useState } from "react";
import { formatDuration } from "@/lib/duration";

const SIGNATURE = "Secure, smart, shared access by HashiNet";

/** One frame on every page: the venue at the top with its logo, the HashiNet arc, the signature. */
export function Frame({
  vars,
  venue,
  logo,
  inPhone = false,
  children,
}: {
  vars: Record<string, string>;
  venue?: string;
  logo?: string | null;
  /** The editor's preview: a phone's screen inside the page, not the page itself. */
  inPhone?: boolean;
  children: ReactNode;
}) {
  const Root = inPhone ? "div" : "main";
  return (
    <Root className={inPhone ? "g-s" : "g-s g-page"} style={vars as React.CSSProperties}>
      <div className="g-arc">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path
            d="M22.6 6.2A12 12 0 1 0 27.8 14"
            fill="none"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          <circle cx="26.4" cy="8.4" r="1.4" />
        </svg>
      </div>
      <div className="g-pad">
        <div className="g-head">
          <div>{venue ? <div className="g-venue">{venue}</div> : null}</div>
          {logo ? (
            // biome-ignore lint/performance/noImgElement: the venue's uploaded logo, served by the API
            <img
              src={logo}
              alt=""
              width={36}
              height={36}
              style={{ borderRadius: 8, objectFit: "cover" }}
            />
          ) : null}
        </div>
        {children}
      </div>
      <p className="g-strip">{SIGNATURE}</p>
    </Root>
  );
}

export function Say({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h1 className="g-h">{title}</h1>
      <p className="g-say">{children}</p>
    </>
  );
}

/** A package by its name, with how long it lasts where the name doesn't already say it. */
export function Plan({ name, minutes }: { name: string; minutes: number }) {
  const lasts = formatDuration(minutes);
  return (
    <span>
      {name}
      {name.toLowerCase() === lasts.toLowerCase() ? null : <small>{lasts}</small>}
    </span>
  );
}

export function Shown({ code }: { code: string }) {
  if (!code) return null;
  return (
    <>
      <label className="g-label" htmlFor="gshown">
        Voucher code
      </label>
      <div className="g-field">
        <input className="g-input g-mono" id="gshown" readOnly value={groupedCode(code)} />
      </div>
    </>
  );
}

/** The switch PIN when this answer brought it, and how to keep the code (and PIN). */
export function KeepCode({ code, pin }: { code: string; pin: string | null }) {
  return pin ? (
    <>
      <p className="g-label">Switch PIN</p>
      <p className="g-pinshow">{pin}</p>
      <CopyCode code={code} pin={pin} />
      <p className="g-note">
        Copy both now: the PIN is shown only once, and you need the code and PIN to come back or to
        move to another phone.
      </p>
    </>
  ) : (
    <>
      <CopyCode code={code} pin={null} />
      <p className="g-note">Keep the code: you need it to come back.</p>
    </>
  );
}

export function CopyCode({ code, pin }: { code: string; pin: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  const text = pin ? `Voucher code ${groupedCode(code)}, switch PIN ${pin}` : groupedCode(code);
  return (
    <button
      className="g-copy"
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => undefined);
        setCopied(true);
      }}
    >
      {copied ? "Copied" : pin ? "Copy code and PIN" : "Copy code"}
    </button>
  );
}

/** The switch PIN, four digits, and the button that moves the voucher here once they are in. */
export function PinEntry({
  error,
  busy,
  onMove,
}: {
  error: string | null;
  busy: boolean;
  onMove: (pin: string) => void;
}) {
  const [pin, setPin] = useState("");
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (pin.length === 4) onMove(pin);
      }}
    >
      <label className="g-label" htmlFor="gpin">
        Switch PIN
      </label>
      <input
        className="g-input g-pin"
        id="gpin"
        inputMode="numeric"
        maxLength={4}
        autoComplete="off"
        placeholder="4 digits"
        value={pin}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "gpin-error" : undefined}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
      />
      {error ? (
        <p className="g-bad" id="gpin-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="g-btn g-move" type="submit" disabled={busy || pin.length < 4}>
        Move it here
      </button>
      <p className="g-note">Lost your PIN? Show your voucher at the counter.</p>
    </form>
  );
}
