"use client";

import type { Me, MyPasskey, ProofAction, ProofRule } from "@hashinet/types";
import { useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { type FormEvent, type ReactNode, Suspense, useEffect, useState } from "react";
import { SUPPORT_EMAIL } from "@/components/hearth/auth-frame";
import { Dialog, StepDialog } from "@/components/hearth/dialog";
import { PasskeyAgain } from "@/components/hearth/protect";
import {
  Attention,
  Button,
  CopyText,
  OtpBoxes,
  otpComplete,
  Panel,
  Pill,
  SettingRow,
  useToast,
} from "@/components/hearth/ui";
import { ApiRequestError, api, messageOf } from "@/lib/api";
import { longDate, todayIso } from "@/lib/dates";
import { useLoad } from "@/lib/load";
import {
  addPasskey,
  alreadyOnDevice,
  cancelled,
  passkeysSupported,
  signInWithPasskey,
} from "@/lib/passkeys";
import { useSession } from "@/lib/session";

/** What a flow does, and so its title, its steps and the proof it asks for. */
type Kind = "setup" | "replace" | "codes" | "remove" | "passkey";
type Step = "confirm" | "scan" | "codes" | "add" | "try";
interface Flow {
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
const ACTION: Record<Kind, ProofAction> = {
  setup: "add",
  passkey: "add",
  remove: "removePasskey",
  codes: "newRecoveryCodes",
  replace: "replaceAuthenticator",
};

const loadPasskeys = () => api.get<MyPasskey[]>("/api/me/passkeys");

/** "today", or the day it was. */
const usedOn = (at: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date(at)) ===
  todayIso()
    ? "today"
    : longDate(at);

export default function SignInSettingsPage() {
  return (
    <Suspense>
      <SignInSettings />
    </Suspense>
  );
}

/**
 * How the person signs in (prototype `accountSections().signin`): passkeys, the authenticator app
 * and recovery codes, on a flat page. Each change opens in a dialog over it; a change to protection
 * asks for proof first, from the factors the API says that change accepts.
 */
function SignInSettings() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const params = useSearchParams();
  const passkeys = useLoad("passkeys", loadPasskeys, []);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [removingApp, setRemovingApp] = useState(false);
  const [busy, setBusy] = useState(false);
  const { required, authenticator } = me.protection;
  const keys = passkeys.data ?? [];

  /** The passkeys again, after one is added, used or removed; answers the fresh list. */
  async function reloadPasskeys(): Promise<MyPasskey[]> {
    const list = await loadPasskeys();
    passkeys.set(list);
    return list;
  }

  /** Starts a flow: proof first when the change needs it and the session has none that counts. */
  async function start(kind: Kind, passkey?: MyPasskey) {
    const needsProof = me.protection.proof[ACTION[kind]].needed;
    const steps: Step[] = [
      ...(needsProof ? (["confirm"] as Step[]) : []),
      ...(kind === "setup" || kind === "replace" ? (["scan"] as Step[]) : []),
      ...(kind === "passkey" ? (["add", "try"] as Step[]) : []),
      ...(kind === "setup" || kind === "replace" || kind === "codes" ? (["codes"] as Step[]) : []),
    ];
    // Chosen once, so a proof asked for on the way never resizes the dialog mid-flow.
    const fit = kind === "passkey" || kind === "remove";
    const next: Flow = { kind, steps, step: steps[0] ?? "codes", fit, passkey };
    if (needsProof || kind === "passkey") return setFlow(next);
    await proceed(next);
  }

  /** The work after proof: each kind's first call to the API. */
  async function proceed(f: Flow) {
    if (f.kind === "passkey") return setFlow({ ...f, step: "add" });
    setBusy(true);
    try {
      if (f.kind === "remove" && f.passkey) {
        await api.post("/api/auth/passkey/delete-passkey", { id: f.passkey.id });
        setFlow(null);
        setAsking(null);
        await Promise.all([reloadPasskeys(), refresh()]);
        toast(`${f.passkey.name ?? "Passkey"} removed`);
        return;
      }
      if (f.kind === "codes") {
        const made = await api.post<{ backupCodes: string[] }>(
          "/api/auth/two-factor/generate-backup-codes",
        );
        setFlow({ ...f, step: "codes", codes: made.backupCodes });
        return;
      }
      if (f.kind === "replace") await api.post<Me>("/api/me/authenticator/replace");
      const enabled = await api.post<{ totpURI: string; backupCodes: string[] }>(
        "/api/auth/two-factor/enable",
      );
      setFlow({ ...f, step: "scan", totpURI: enabled.totpURI, codes: enabled.backupCodes });
      if (f.kind === "replace") await refresh();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === "PROOF_REQUIRED") {
        // The proof ran out, or wasn't one this change takes: ask again for one that is.
        await refresh();
        setFlow({
          ...f,
          steps: ["confirm", ...f.steps.filter((s) => s !== "confirm")],
          step: "confirm",
        });
      } else toast(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  // Arriving from "Set up an authenticator app" elsewhere opens the flow at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on arrival
  useEffect(() => {
    if (params.get("flow") === "authenticator" && !authenticator) void start("setup");
  }, []);

  const flowDialog = flow ? (
    <FlowCard flow={flow} onCancel={() => setFlow(null)}>
      {flow.step === "confirm" ? (
        <Confirm
          rule={me.protection.proof[ACTION[flow.kind]]}
          hasPasskey={keys.length > 0}
          hasAuthenticator={authenticator}
          onProved={async () => {
            await refresh();
            await proceed(flow);
          }}
          onNeither={
            flow.kind === "replace"
              ? () => {
                  setFlow(null);
                  setRemovingApp(true);
                }
              : null
          }
        />
      ) : flow.step === "add" ? (
        <AddPasskey
          onAdded={async () => {
            const list = await reloadPasskeys();
            await refresh();
            setFlow({ ...flow, step: "try", passkey: list[list.length - 1] });
          }}
        />
      ) : flow.step === "try" && flow.passkey ? (
        <TryPasskey
          passkey={flow.passkey}
          onTried={async () => {
            const used = (await reloadPasskeys()).find((k) => k.id === flow.passkey?.id);
            await refresh();
            return used?.lastUsedAt != null;
          }}
          onDone={() => setFlow(null)}
        />
      ) : flow.step === "scan" && flow.totpURI ? (
        <Scan
          uri={flow.totpURI}
          replacing={flow.kind === "replace"}
          onDone={async () => {
            await refresh();
            setFlow({ ...flow, step: "codes" });
            toast("Authenticator app on. Save your recovery codes.");
          }}
        />
      ) : (
        <Codes codes={flow.codes ?? []} onDone={() => setFlow(null)} />
      )}
    </FlowCard>
  ) : null;
  const removing = keys.find((k) => k.id === asking) ?? null;

  const need = !required
    ? "Optional. Once on, an email code needs it too."
    : authenticator
      ? "Required for your role after an email code. A passkey skips it."
      : keys.length
        ? "Your passkey protects your sign-in. Add this too to sign in with an email code."
        : "Required for your role, or a passkey. Until one is set up, you can't start work.";

  return (
    <>
      {flowDialog}
      {removing ? (
        <Dialog
          label={`Remove ${removing.name ?? "this passkey"}`}
          onClose={() => setAsking(null)}
          alert
        >
          <h2>Remove {removing.name ?? "this passkey"}?</h2>
          <p className="muted">
            It stops signing you in.
            {keys.length === 1 && !authenticator && required
              ? " Your role then needs an authenticator app before you can work."
              : ""}
          </p>
          <p className="muted">
            Your device or password manager keeps its copy: delete it there too, or it gets in the
            way of a new passkey.
          </p>
          <div className="dialog-actions">
            <Button
              kind="danger"
              busy={busy}
              onClick={() => {
                setAsking(null);
                void start("remove", removing);
              }}
            >
              Remove passkey
            </Button>
            <Button data-cancel onClick={() => setAsking(null)}>
              Keep it
            </Button>
          </div>
        </Dialog>
      ) : null}
      {removingApp ? (
        <RemoveApp
          hasPasskey={keys.length > 0}
          onClose={() => setRemovingApp(false)}
          onRemoved={async () => {
            setRemovingApp(false);
            await Promise.all([reloadPasskeys(), refresh()]);
            toast("Authenticator app removed. Your passkey protects your sign-in.");
          }}
        />
      ) : null}
      {me.active.access === "account" ? (
        me.protection.passkeys > 0 ? (
          <Attention title="You signed in with an email code alone" action={<PasskeyAgain />}>
            Sign in with your passkey, or set up an authenticator app, and the rest of HashiNet
            opens. An email code alone reaches only this page.
          </Attention>
        ) : (
          <Attention title="Protect your sign-in first">
            Set up an authenticator app or add a passkey. Then the rest of HashiNet opens.
          </Attention>
        )
      ) : null}
      <Panel title="Sign-in">
        <p className="muted settings-lead">
          You sign in with a code sent to your email
          {required ? ". Your role also needs a passkey or an authenticator app" : ""}.
        </p>
        <ul className="rows">
          <SettingRow
            title={
              <>
                Passkeys{" "}
                <Pill kind={keys.length ? "ok" : "neutral"}>
                  {keys.length ? `${keys.length} added` : "None"}
                </Pill>
              </>
            }
            sub="Sign in with your fingerprint, face or device PIN, without an email code."
            action={
              passkeysSupported() ? (
                <Button busy={busy} onClick={() => void start("passkey")}>
                  Add a passkey
                </Button>
              ) : null
            }
          />
          {keys.map((k) => (
            <SettingRow
              key={k.id}
              className="sub-row"
              title={k.name ?? "Passkey"}
              sub={[
                k.createdAt ? `Added ${longDate(k.createdAt)}` : "Added",
                k.lastUsedAt ? `used ${usedOn(k.lastUsedAt)}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
              action={
                <Button kind="danger" onClick={() => setAsking(k.id)}>
                  Remove
                </Button>
              }
            />
          ))}
          <SettingRow
            title={
              <>
                Authenticator app{" "}
                <Pill kind={authenticator ? "ok" : required ? "wait" : "neutral"}>
                  {authenticator ? "On" : required ? "Not set up" : "Off"}
                </Pill>
              </>
            }
            sub={need}
            action={
              <Button
                kind={!authenticator && required ? "primary" : "secondary"}
                busy={busy}
                onClick={() => void start(authenticator ? "replace" : "setup")}
              >
                {authenticator ? "Replace" : required ? "Set up" : "Turn on"}
              </Button>
            }
          />
          <SettingRow
            title="Recovery codes"
            sub={
              authenticator
                ? "Each signs you in once if you lose your phone. Making new ones stops the old."
                : "Come with the authenticator app."
            }
            action={
              authenticator ? (
                <Button busy={busy} onClick={() => void start("codes")}>
                  Make new codes
                </Button>
              ) : null
            }
          />
        </ul>
      </Panel>
    </>
  );
}

/**
 * A change to how you sign in, as a dialog over the page: its name, one quiet line for where you are
 * in it, then the step. The × in its corner, a click outside or Escape closes it at any step; once the
 * old app or codes have stopped working, it asks first.
 */
function FlowCard({
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
function Confirm({
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

/** Add it: what a passkey does, then the device (or a password manager) asks to save one. */
function AddPasskey({ onAdded }: { onAdded: () => Promise<void> }) {
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
function TryPasskey({
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

/**
 * No code from the app and no recovery code: remove the app, confirmed with the passkey that stays.
 * Without a passkey, only HashiNet's support can reset the sign-in.
 */
function RemoveApp({
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
function Scan({
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
function Codes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
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
