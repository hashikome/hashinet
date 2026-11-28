"use client";

import {
  MINIMUM_PRICE_TSH,
  type PackageRecord,
  type PackageResponse,
  type VenuePackages,
  type VenueRecord,
} from "@hashinet/types";
import { type FormEvent, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button, Field, useToast } from "@/components/ui/ui";
import { ApiRequestError, api, messageOf } from "@/lib/api";
import { DURATION_UNITS, type DurationUnit, toMinutes } from "@/lib/duration";
import type { Item } from "./page";

/** The package as the API takes it on update: everything, with the change. */
const asInput = (p: PackageRecord) => ({
  name: p.name,
  description: p.description,
  durationMinutes: p.durationMinutes,
  downloadSpeedMbps: p.downloadSpeedMbps,
  uploadSpeedMbps: p.uploadSpeedMbps,
  dataLimitGb: p.dataLimitGb,
  deviceLimit: p.deviceLimit,
  priceTsh: Number(p.priceTsh),
  features: p.features,
  isActive: p.isActive,
  throttledDownloadMbps: p.throttledDownloadMbps,
  throttledUploadMbps: p.throttledUploadMbps,
  peakStartHour: p.peakStartHour,
  peakEndHour: p.peakEndHour,
  throttleAfterGb: p.throttleAfterGb,
});

/** The API's message for one field, as "Price must be at least 100". */
const fieldError = (e: unknown, field: string, label: string) =>
  e instanceof ApiRequestError && e.details?.[field] ? `${label} ${e.details[field]}.` : "";

/**
 * A package's price: the business's (every venue that follows it changes), a venue's own price for
 * it, or the price of a venue's own package.
 */
export function PriceDialog({
  pkg,
  venue,
  item,
  venues,
  onClose,
  onSaved,
}: {
  pkg: PackageRecord;
  venue: VenueRecord | null;
  item: Item | null;
  venues: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [price, setPrice] = useState(String(Number(item?.ownPriceTsh ?? pkg.priceTsh)));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (!venue) {
        await api.put<PackageResponse>(`/api/packages/${pkg.id}`, {
          ...asInput(pkg),
          priceTsh: Number(price),
        });
      } else if (item?.own) {
        await api.put<VenuePackages>(`/api/venues/${venue.id}/own-packages/${pkg.id}`, {
          ...asInput(pkg),
          priceTsh: Number(price),
        });
      } else {
        await api.put<VenuePackages>(`/api/venues/${venue.id}/packages/${pkg.id}`, {
          priceTsh: Number(price),
          onSale: true,
        });
      }
      await onSaved();
      onClose();
      toast("Saved");
    } catch (err) {
      setError(fieldError(err, "priceTsh", "Price") || messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  const reach = venue
    ? `Guests at ${venue.name} see the new price straight away.`
    : venues > 1
      ? "Every venue on the default price changes now; a venue with its own price keeps it."
      : "Guests see the new price straight away.";
  return (
    <Dialog label={`Change the price of ${pkg.name}`} onClose={onClose}>
      <h2>
        {pkg.name}
        {venue ? ` at ${venue.name}` : ""}
      </h2>
      <p className="muted">{reach} Vouchers already sold keep the price they were sold at.</p>
      <form className="form" onSubmit={save} noValidate>
        <Field label="Price in TSh" id="pp" error={error}>
          <input
            id="pp"
            className="input"
            type="number"
            inputMode="numeric"
            min={MINIMUM_PRICE_TSH}
            step={100}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "pp-error" : undefined}
          />
        </Field>
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy}>
            Save price
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function RemoveDialog({
  pkg,
  venue,
  venues,
  onClose,
  onSaved,
}: {
  pkg: PackageRecord;
  venue: VenueRecord | null;
  venues: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog label={`Remove ${pkg.name}`} onClose={onClose} alert>
      <h2>Remove {pkg.name}?</h2>
      <p className="muted">
        Guests can no longer buy it
        {venue ? ` at ${venue.name}` : venues > 1 ? " at any venue" : ""}, on the portal or at the
        counter. Vouchers already printed or sold keep working until their time ends, and its sales
        stay in your figures.
      </p>
      <div className="dialog-actions">
        <Button
          kind="danger"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.delete(
                venue
                  ? `/api/venues/${venue.id}/own-packages/${pkg.id}`
                  : `/api/packages/${pkg.id}`,
              );
              await onSaved();
              onClose();
              toast(`${pkg.name} removed`);
            } catch (e) {
              toast(messageOf(e));
              setBusy(false);
            }
          }}
        >
          Remove package
        </Button>
        <Button data-cancel onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

/** A package for every venue (the owner's), or one sold only at a venue (its managers'). */
export function AddDialog({
  venue,
  onClose,
  onSaved,
}: {
  venue: VenueRecord | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: "",
    time: "1",
    unit: "days" as DurationUnit,
    devices: "1",
    price: "",
    download: "10",
    upload: "",
    data: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const optional = (v: string) => (v.trim() === "" ? null : Number(v));

  async function save(e: FormEvent) {
    e.preventDefault();
    const minutes = toMinutes(Number(form.time), form.unit);
    if (minutes === null) return setErrors({ durationMinutes: "Time must be more than nothing." });
    setBusy(true);
    try {
      await api.post(venue ? `/api/venues/${venue.id}/own-packages` : "/api/packages", {
        name: form.name,
        durationMinutes: minutes,
        deviceLimit: Number(form.devices),
        priceTsh: Number(form.price),
        downloadSpeedMbps: Number(form.download),
        uploadSpeedMbps: optional(form.upload),
        dataLimitGb: optional(form.data),
      });
      await onSaved();
      onClose();
      toast(`${form.name.trim()} added`);
    } catch (err) {
      const label: Record<string, string> = {
        name: "Name",
        durationMinutes: "Time",
        deviceLimit: "Devices",
        priceTsh: "Price",
        downloadSpeedMbps: "Download",
        uploadSpeedMbps: "Upload",
        dataLimitGb: "Data limit",
      };
      if (err instanceof ApiRequestError && err.details) {
        setErrors(
          Object.fromEntries(
            Object.entries(err.details).map(([k, v]) => [k, `${label[k] ?? k} ${v}.`]),
          ),
        );
      } else toast(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  const input = (id: string, key: keyof typeof form, field: string, extra: object = {}) => (
    <input
      id={id}
      className="input"
      value={form[key]}
      onChange={set(key)}
      aria-invalid={errors[field] ? true : undefined}
      aria-describedby={errors[field] ? `${id}-error` : undefined}
      {...extra}
    />
  );
  const number = { type: "number", inputMode: "numeric", min: 0 };
  return (
    <Dialog label={venue ? `Add a package for ${venue.name}` : "Add a package"} onClose={onClose}>
      <h2>{venue ? `Add a package for ${venue.name}` : "Add a package"}</h2>
      <p className="muted">
        A guest buys time on the WiFi, for one or more devices
        {venue ? `. Only ${venue.name} sells it.` : "."}
      </p>
      <form className="form pkg-form" onSubmit={save} noValidate>
        <Field
          label="Name"
          id="pn"
          error={errors.name}
          hint="What guests see on the portal and on printed vouchers"
        >
          {input("pn", "name", "name", { required: true, autoComplete: "off" })}
        </Field>
        <div className="even">
          <Field label="Time" id="pt" error={errors.durationMinutes}>
            <div className="input-pair">
              {input("pt", "time", "durationMinutes", number)}
              <select className="input" aria-label="Unit" value={form.unit} onChange={set("unit")}>
                {DURATION_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Devices" id="pd" error={errors.deviceLimit}>
            {input("pd", "devices", "deviceLimit", number)}
          </Field>
        </div>
        <Field label="Price in TSh" id="pr" error={errors.priceTsh}>
          {input("pr", "price", "priceTsh", {
            ...number,
            required: true,
            min: MINIMUM_PRICE_TSH,
            step: 100,
          })}
        </Field>
        <details
          open={Boolean(errors.downloadSpeedMbps || errors.uploadSpeedMbps || errors.dataLimitGb)}
        >
          <summary className="small muted" style={{ cursor: "pointer" }}>
            Speed and data limits
          </summary>
          <div className="form" style={{ marginTop: 10 }}>
            <div className="even">
              <Field label="Download, Mbps" id="pdl" error={errors.downloadSpeedMbps}>
                {input("pdl", "download", "downloadSpeedMbps", number)}
              </Field>
              <Field
                label="Upload, Mbps"
                id="pul"
                error={errors.uploadSpeedMbps}
                hint="Empty: as download"
              >
                {input("pul", "upload", "uploadSpeedMbps", number)}
              </Field>
            </div>
            <Field
              label="Data limit, GB"
              id="pdg"
              error={errors.dataLimitGb}
              hint="Leave empty for no limit"
            >
              {input("pdg", "data", "dataLimitGb", number)}
            </Field>
          </div>
        </details>
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy}>
            Save package
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
