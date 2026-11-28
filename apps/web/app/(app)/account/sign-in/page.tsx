"use client";

import type { Me, MyPasskey } from "@hashinet/types";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PasskeyAgain } from "@/components/people/protect";
import { Dialog } from "@/components/ui/dialog";
import { Attention, Button, Panel, Pill, SettingRow, useToast } from "@/components/ui/ui";
import { ApiRequestError, api, messageOf } from "@/lib/api";
import { longDate, todayIso } from "@/lib/dates";
import { useLoad } from "@/lib/load";
import { passkeysSupported } from "@/lib/passkeys";
import { useSession } from "@/lib/session";
import { Codes, RemoveApp, Scan } from "./authenticator-flows";
import { ACTION, Confirm, type Flow, FlowCard, type Kind, type Step } from "./flows";
import { AddPasskey, TryPasskey } from "./passkey-flows";

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
