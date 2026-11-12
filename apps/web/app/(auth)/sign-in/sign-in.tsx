"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { AuthFrame, SUPPORT_EMAIL } from "@/components/hearth/auth-frame";
import { OtpBoxes, otpComplete } from "@/components/hearth/ui";
import { ApiRequestError, api, messageOf } from "@/lib/api";
import { cancelled, cancelPasskeyWait, passkeysSupported, signInWithPasskey } from "@/lib/passkeys";

type Step = "email" | "method" | "code" | "totp" | "recover";

/** The code's life (the API's SIGN_IN_CODE_MINUTES) and the wait before another. */
const CODE_MINUTES = 10;
const RESEND_SECONDS = 60;

const KEY_ICON = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="8" cy="15" r="4" />
    <path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2" />
  </svg>
);

/**
 * Sign-in (ADR-0007, ADR-0011 9): an email, then a passkey or a code from the email; someone with an
 * authenticator app gives its code after the email code, or a recovery code instead. There is no
 * sign-up: everyone arrives by invitation.
 */
export function SignIn() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  const done = () => router.replace(next);

  // A passkey offered in the email field's suggestions signs in straight away.
  useEffect(() => {
    if (step !== "email" || !passkeysSupported()) return;
    let live = true;
    PublicKeyCredential.isConditionalMediationAvailable?.()
      .then((available) => (available && live ? signInWithPasskey(true) : null))
      .then((signed) => {
        if (signed !== null && live) router.replace(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      cancelPasskeyWait();
    };
  }, [step, router, next]);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const go = (to: Step) => {
    setError("");
    setStep(to);
  };

  async function sendCode() {
    setBusy(true);
    setError("");
    try {
      await api.post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
      setCode("");
      setWait(RESEND_SECONDS);
      go("code");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function signInByPasskey() {
    setBusy(true);
    setError("");
    try {
      cancelPasskeyWait();
      await signInWithPasskey();
      done();
    } catch (e) {
      if (!cancelled(e)) setError("That passkey didn't sign you in. Try again, or use a code.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!otpComplete(code)) return setError("Enter all 6 digits.");
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{ twoFactorRedirect?: boolean }>(
        "/api/auth/sign-in/email-otp",
        { email, otp: code },
      );
      if (result?.twoFactorRedirect) {
        setCode("");
        go("totp");
      } else done();
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.code === "ACCOUNT_INACTIVE"
          ? "This account can't sign in. Ask whoever invited you."
          : "That code didn't work. Check it, or send another.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitTotp(e: FormEvent) {
    e.preventDefault();
    if (!otpComplete(code)) return setError("Enter all 6 digits.");
    setBusy(true);
    setError("");
    try {
      await api.post("/api/auth/two-factor/verify-totp", { code });
      done();
    } catch {
      setError("That code didn't work. Enter the one your app shows now.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRecovery(e: FormEvent) {
    e.preventDefault();
    if (recovery.trim().length < 8) return setError("Enter one of your recovery codes.");
    setBusy(true);
    setError("");
    try {
      await api.post("/api/auth/two-factor/verify-backup-code", { code: recovery.trim() });
      done();
    } catch {
      setError("That recovery code didn't work. Each one works once.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "method") {
    return (
      <AuthFrame>
        <h1>Choose how to sign in</h1>
        <p className="lead">
          Signing in as <b>{email}</b>.{" "}
          <button className="link" type="button" onClick={() => go("email")}>
            Change
          </button>
        </p>
        {passkeysSupported() ? (
          <button
            className="btn primary big"
            type="button"
            onClick={signInByPasskey}
            disabled={busy}
          >
            {KEY_ICON}
            <span>Use a passkey</span>
          </button>
        ) : null}
        <button
          className={`btn ${passkeysSupported() ? "secondary" : "primary"} big`}
          type="button"
          onClick={sendCode}
          disabled={busy}
        >
          <span>Email me a code</span>
        </button>
        {error ? (
          <p className="danger" role="alert">
            {error}
          </p>
        ) : null}
        <p className="auth-terms auth-rule">
          No passkey on this device? Email yourself a code, then use your authenticator app or a
          recovery code.
        </p>
      </AuthFrame>
    );
  }

  if (step === "code") {
    return (
      <AuthFrame>
        <h1>Check your email</h1>
        <p className="lead">
          We sent a code to <b>{email}</b>.
        </p>
        <form className="form" noValidate onSubmit={submitCode}>
          <OtpBoxes
            label="Code from the email"
            hiddenLabel
            value={code}
            onChange={setCode}
            error={error}
          />
          <button className="btn primary big" type="submit" disabled={busy}>
            Sign in
          </button>
        </form>
        <div className="auth-row">
          <span>Expires in {CODE_MINUTES} minutes</span>
          {wait > 0 ? (
            <span>Send another in {`0:${String(wait).padStart(2, "0")}`}</span>
          ) : (
            <button className="link" type="button" onClick={sendCode} disabled={busy}>
              Send another code
            </button>
          )}
        </div>
        <p className="auth-terms auth-rule">
          No email? Check your spam folder, or{" "}
          <button className="link" type="button" onClick={() => go("email")}>
            use a different email
          </button>
          .
        </p>
      </AuthFrame>
    );
  }

  if (step === "totp") {
    return (
      <AuthFrame>
        <h1>Authenticator code</h1>
        <p className="lead">Enter the 6-digit code your authenticator app shows for HashiNet.</p>
        <form className="form" noValidate onSubmit={submitTotp}>
          <OtpBoxes
            label="Code from your authenticator app"
            hiddenLabel
            value={code}
            onChange={setCode}
            error={error}
          />
          <button className="btn primary big" type="submit" disabled={busy}>
            Sign in
          </button>
        </form>
        <p className="auth-terms auth-rule">
          Lost your phone?{" "}
          <button className="link" type="button" onClick={() => go("recover")}>
            Use a recovery code
          </button>
          .
        </p>
      </AuthFrame>
    );
  }

  if (step === "recover") {
    return (
      <AuthFrame>
        <h1>Use a recovery code</h1>
        <p className="lead">
          Enter one of the codes you saved when you set up your authenticator app. It works once.
        </p>
        <form className="form" noValidate onSubmit={submitRecovery}>
          <div className="field">
            <label htmlFor="rc">Recovery code</label>
            <input
              id="rc"
              className="input big mono"
              autoComplete="off"
              spellCheck={false}
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "rc-error" : undefined}
            />
            {error ? (
              <div className="hint danger" id="rc-error" role="alert">
                {error}
              </div>
            ) : null}
          </div>
          <button className="btn primary big" type="submit" disabled={busy}>
            Sign in
          </button>
        </form>
        <p className="auth-terms auth-rule">
          No codes either?{" "}
          <a className="link" href={`mailto:${SUPPORT_EMAIL}?subject=Help%20signing%20in`}>
            Contact support
          </a>{" "}
          to reset your sign-in once they&apos;ve confirmed it&apos;s you.
        </p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <h1>Sign in to HashiNet</h1>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          setEmail((v) => v.trim().toLowerCase());
          go("method");
        }}
      >
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input big"
            type="email"
            autoComplete="username webauthn"
            placeholder="you@yourbusiness.co.tz"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button className="btn primary big" type="submit">
          Continue
        </button>
      </form>
      <p className="auth-terms">
        By continuing, you agree to our <Link href="/terms">Terms of service</Link> and confirm you
        have read the <Link href="/privacy">Privacy notice</Link>.
      </p>
      <details className="auth-help">
        <summary>Need help signing in?</summary>
        <p>
          <b>Use the email you were invited with.</b> There&apos;s no sign-up: HashiNet, or the
          owner of your business, adds you and sends an invitation.
        </p>
        <p>
          <b>No code?</b> It comes from no-reply@notify.hashikome.com within a minute. Check your
          spam folder, then send another.
        </p>
        <p>
          <b>New email, or lost your phone?</b> Use a recovery code, or contact HashiNet&apos;s
          support to reset your sign-in once they&apos;ve confirmed it&apos;s you.
        </p>
        <p>
          <a className="link" href={`mailto:${SUPPORT_EMAIL}?subject=Help%20signing%20in`}>
            Contact support
          </a>
        </p>
      </details>
    </AuthFrame>
  );
}

/** Only a path on this site, so a crafted link can't send someone elsewhere after signing in. */
function safeNext(raw: string | null): string {
  return raw?.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}
