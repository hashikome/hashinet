"use client";

import { useState } from "react";
import { messageOf } from "@/lib/api";
import { Dialog } from "./dialog";
import { Button, useToast } from "./ui";

/**
 * Asks before something that can't be taken back (Restore defaults, Remove): what goes, then the
 * one action, with focus starting on Cancel. The API's answer is handed to `onDone`.
 */
export function ConfirmDialog<T>({
  title = "Restore the defaults?",
  confirm = "Restore defaults",
  done = "Defaults restored.",
  what,
  send,
  onClose,
  onDone,
}: {
  title?: string;
  confirm?: string;
  done?: string;
  what: string;
  send: () => Promise<T>;
  onClose: () => void;
  onDone: (next: T) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog label={title} onClose={onClose} alert>
      <h2>{title}</h2>
      <p className="muted">{what}</p>
      <div className="dialog-actions">
        <Button
          kind="danger"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              onDone(await send());
              toast(done);
            } catch (e) {
              toast(messageOf(e));
              setBusy(false);
            }
          }}
        >
          {confirm}
        </Button>
        <Button data-cancel onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
