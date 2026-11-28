"use client";

import type { IssueDetail } from "@hashinet/types";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button, Field } from "@/components/ui/ui";

export function HandDialog({
  detail,
  busy,
  onClose,
  onSave,
}: {
  detail: IssueDetail;
  busy: boolean;
  onClose: () => void;
  onSave: (to: string, note: string) => void;
}) {
  const [to, setTo] = useState(detail.handTo[0]?.membershipId ?? "");
  const [note, setNote] = useState("");
  return (
    <Dialog label="Hand this issue to" onClose={onClose}>
      <h2>Hand this issue to</h2>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(to, note.trim());
        }}
      >
        <Field label="Colleague" id="hw">
          <select id="hw" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            {detail.handTo.map((p) => (
              <option key={p.membershipId} value={p.membershipId}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Note for them (optional)"
          id="hn"
          hint="Such as when the owner can take a call"
        >
          <input
            id="hn"
            className="input"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy}>
            Hand over
          </Button>
          <Button data-cancel onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function TakeDialog({
  holder,
  busy,
  onClose,
  onSave,
}: {
  holder: string;
  busy: boolean;
  onClose: () => void;
  onSave: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog label="Take over" onClose={onClose}>
      <h2>Take over from {holder}</h2>
      <p className="muted">{holder} sees your reason on the issue.</p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) onSave(reason.trim());
        }}
      >
        <Field label="Reason" id="tr" hint="Such as who is off today, or what is waiting">
          <input
            id="tr"
            className="input"
            maxLength={500}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy} disabled={!reason.trim()}>
            Take over
          </Button>
          <Button data-cancel onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
