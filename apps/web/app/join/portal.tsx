"use client";

import {
  type ApiError,
  CODE_LENGTH,
  type GuestContext,
  type GuestPaymentStarted,
  type GuestPaymentStatus,
  groupedCode,
  type RedeemResult,
} from "@hashinet/types";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { clock, weekday } from "@/lib/dates";
import { formatDuration } from "@/lib/duration";
import { tsh } from "@/lib/money";
import { portalVars } from "@/lib/portal-colours";

/** Proof this tab paid: kept here so a reload still finds the code, and nowhere else. */
const PAYMENT_KEY = "hashinet.payment";
const POLL_MS = 3_000;
const SIGNATURE = "Secure, smart, shared access by HashiNet";

const store = {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch {
      // Storage is refused in some browsers: the guest types the code, and a reload loses the screen.
    }
  },
};

interface FromRouter {
  router: string;
  mac: string;
  ip: string;
  linkOrig: string;
}

/** What the router's redirect says, after `#`, which the page never sends to a server. */
function fromRouter(): FromRouter | null {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const router = fragment.get("router");
  if (!router) return null;
  return {
    router,
    mac: fragment.get("mac") ?? "",
    ip: fragment.get("ip") ?? "",
    linkOrig: fragment.get("link-orig") ?? "",
  };
}

/** "0754 210 388", as a guest dials it, from "+255754210388". */
const dialed = (phone: string) =>
  `0${phone.replace(/^\+255/, "")}`.replace(/^(\d{4})(\d{3})(\d+)$/, "$1 $2 $3");

/** The API's refusal: `code` says what happened, `message` is written for the guest. */
class Refused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // A proxy in the way can answer with a page, not the API's JSON.
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const refusal = data as Partial<ApiError> | null;
    throw new Refused(
      refusal?.code ?? "ERROR",
      refusal?.message ?? "Something went wrong. Try again.",
    );
  }
  return data as T;
}

/** "Friday 18:04": when a voucher ends, in Dar es Salaam time. */
const until = (iso: string) => `${weekday(iso)} ${clock(iso)}`;
/** "23h 59m" left until `iso`. */
function left(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days ? `${days}d ${hours}h` : `${hours}h ${minutes % 60}m`;
}
type Stage =
  | { kind: "loading" }
  | { kind: "not-on-wifi" }
  | { kind: "unavailable"; message: string }
  | { kind: "voucher" }
  | { kind: "signing" }
  | { kind: "sign-failed" }
  | { kind: "run-out"; message: string }
  | { kind: "online"; expiresAt: string | null; givenBackMinutes: number }
  | { kind: "terms"; back: "voucher" | "buy" }
  | { kind: "buy" };

/**
 * The guest portal (prototype portal.js): a voucher page, signing in and online, in the venue's
 * colours. Every guest sees the plans: bought here with mobile money where the venue sells online,
 * otherwise in person, where the page says and with a number to call. It never shows a number to
 * pay ahead: a sale is recorded as it happens (ADR-0017). Nothing says online until the router
 * confirms it.
 */
export function GuestPortal() {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [context, setContext] = useState<GuestContext | null>(null);
  const [request, setRequest] = useState<FromRouter | null>(null);
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [payment, setPayment] = useState<GuestPaymentStarted | null>(null);
  const [paid, setPaid] = useState<GuestPaymentStatus | null>(null);

  useEffect(() => {
    const held = store.get(PAYMENT_KEY);
    if (held) setPayment(JSON.parse(held) as GuestPaymentStarted);
  }, []);

  useEffect(() => {
    // Opened anywhere but through the router, it has no device to sign in: join the WiFi first.
    const from = fromRouter();
    if (from === null) {
      setStage({ kind: "not-on-wifi" });
      return;
    }
    setRequest(from);
    post<GuestContext>("/api/guest/context", { router: from.router, mac: from.mac, ip: from.ip })
      .then((found) => {
        setContext(found);
        setStage({ kind: "voucher" });
      })
      .catch((err: unknown) =>
        setStage({
          kind: "unavailable",
          message: err instanceof Error ? err.message : "This page could not load.",
        }),
      );
  }, []);

  const redeem = useCallback(
    async (code: string) => {
      if (!request) return;
      setDigits(code);
      setBusy(true);
      setError(null);
      setStage({ kind: "signing" });
      try {
        const { dst, expiresAt, givenBackMinutes } = await post<RedeemResult>("/api/guest/redeem", {
          ...request,
          code,
        });
        setStage({ kind: "online", expiresAt, givenBackMinutes });
        if (dst !== null) window.setTimeout(() => window.location.replace(dst), 1800);
      } catch (err) {
        const refused =
          err instanceof Refused ? err : new Refused("ERROR", "Something went wrong. Try again.");
        if (refused.code === "ROUTER_NOT_CONFIRMED") setStage({ kind: "sign-failed" });
        else if (["VOUCHER_USED", "VOUCHER_EXPIRED", "VOUCHER_REVOKED"].includes(refused.code)) {
          setStage({ kind: "run-out", message: refused.message });
        } else {
          setError(
            refused.code === "INVALID_VOUCHER"
              ? "That code isn't right. Check it against your voucher."
              : refused.message,
          );
          setStage({ kind: "voucher" });
        }
      } finally {
        setBusy(false);
      }
    },
    [request],
  );

  // A paid purchase is polled until its device is online.
  const done = paid?.state === "failed" || (paid?.state === "paid" && paid.online);
  useEffect(() => {
    if (payment === null || done) return;
    const ask = () =>
      post<GuestPaymentStatus>("/api/guest/payments/status", payment)
        .then((status) => {
          setPaid(status);
          if (status.ended) {
            store.set(PAYMENT_KEY, null);
            setPayment(null);
            setPaid(null);
          }
        })
        .catch(() => {
          // A dropped connection: the next poll asks again.
        });
    void ask();
    const timer = window.setInterval(ask, POLL_MS);
    return () => window.clearInterval(timer);
  }, [payment, done]);

  async function pay(packageId: string) {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const started = await post<GuestPaymentStarted>("/api/guest/payments", {
        ...request,
        packageId,
        phone,
      });
      store.set(PAYMENT_KEY, JSON.stringify(started));
      setPaid(null);
      setPayment(started);
    } catch (err) {
      setError(
        err instanceof Refused && err.code === "VALIDATION_FAILED"
          ? "Enter a mobile number, like 0712 345 678."
          : err instanceof Error
            ? err.message
            : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const startOver = () => {
    store.set(PAYMENT_KEY, null);
    setPayment(null);
    setPaid(null);
    setError(null);
    setStage({ kind: "buy" });
  };

  // Before the router: the dark sign-in frame, no venue yet.
  if (!context) {
    return (
      <Frame vars={portalVars("#0d1b2a", "#f59e2a")}>
        <Say
          title={
            stage.kind === "unavailable"
              ? "This WiFi can't be reached"
              : stage.kind === "loading"
                ? "One moment"
                : "Join the WiFi"
          }
        >
          {stage.kind === "unavailable"
            ? stage.message
            : stage.kind === "loading"
              ? "Loading your venue's page."
              : "Join the venue's WiFi network, and this page opens by itself."}
        </Say>
      </Frame>
    );
  }

  const s = context.settings;
  const vars = portalVars(s.backgroundColor, s.primaryColor);
  const sells = context.mobileMoney && context.packages.some((p) => p.payable);
  const welcome = s.headline || "Karibu. Pull up a seat.";
  const toPlans = () => setStage({ kind: "buy" });
  const terms = (back: "voucher" | "buy") =>
    s.requireTerms ? (
      <p className="g-note">
        By connecting, you accept{" "}
        <button className="g-link" type="button" onClick={() => setStage({ kind: "terms", back })}>
          the venue&apos;s terms
        </button>
        .
      </p>
    ) : null;
  const frame = (body: ReactNode) => (
    <Frame vars={vars} venue={context.venueName} logo={s.logoUrl}>
      {body}
    </Frame>
  );

  // With no internet nothing would load: the page says so and takes no code, keeping the voucher.
  if (!context.internet && payment === null) {
    return frame(
      <Say title="This WiFi has no internet right now">
        The venue's internet line is down, so nothing would load. Your voucher keeps the time the
        outage takes: it's given back as soon as the internet returns.
      </Say>,
    );
  }

  // A purchase under way takes the page until it is online or has failed.
  if (payment !== null) {
    if (paid === null || paid.state === "pending") {
      return frame(
        <>
          <Say title="Approve on your phone">
            We sent a payment request to your phone. Enter your mobile money PIN there to pay.
          </Say>
          <button className="g-btn" type="button" aria-busy="true" disabled>
            Waiting for your approval…
          </button>
          <p className="g-say g-gap">
            Nothing came?{" "}
            <button className="g-link" type="button" onClick={startOver}>
              Start again
            </button>
            .
          </p>
        </>,
      );
    }
    if (paid.state === "failed") {
      return frame(
        <>
          <Say title="The payment didn't go through">
            No money left your account. Try again, or choose another package.
          </Say>
          <button className="g-btn" type="button" onClick={startOver}>
            Try again
          </button>
        </>,
      );
    }
    return frame(
      <>
        <Say title={paid.online ? "You're online" : "Payment received"}>
          {paid.online
            ? paid.expiresAt
              ? `Until ${until(paid.expiresAt)}. Keep this page to see your time.`
              : "Keep this page to see your time."
            : paid.owed
              ? "Your voucher is safe. HashiNet is still reaching the router; this page moves on by itself."
              : "Your voucher code is in. Signing you in now."}
        </Say>
        {paid.code ? <Shown code={paid.code} /> : null}
        {paid.online && paid.expiresAt ? (
          <ul className="g-facts">
            <li>
              <span>Time left</span>
              <b>{left(paid.expiresAt)}</b>
            </li>
          </ul>
        ) : null}
        {paid.code ? <CopyCode code={paid.code} /> : null}
        {paid.code && !paid.online ? (
          <button
            className="g-btn alt"
            type="button"
            disabled={busy}
            onClick={() => void redeem(paid.code ?? "")}
          >
            Sign in now
          </button>
        ) : null}
      </>,
    );
  }

  switch (stage.kind) {
    case "signing":
      return frame(
        <>
          <Say title="Signing you in">This takes a few seconds.</Say>
          <Shown code={digits} />
          <button className="g-btn" type="button" aria-busy="true" disabled>
            Signing you in…
          </button>
        </>,
      );
    case "sign-failed":
      return frame(
        <>
          <Say title="We couldn't sign you in">
            Your voucher is safe and its time hasn&apos;t started. Try again, or copy the code to
            use later.
          </Say>
          <Shown code={digits} />
          <button
            className="g-btn"
            type="button"
            disabled={busy}
            onClick={() => void redeem(digits)}
          >
            Try again
          </button>
          <CopyCode code={digits} />
        </>,
      );
    case "run-out":
      return frame(
        <>
          <Say title="This voucher can't be used">
            {stage.message} Use another voucher, or buy more time.
          </Say>
          <button
            className="g-btn"
            type="button"
            onClick={() => {
              setDigits("");
              setStage({ kind: "voucher" });
            }}
          >
            Enter another voucher
          </button>
          <button className="g-btn alt" type="button" onClick={toPlans}>
            {sells ? "Buy more time" : "See the plans"}
          </button>
        </>,
      );
    case "online":
      return frame(
        <>
          <Say title="You're online">
            {stage.expiresAt
              ? `Until ${until(stage.expiresAt)}. Keep this page to see your time.`
              : "Enjoy the WiFi."}
          </Say>
          {stage.expiresAt ? (
            <ul className="g-facts">
              <li>
                <span>Time left</span>
                <b>{left(stage.expiresAt)}</b>
              </li>
            </ul>
          ) : null}
          {stage.givenBackMinutes > 0 ? (
            <p className="g-note">
              The WiFi was down for part of your time. We've added{" "}
              {formatDuration(stage.givenBackMinutes)} back to your voucher.
            </p>
          ) : null}
          <Shown code={digits} />
          <CopyCode code={digits} />
          <p className="g-note">Keep the code: you need it to come back.</p>
        </>,
      );
    case "terms":
      return frame(
        <>
          <Say title="Terms of use">{context.venueName}&apos;s terms for its WiFi.</Say>
          <p className="g-terms">
            Use this WiFi for lawful purposes only. Don&apos;t share your voucher code. Time runs
            from when you first join and doesn&apos;t pause. We may limit speeds at busy times.
            Vouchers aren&apos;t refundable once used.
          </p>
          <button
            className="g-btn alt"
            type="button"
            onClick={() => setStage({ kind: stage.back })}
          >
            Back
          </button>
        </>,
      );
    case "buy": {
      if (!sells) {
        // Bought in person: the plans to read, where to buy, and the seller's number if given.
        return frame(
          <>
            <Say title={welcome}>Our plans. Buy a voucher in person, then enter its code here.</Say>
            <ul className="g-rows g-list" aria-label="Plans">
              {context.packages.map((p) => (
                <li className="g-row" key={p.id}>
                  <Plan name={p.name} minutes={p.durationMinutes} />
                  <b>{tsh(p.priceTsh)}</b>
                </li>
              ))}
            </ul>
            <h2 className="g-sub">Where to buy</h2>
            <p className="g-say">
              {s.whereToBuy || `Buy a voucher in person at ${context.venueName}.`}
            </p>
            {s.contactPhone ? (
              <a className="g-btn alt" href={`tel:${s.contactPhone}`}>
                Call {dialed(s.contactPhone)}
              </a>
            ) : null}
            <h2 className="g-sub">Have a voucher?</h2>
            <p className="g-say">
              <button
                className="g-link"
                type="button"
                onClick={() => setStage({ kind: "voucher" })}
              >
                Enter its code
              </button>
              .
            </p>
          </>,
        );
      }
      const payable = context.packages.filter((p) => p.payable);
      const pick = payable.find((p) => p.id === chosen) ?? payable[0];
      const ready = phone.replace(/\D/g, "").length >= 10;
      return frame(
        <>
          <Say title={welcome}>
            Choose your time and pay with mobile money. You&apos;re online in a moment.
          </Say>
          <div className="g-rows" role="radiogroup" aria-label="Packages">
            {payable.map((p) => (
              <label className="g-row" key={p.id}>
                <input
                  type="radio"
                  name="gpk"
                  checked={p.id === pick?.id}
                  onChange={() => setChosen(p.id)}
                />
                <Plan name={p.name} minutes={p.durationMinutes} />
                <b>{tsh(p.priceTsh)}</b>
              </label>
            ))}
          </div>
          <label className="g-label" htmlFor="gmobile">
            Mobile number
          </label>
          <input
            className="g-input"
            id="gmobile"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-describedby="gmobile-hint"
          />
          <p className="g-hint" id="gmobile-hint">
            Like 0712 345 678
          </p>
          {error ? (
            <p className="g-bad" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="g-btn g-pay"
            type="button"
            disabled={!ready || !pick || busy}
            onClick={() => {
              if (pick) void pay(pick.id);
            }}
          >
            Pay {pick ? tsh(pick.priceTsh) : ""}
          </button>
          {terms("buy")}
          <h2 className="g-sub">Have a voucher?</h2>
          <p className="g-say">
            <button className="g-link" type="button" onClick={() => setStage({ kind: "voucher" })}>
              Enter its code
            </button>
            .
          </p>
        </>,
      );
    }
    default:
      return frame(
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (digits.length === CODE_LENGTH) void redeem(digits);
          }}
        >
          <Say title={welcome}>{s.message || "Enter the code on your voucher."}</Say>
          <label className="g-label" htmlFor="gcode">
            {s.voucherLabel || "Voucher code"}
          </label>
          <input
            className="g-input"
            id="gcode"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={groupedCode(digits)}
            onChange={(e) => {
              setError(null);
              setDigits(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH));
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "gcode-error" : "gcode-hint"}
          />
          {error ? null : (
            <p className="g-hint" id="gcode-hint">
              The 12 digits on your voucher
            </p>
          )}
          {error ? (
            <p className="g-bad" id="gcode-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="g-btn g-join"
            type="submit"
            disabled={digits.length < CODE_LENGTH || busy}
          >
            Connect
          </button>
          {terms("voucher")}
          <h2 className="g-sub">No voucher?</h2>
          <p className="g-say">
            <button className="g-link" type="button" onClick={toPlans}>
              {sells
                ? "See the plans and buy here with mobile money"
                : "See the plans and where to buy"}
            </button>
            .
          </p>
        </form>,
      );
  }
}

/** One frame on every page: the venue at the top with its logo, the HashiNet arc, the signature. */
function Frame({
  vars,
  venue,
  logo,
  children,
}: {
  vars: Record<string, string>;
  venue?: string;
  logo?: string | null;
  children: ReactNode;
}) {
  return (
    <main className="g-s g-page" style={vars as React.CSSProperties}>
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
    </main>
  );
}

function Say({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h1 className="g-h">{title}</h1>
      <p className="g-say">{children}</p>
    </>
  );
}

/** A package by its name, with how long it lasts where the name doesn't already say it. */
function Plan({ name, minutes }: { name: string; minutes: number }) {
  const lasts = formatDuration(minutes);
  return (
    <span>
      {name}
      {name.toLowerCase() === lasts.toLowerCase() ? null : <small>{lasts}</small>}
    </span>
  );
}

function Shown({ code }: { code: string }) {
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

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  return (
    <button
      className="g-copy"
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(groupedCode(code)).catch(() => undefined);
        setCopied(true);
      }}
    >
      {copied ? "Copied" : "Copy code"}
    </button>
  );
}
