"use client";

import type { RouterResponse } from "@hashinet/types";
import { useState } from "react";
import { Button, Field, Panel, useToast } from "@/components/ui/ui";
import { ApiRequestError, api, messageOf } from "@/lib/api";

export function AddRouter({
  venueId,
  venueName,
  onAdded,
}: {
  venueId: string;
  venueName: string;
  onAdded: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: venueName,
    model: "hAP ax²",
    ipAddress: "",
    networkRange: "10.5.50.0/24",
    hotspotInterface: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Panel title="Add a router">
      <p className="muted" style={{ marginBottom: 12 }}>
        A few details, then a setup script for the MikroTik router.
      </p>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErrors({});
          try {
            await api.post<RouterResponse>("/api/routers", {
              venueId,
              name: form.name,
              model: form.model,
              ipAddress: form.ipAddress,
              apiUsername: "hashinet",
              ssid: form.name,
              networkRange: form.networkRange,
              hotspotInterface: form.hotspotInterface.trim(),
            });
            await onAdded();
            toast("Router added. Get its setup script next.");
          } catch (err) {
            if (err instanceof ApiRequestError && err.details) setErrors(err.details);
            else toast(messageOf(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label="Router name"
          id="rn"
          error={errors.name ? `The name ${errors.name}.` : undefined}
          hint="The WiFi name guests see"
        >
          <input id="rn" className="input" value={form.name} onChange={set("name")} />
        </Field>
        <Field
          label="Which model?"
          id="rm"
          hint="HashiNet checks it against the router itself when it connects"
        >
          <select id="rm" className="input" value={form.model} onChange={set("model")}>
            {[
              "hAP ax²",
              "hAP ax³",
              "hAP ac²",
              "hAP lite",
              "Another MikroTik router on RouterOS 7",
            ].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field
          label="Its address on the venue's network"
          id="ri"
          error={errors.ipAddress ? `The address ${errors.ipAddress}.` : undefined}
          hint="A free address on the ISP router's network, such as 192.168.1.2"
        >
          <input
            id="ri"
            className="input"
            inputMode="decimal"
            value={form.ipAddress}
            onChange={set("ipAddress")}
          />
        </Field>
        <details>
          <summary className="small muted" style={{ cursor: "pointer" }}>
            Hotspot network
          </summary>
          <div className="form" style={{ marginTop: 10 }}>
            <Field
              label="Network"
              id="rh"
              error={errors.networkRange ? `The network ${errors.networkRange}.` : undefined}
              hint="Change it only if it clashes with the venue's own network"
            >
              <input
                id="rh"
                className="input"
                value={form.networkRange}
                onChange={set("networkRange")}
              />
            </Field>
            <Field
              label="Hotspot port"
              id="rp"
              error={errors.hotspotInterface ? `The port ${errors.hotspotInterface}.` : undefined}
              hint="Leave empty to use the router's WiFi. A board without WiFi names its port, such as ether2"
            >
              <input
                id="rp"
                className="input"
                value={form.hotspotInterface}
                onChange={set("hotspotInterface")}
              />
            </Field>
          </div>
        </details>
        <div className="form-save">
          <Button kind="primary" type="submit" busy={busy}>
            Add router
          </Button>
        </div>
      </form>
    </Panel>
  );
}
