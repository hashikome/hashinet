"use client";

import type { Me } from "@hashinet/types";
import { useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { type FormEvent, type ReactNode, Suspense, useEffect, useState } from "react";
import { Icon } from "@/components/hearth/icons";
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
import { longDate } from "@/lib/dates";
import { useLoad } from "@/lib/load";
import { addPasskey, cancelled, passkeysSupported, signInWithPasskey } from "@/lib/passkeys";
import { useSession } from "@/lib/session";

interface Passkey {
  id: string;
  name?: string | null;
  createdAt: string;
}

/** What a flow does, and so its title and steps. */
type Kind = "setup" | "replace" | "codes" | "remove" | "passkey";
type Step = "confirm" | "scan" | "codes";
interface Flow {
  kind: Kind;
  steps: Step[];
  step: Step;
  /** The passkey a removal is for. */
  passkey?: Passkey;
  totpURI?: string;
  codes?: string[];
}

const STEP_NAME: Record<Step, string> = {
  confirm: "Confirm it's you",
  scan: "Scan and verify",
  codes: "Save recovery codes",
};
const TITLE: Record<Kind, string> = {
  setup: "Set up your authenticator app",
  replace: "Replace your authenticator app",
  codes: "Make new recovery codes",
  remove: "Remove a passkey",
  passkey: "Add a passkey",
};
const PROOF_HOURS = 2;

export default function SignInSettingsPage() {
  return (
    <Suspense>
      <SignInSettings />
    </Suspense>
  );
}

/**
 * How the person signs in (prototype `accountSections().signin`): passkeys, the authenticator app
 * and recovery codes. Each change runs in place on the page, never in a popup; a change to
 * protection the person already has asks for proof first, which then holds for 2 hours.
 */
function SignInSettings() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const params = useSearchParams();
  const passkeys = useLoad(() => api.get<Passkey[]>("/api/auth/passkey/list-user-passkeys"), []);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { required, authenticator } = me.protection;
  const proved =
    me.protection.provedUntil !== null && Date.parse(me.protection.provedUntil) > Date.now();
  const keys = passkeys.data ?? [];

  /** Starts a flow: proof first when the change needs it and the session has none. */
  async function start(kind: Kind, passkey?: Passkey) {
    // Changing protection asks for proof first; so does adding to protection already there.
    const adds = kind === "setup" || kind === "passkey";
    const needsProof = !proved && (!adds || authenticator || keys.length > 0);
    const steps: Step[] = [
      ...(needsProof ? (["confirm"] as Step[]) : []),
      ...(kind === "setup" || kind === "replace" ? (["scan"] as Step[]) : []),
      ...(kind === "remove" || kind === "passkey" ? [] : (["codes"] as Step[])),
    ];
    const next: Flow = { kind, steps, step: steps[0] ?? "codes", passkey };
    if (needsProof) return setFlow(next);
    await proceed(next);
  }

  /** The work after proof: each kind's first call to the API. */
  async function proceed(f: Flow) {
    setBusy(true);
    try {
      if (f.kind === "passkey") {
        try {
          await addPasskey();
          toast("Passkey added");
        } catch (e) {
          if (!cancelled(e)) toast(messageOf(e));
        }
        setFlow(null);
        await Promise.all([passkeys.reload(), refresh()]);
        return;
      }
      if (f.kind === "remove" && f.passkey) {
        await api.post("/api/auth/passkey/delete-passkey", { id: f.passkey.id });
        setFlow(null);
        setAsking(null);
        await Promise.all([passkeys.reload(), refresh()]);
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

  if (flow) {
    return (
      <FlowCard flow={flow} onCancel={() => setFlow(null)}>
        {flow.step === "confirm" ? (
          <Confirm
            hasPasskey={keys.length > 0}
            hasAuthenticator={authenticator}
            onProved={async () => {
              await refresh();
              await proceed(flow);
            }}
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
    );
  }

  const need = !required
    ? "Optional. Once on, an email code needs it too."
    : authenticator
      ? "Required for your role after an email code. A passkey skips it."
      : keys.length
        ? "Your passkey protects your sign-in. Add this too to sign in with an email code."
        : "Required for your role, or a passkey. Until one is set up, you can't start work.";

  return (
    <>
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
          {keys.map((k) =>
            asking === k.id ? (
              <SettingRow
                key={k.id}
                className="sub-row ask-row"
                title={`Remove ${k.name ?? "this passkey"}?`}
                sub={`It stops signing you in.${keys.length === 1 && !authenticator && required ? " Your role then needs an authenticator app before you can work." : ""}`}
                action={
                  <div className="actions">
                    <Button kind="danger" busy={busy} onClick={() => void start("remove", k)}>
                      Remove
                    </Button>
                    <Button onClick={() => setAsking(null)}>Keep</Button>
                  </div>
                }
              />
            ) : (
              <SettingRow
                key={k.id}
                className="sub-row"
                title={k.name ?? "Passkey"}
                sub={`Added ${longDate(k.createdAt)}`}
                action={
                  <Button kind="danger" onClick={() => setAsking(k.id)}>
                    Remove
                  </Button>
                }
              />
            ),
          )}
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

/** A flow on the page: its name, its steps as a row of named stages, then the step itself. */
function FlowCard({
  flow,
  onCancel,
  children,
}: {
  flow: Flow;
  onCancel: () => void;
  children: ReactNode;
}) {
  const at = flow.steps.indexOf(flow.step);
  const title = TITLE[flow.kind];
  return (
    <section className="panel acct-flow" aria-label={title}>
      <div className="flow-head">
        <h2>{title}</h2>
        {/* On the last step the old codes have already stopped working, so there is no going back. */}
        {flow.step === "codes" ? null : <Button onClick={onCancel}>Cancel</Button>}
      </div>
      {flow.steps.length > 1 ? (
        <>
          <ol className="flow-steps">
            {flow.steps.map((s, i) => {
              const state = i < at ? "done" : i === at ? "now" : "next";
              return (
                <li key={s} className={state} aria-current={state === "now" ? "step" : undefined}>
                  {state === "done" ? <Icon name="check" size={14} /> : null}
                  <span>{STEP_NAME[s]}</span>
                  {state === "done" ? <span className="sr"> (done)</span> : null}
                </li>
              );
            })}
          </ol>
          <p className="flow-now" aria-hidden="true">
            <b>{STEP_NAME[flow.step]}</b> · {at + 1} of {flow.steps.length}
          </p>
        </>
      ) : null}
      <div className="flow-body">{children}</div>
    </section>
  );
}

/** Proof, strongest first: a passkey, then a code from the app, then a recovery code. */
function Confirm({
  hasPasskey,
  hasAuthenticator,
  onProved,
}: {
  hasPasskey: boolean;
  hasAuthenticator: boolean;
  onProved: () => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
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
  return (
    <>
      <p className="muted">
        This changes how you sign in, so we check it&apos;s really you. You won&apos;t be asked
        again for {PROOF_HOURS} hours.
      </p>
      {hasPasskey && passkeysSupported() ? (
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
      {hasAuthenticator ? (
        <form noValidate onSubmit={submitCode} className="tfa-verify">
          <OtpBoxes
            label={
              hasPasskey
                ? "Or enter a code from your authenticator app"
                : "Code from your authenticator app"
            }
            value={code}
            onChange={setCode}
            error={showRecovery ? "" : error}
          />
          <Button kind={hasPasskey ? "secondary" : "primary"} type="submit" busy={busy}>
            Continue
          </Button>
        </form>
      ) : null}
      {hasAuthenticator ? (
        <div className="tfa-alt">
          {showRecovery ? (
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
          ) : (
            <p>
              Lost your phone?{" "}
              <button className="link" type="button" onClick={() => setShowRecovery(true)}>
                Use a recovery code
              </button>
            </p>
          )}
        </div>
      ) : null}
      {!hasAuthenticator && error ? (
        <p className="danger" role="alert">
          {error}
        </p>
      ) : null}
    </>
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
            {replacing ? "Replace it" : "Turn it on"}
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
          Download hashinet-recovery-codes.txt
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
