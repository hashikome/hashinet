"use client";

import type { MyPasskey, ProofAction, ProofRule } from "@hashinet/types";
import { type FormEvent, type ReactNode, useState } from "react";
import { StepDialog } from "@/components/ui/dialog";
import { Button, OtpBoxes, otpComplete } from "@/components/ui/ui";
import { api } from "@/lib/api";
import { cancelled, passkeysSupported, signInWithPasskey } from "@/lib/passkeys";

/** What a flow does, and so its title, its steps and the proof it asks for. */
export type Kind = "setup" | "replace" | "codes" | "remove" | "passkey";

export type Step = "confirm" | "scan" | "codes" | "add" | "try";

export interface Flow {
  kind: Kind;
  steps: Step[];
  step: Step;
  /** Fits its content: its steps don't hand work on, so it needn't hold the tallest one's size. */
  fit: boolean;
  /** The passkey a removal is for, or the one just added to try. */
  passkey?: MyPasskey;
  totpURI?: string;
  codes?: string[];
}

const STEP_NAME: Record<Step, string> = {
  confirm: "Confirm it's you",
  scan: "Scan and verify",
  codes: "Save recovery codes",
  add: "Add it",
  try: "Try it",
};

const TITLE: Record<Kind, string> = {
  setup: "Set up your authenticator app",
  replace: "Replace your authenticator app",
  codes: "Make new recovery codes",
  remove: "Remove a passkey",
  passkey: "Add a passkey",
};

/** The change each flow makes, whose proof rule the API serves. */
export const ACTION: Record<Kind, ProofAction> = {
  setup: "add",
  passkey: "add",
  remove: "removePasskey",
  codes: "newRecoveryCodes",
  replace: "replaceAuthenticator",
};

/**
 * A change to how you sign in, as a dialog over the page: its name, one quiet line for where you are
 * in it, then the step. The × in its corner, a click outside or Escape closes it at any step; once the
 * old app or codes have stopped working, it asks first.
 */
export function FlowCard({
  flow,
  onCancel,
  children,
}: {
  flow: Flow;
  onCancel: () => void;
  children: ReactNode;
}) {
  // Where closing costs something it asks first: the new codes are shown once (the earlier ones have
  // stopped), and a replacement's old app has already stopped working.
  const leave =
    flow.step === "codes"
      ? {
          question: "Close without saving these codes?",
          why: "They aren't shown again, and your earlier codes have already stopped working. You can make new ones any time.",
          stop: "Close",
        }
      : flow.step === "scan" && flow.kind === "replace"
        ? {
            question: "Stop replacing your authenticator app?",
            why: "Your old app has already stopped working. Until you set up a new one, HashiNet asks you to protect your sign-in again.",
            stop: "Stop",
          }
        : null;
  return (
    <StepDialog
      title={TITLE[flow.kind]}
      step={{
        name: STEP_NAME[flow.step],
        at: flow.steps.indexOf(flow.step) + 1,
        of: flow.steps.length,
      }}
      leave={leave}
      fit={flow.fit}
      onClose={onCancel}
      className="acct-flow"
    >
      {children}
    </StepDialog>
  );
}

/**
 * Proof, from the factors this change accepts (the API's rule), strongest first: a passkey, then a
 * code from the app, then a recovery code. Replacing the app offers no passkey: only the old app or a
 * recovery code, and failing both, removing it (`onNeither`).
 */
export function Confirm({
  rule,
  hasPasskey,
  hasAuthenticator,
  onProved,
  onNeither,
}: {
  rule: ProofRule;
  hasPasskey: boolean;
  hasAuthenticator: boolean;
  onProved: () => Promise<void>;
  onNeither: (() => void) | null;
}) {
  const byPasskey = rule.accepts.includes("passkey") && hasPasskey && passkeysSupported();
  const byApp = rule.accepts.includes("authenticator") && hasAuthenticator;
  const byRecovery = rule.accepts.includes("recovery_code") && hasAuthenticator;
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [showApp, setShowApp] = useState(!byPasskey);
  const [showRecovery, setShowRecovery] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (attempt: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    setError("");
    try {
      await attempt();
      await onProved();
    } catch (e) {
      if (!cancelled(e)) setError(failed);
    } finally {
      setBusy(false);
    }
  };
  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    if (!otpComplete(code)) return setError("Enter all 6 digits.");
    void run(
      () => api.post("/api/auth/two-factor/verify-totp", { code }),
      "That code didn't work. Enter the one your app shows now.",
    );
  };
  const hours = Math.floor(rule.holdsMinutes / 60);
  return (
    <>
      <p className="muted">
        This changes how you sign in, so we check it&apos;s really you.
        {hours > 0 ? ` Changes like this won't ask again for ${hours} hours.` : ""}
      </p>
      {byPasskey ? (
        <div className="actions flow-primary">
          <Button
            kind="primary"
            busy={busy}
            onClick={() =>
              void run(() => signInWithPasskey(), "That passkey didn't confirm it. Try again.")
            }
          >
            Use your passkey
          </Button>
        </div>
      ) : null}
      {byApp && showApp ? (
        <form noValidate onSubmit={submitCode} className="tfa-verify">
          <OtpBoxes
            label={
              onNeither
                ? "Code from your current authenticator app"
                : "Code from your authenticator app"
            }
            value={code}
            onChange={setCode}
            error={showRecovery ? "" : error}
          />
          <Button kind={byPasskey ? "secondary" : "primary"} type="submit" busy={busy}>
            Continue
          </Button>
        </form>
      ) : null}
      {(byApp && !showApp) || byRecovery || onNeither ? (
        <div className="tfa-alt">
          {byApp && !showApp ? (
            <p>
              <button className="link" type="button" onClick={() => setShowApp(true)}>
                Use your authenticator app instead
              </button>
            </p>
          ) : null}
          {byRecovery && showRecovery ? (
            <form
              className="tfa-rc form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (recovery.trim().length < 8)
                  return setError("Enter one of your recovery codes.");
                void run(
                  () =>
                    api.post("/api/auth/two-factor/verify-backup-code", { code: recovery.trim() }),
                  "That recovery code didn't work. Each one works once.",
                );
              }}
            >
              <div className="field">
                <label htmlFor="rcx">Recovery code</label>
                <input
                  id="rcx"
                  className="input mono"
                  autoComplete="off"
                  spellCheck={false}
                  value={recovery}
                  onChange={(e) => setRecovery(e.target.value)}
                />
                <div className={`hint${error ? " danger" : ""}`} role={error ? "alert" : undefined}>
                  {error || "Each code works once."}
                </div>
              </div>
              <div className="actions">
                <Button type="submit" busy={busy}>
                  Continue with this code
                </Button>
              </div>
            </form>
          ) : byRecovery ? (
            <p>
              Lost your phone?{" "}
              <button className="link" type="button" onClick={() => setShowRecovery(true)}>
                Use a recovery code
              </button>
            </p>
          ) : null}
          {onNeither ? (
            <p>
              Neither?{" "}
              <button className="link" type="button" onClick={onNeither}>
                Remove the authenticator app
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
      {!(byApp && showApp) && !showRecovery && error ? (
        <p className="danger" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
