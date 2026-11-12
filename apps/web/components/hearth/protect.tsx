"use client";

import { useState } from "react";
import { messageOf } from "@/lib/api";
import { addPasskey, cancelled, passkeysSupported, signInWithPasskey } from "@/lib/passkeys";
import { useSession } from "@/lib/session";
import { Attention, Button, ButtonLink, Head, Panel, useToast } from "./ui";

/** The two ways to protect a sign-in, as one pair of actions. */
export function ProtectChoices() {
  const { refresh } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="actions">
      <ButtonLink href="/account/sign-in?flow=authenticator" kind="primary">
        Set up an authenticator app
      </ButtonLink>
      {passkeysSupported() ? (
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await addPasskey();
              await refresh();
              toast("Passkey added. It signs you in from now on.");
            } catch (e) {
              if (!cancelled(e)) toast(messageOf(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Add a passkey
        </Button>
      ) : null}
    </div>
  );
}

/** Signs in again with the passkey the person has, so this session counts as protected. */
export function PasskeyAgain() {
  const { refresh } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      kind="primary"
      busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signInWithPasskey();
          await refresh();
        } catch (e) {
          if (!cancelled(e)) toast(messageOf(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      Sign in with your passkey
    </Button>
  );
}

/**
 * What a session that may reach only Account and security sees instead of a page (ADR-0011, 9):
 * sign in with the passkey it has, or protect the sign-in first.
 */
export function ProtectGate() {
  const { me } = useSession();
  if (me.protection.passkeys > 0) {
    return (
      <>
        <Head
          title="Sign in with your passkey"
          sub="An email code alone reaches only Account and security"
        />
        <Panel title="One of these, then you can carry on">
          <p className="muted" style={{ marginBottom: 12 }}>
            You have a passkey, so sign in with it. Or set up an authenticator app, and an email
            code with its code works too.
          </p>
          <div className="actions">
            <PasskeyAgain />
            <ButtonLink href="/account/sign-in?flow=authenticator">
              Set up an authenticator app
            </ButtonLink>
          </div>
        </Panel>
      </>
    );
  }
  return (
    <>
      <Head
        title="Protect your sign-in first"
        sub={
          me.active.scope === "platform"
            ? "Everyone on HashiNet's team does this before they start work"
            : "Your 7 days to get set up without it have ended"
        }
      />
      <Panel title="One of these, then you can start">
        <p className="muted" style={{ marginBottom: 12 }}>
          An authenticator app confirms each sign-in after the email code; a passkey signs you in
          with one tap. Either one means an email code alone can&apos;t get into your account.
        </p>
        <ProtectChoices />
      </Panel>
    </>
  );
}

/** Under the overview's title while an owner or manager gets set up without protection. */
export function ProtectNotice() {
  const { me } = useSession();
  const ends = me.protection.setupEndsAt;
  if (me.active.access !== "setup" || !ends) return null;
  const days = Math.max(1, Math.ceil((Date.parse(ends) - Date.now()) / 86_400_000));
  return (
    <Attention title="Protect your sign-in before you start serving" action={<ProtectChoices />}>
      Set up an authenticator app or add a passkey. Until then no venue goes live, so someone who
      gets hold of an email code can&apos;t sell or change what guests get. {days}{" "}
      {days === 1 ? "day" : "days"} left to get set up; after that, only Account and security opens.
    </Attention>
  );
}
