"use client";

import type { Me } from "@hashinet/types";
import { type FormEvent, useState } from "react";
import { Button, CopyText, Field, Panel, useToast } from "@/components/hearth/ui";
import { ApiRequestError, api, messageOf } from "@/lib/api";
import { useSession } from "@/lib/session";

/** Profile: the person's name, which they change, and their sign-in email, which support changes. */
export default function ProfilePage() {
  const { me, replace } = useSession();
  const toast = useToast();
  const [name, setName] = useState(me.name);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const changesEmail = me.active.role === "owner" || me.active.scope === "platform";

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      replace(await api.put<Me>("/api/me", { name }));
      toast("Saved");
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.details?.name
            ? `Name ${err.details.name}.`
            : err.message
          : messageOf(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Profile">
      <form className="form" onSubmit={save} noValidate>
        <Field label="Name" id="name" error={error}>
          <input
            id="name"
            className="input"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "name-error" : undefined}
          />
        </Field>
        <div className="field">
          <span className="lbl">Email</span>
          <div>
            <CopyText text={me.email} />
          </div>
          <span className="hint">
            Your sign-in.{" "}
            {changesEmail ? "HashiNet's support can change it." : "Ask an owner to change it."}
          </span>
        </div>
        <div className="form-save">
          <Button kind="primary" type="submit" busy={busy}>
            Save
          </Button>
        </div>
      </form>
    </Panel>
  );
}
