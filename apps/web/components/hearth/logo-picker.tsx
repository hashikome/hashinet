"use client";

import { type ReactNode, useRef, useState } from "react";
import { messageOf } from "@/lib/api";
import { Button, useToast } from "./ui";

/**
 * Upload, replace or remove a logo: a venue's on Captive portal, the business's on General. The API
 * re-encodes whatever is sent; it answers with what the screen shows next.
 */
export function LogoPicker<T>({
  has,
  upload,
  remove,
  onSaved,
  note,
}: {
  /** Whether there is a logo of this one's own to replace or remove. */
  has: boolean;
  upload: (file: File) => Promise<T>;
  remove: () => Promise<T>;
  onSaved: (next: T) => void;
  /** What shows now, said before the file rules: "Using the business logo". */
  note?: ReactNode;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const send = async (call: () => Promise<T>, done: string) => {
    setBusy(true);
    try {
      onSaved(await call());
      toast(done);
    } catch (e) {
      toast(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="actions">
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            e.target.value = "";
            if (chosen) void send(() => upload(chosen), "Logo uploaded.");
          }}
        />
        <Button icon="upload" busy={busy} onClick={() => file.current?.click()}>
          {has ? "Replace logo" : "Upload a logo"}
        </Button>
        {has ? (
          <Button kind="danger" disabled={busy} onClick={() => void send(remove, "Logo removed.")}>
            Remove
          </Button>
        ) : null}
      </div>
      <div className="hint">
        {note ? <>{note}. </> : null}A square JPEG, PNG or WebP, up to 8 MB
      </div>
    </div>
  );
}
