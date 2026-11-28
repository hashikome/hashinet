"use client";

import type { MyPasskey } from "@hashinet/types";
import { useState } from "react";
import { Button } from "@/components/ui/ui";
import { messageOf } from "@/lib/api";
import { addPasskey, alreadyOnDevice, cancelled, signInWithPasskey } from "@/lib/passkeys";

/** Add it: what a passkey does, then the device (or a password manager) asks to save one. */
export function AddPasskey({ onAdded }: { onAdded: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <p className="muted">
        Sign in with this device&apos;s fingerprint, face or PIN, without an email code. Your
        device, or your password manager, asks to save it next; it&apos;s named for this device and
        browser.
      </p>
      {error ? (
        <p className="danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <Button
          kind="primary"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await addPasskey();
              await onAdded();
            } catch (e) {
              if (alreadyOnDevice(e))
                setError(
                  "This device already has a passkey for you. Sign in with it, or add one on another device.",
                );
              else if (!cancelled(e)) setError(messageOf(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Continue
        </Button>
      </div>
    </>
  );
}

/**
 * Try it: sign in with the new passkey alone (the device offers no other), so the person knows it
 * works before they need it. "It works" only once the API has seen that passkey used.
 */
export function TryPasskey({
  passkey,
  onTried,
  onDone,
}: {
  passkey: MyPasskey;
  onTried: () => Promise<boolean>;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [works, setWorks] = useState(false);
  const [error, setError] = useState("");
  const name = passkey.name ?? "this passkey";
  if (works) {
    return (
      <>
        <p>
          <b>It works.</b>
        </p>
        <p className="muted">
          {name} signed you in. Next time, choose it instead of an email code.
        </p>
        <div className="dialog-actions">
          <Button kind="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <p>
        <b>Your passkey is saved as {name}.</b>
      </p>
      <p className="muted">
        Try it now, the way you&apos;ll sign in next time, so you know it works before you need it.
      </p>
      {error ? (
        <p className="danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <Button
          kind="primary"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await signInWithPasskey({ only: passkey.credentialId });
              if (await onTried()) setWorks(true);
              else setError("It didn't sign you in with this passkey. Try again.");
            } catch (e) {
              if (!cancelled(e)) setError("It didn't sign you in. Try again, or remove it.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign in with it now
        </Button>
        <Button onClick={onDone}>Later</Button>
      </div>
    </>
  );
}
