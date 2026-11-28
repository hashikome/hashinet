"use client";

import type { RouterRecord } from "@hashinet/types";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button, Field } from "@/components/ui/ui";
import { api } from "@/lib/api";
import { useSubmit } from "@/lib/submit";

/** Which port the hotspot runs on: the router's WiFi, or a named port on a board without one. */
export function HotspotPortDialog({
  router,
  onClose,
  onSaved,
}: {
  router: RouterRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { busy, errors, run } = useSubmit();
  const [port, setPort] = useState(router.hotspotInterface ?? "");
  return (
    <Dialog label="Hotspot port" onClose={onClose}>
      <h2>Hotspot port</h2>
      <p className="muted">It takes effect the next time you run Set up.</p>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const saved = await run(
            () =>
              api.put(`/api/routers/${router.id}/hotspot-port`, {
                hotspotInterface: port.trim() || null,
              }),
            port.trim() ? `The hotspot runs on ${port.trim()}.` : "The hotspot runs on its WiFi.",
          );
          if (saved) await onSaved();
        }}
      >
        <Field
          label="Port"
          id="hp"
          error={errors.hotspotInterface ? `The port ${errors.hotspotInterface}.` : undefined}
          hint="Leave empty to use the router's WiFi. A board without WiFi names its port, such as ether2"
        >
          <input id="hp" className="input" value={port} onChange={(e) => setPort(e.target.value)} />
        </Field>
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy}>
            Save
          </Button>
          <Button data-cancel onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
