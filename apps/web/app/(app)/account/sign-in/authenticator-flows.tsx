"use client";

import type { Me } from "@hashinet/types";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { SUPPORT_EMAIL } from "@/components/people/auth-frame";
import { Dialog } from "@/components/ui/dialog";
import { Button, CopyText, OtpBoxes, otpComplete, useToast } from "@/components/ui/ui";
import { api, messageOf } from "@/lib/api";
import { cancelled, passkeysSupported, signInWithPasskey } from "@/lib/passkeys";

/**
 * No code from the app and no recovery code: remove the app, confirmed with the passkey that stays.
 * Without a passkey, only HashiNet's support can reset the sign-in.
 */
export function RemoveApp({
  hasPasskey,
  onClose,
  onRemoved,
}: {
  hasPasskey: boolean;
  onClose: () => void;
  onRemoved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!hasPasskey || !passkeysSupported()) {
    return (
      <Dialog label="No code to replace it with" onClose={onClose} alert>
        <h2>No code to replace it with?</h2>
        <p className="muted">
          Without a code from the app, a recovery code or a passkey, HashiNet&apos;s support resets
          your sign-in once they&apos;ve confirmed it&apos;s you.
        </p>
        <div className="dialog-actions">
          <a
            className="btn primary"
            href={`mailto:${SUPPORT_EMAIL}?subject=Reset%20my%20authenticator%20app`}
          >
            Contact support
          </a>
          <Button data-cancel onClick={onClose}>
            Close
          </Button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog label="Remove the authenticator app" onClose={onClose} alert>
      <h2>Remove the authenticator app?</h2>
      <p className="muted">
        It stops signing you in, and your passkey protects your sign-in on its own. Confirm with
        your passkey: it&apos;s the one that stays.
      </p>
      {error ? (
        <p className="danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <Button
          kind="danger"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              // Asked each time: the API takes only a passkey given in the last few minutes.
              await signInWithPasskey();
              await api.post<Me>("/api/me/authenticator/remove");
              await onRemoved();
            } catch (e) {
              if (!cancelled(e)) setError(messageOf(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Remove with your passkey
        </Button>
        <Button data-cancel onClick={onClose}>
          Keep it
        </Button>
      </div>
    </Dialog>
  );
}

/** The new secret as a QR code and a setup key, then its first code to turn it on. */
export function Scan({
  uri,
  replacing,
  onDone,
}: {
  uri: string;
  replacing: boolean;
  onDone: () => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const secret = new URL(uri).searchParams.get("secret") ?? "";
  const key = secret.replace(/(.{4})/g, "$1 ").trim();
  return (
    <div className="tfa-setup">
      <div className="tfa-qr">
        <QRCodeSVG
          value={uri}
          size={168}
          marginSize={2}
          title="QR code for your authenticator app"
        />
      </div>
      <form
        noValidate
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!otpComplete(code)) return setError("Enter all 6 digits.");
          setBusy(true);
          setError("");
          try {
            await api.post("/api/auth/two-factor/verify-totp", { code });
            await onDone();
          } catch {
            setError("That code didn't work. Enter the one your app shows now.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">
          <span className="on-wide">
            Scan the code with an authenticator app such as Google Authenticator, Microsoft
            Authenticator or 1Password
          </span>
          <span className="on-phone">
            Add HashiNet to an authenticator app such as Google Authenticator, Microsoft
            Authenticator or 1Password
          </span>
          , then enter the 6 digits it shows.
          {replacing ? " Your old app has stopped working; this one replaces it." : ""}
        </p>
        <a className="btn secondary on-phone" href={uri}>
          Open in your authenticator app
        </a>
        {showKey ? (
          <div className="as-keybox">
            <span className="lbl">Setup key</span>
            <div className="key">
              <CopyText text={secret} label={key} />
            </div>
            <p className="muted">In your app, choose to enter a setup key, and pick time-based.</p>
          </div>
        ) : (
          <p className="as-key">
            Can&apos;t scan it?{" "}
            <button className="link" type="button" onClick={() => setShowKey(true)}>
              Enter a setup key instead
            </button>
          </p>
        )}
        <div className="tfa-verify">
          <OtpBoxes
            label="6-digit code from the app"
            value={code}
            onChange={setCode}
            error={error}
          />
          <Button kind="primary" type="submit" busy={busy}>
            Confirm code
          </Button>
        </div>
      </form>
    </div>
  );
}

/** The codes, the ways to keep them, and a check that they're kept before Done. */
export function Codes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  const [kept, setKept] = useState(false);
  const text = `HashiNet recovery codes\nEach signs you in once.\n\n${codes.join("\n")}\n`;
  return (
    <>
      <p className="muted">
        If you lose your phone and can&apos;t use a passkey, each code signs you in once. Any
        earlier codes have stopped working.
      </p>
      <ol className="rc-codes" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="actions rc-tools">
        <Button
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            Object.assign(document.createElement("a"), {
              href: url,
              download: "hashinet-recovery-codes.txt",
            }).click();
            URL.revokeObjectURL(url);
            toast("hashinet-recovery-codes.txt saved");
          }}
        >
          Download
        </Button>
        <Button onClick={() => window.print()}>Print</Button>
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(text).catch(() => undefined);
            toast("Codes copied");
          }}
        >
          Copy
        </Button>
      </div>
      <label className="check rc-ack">
        <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} />{" "}
        I&apos;ve saved these codes somewhere safe, away from this device
      </label>
      <div className="actions">
        <Button kind="primary" disabled={!kept} onClick={onDone}>
          Done
        </Button>
      </div>
    </>
  );
}
