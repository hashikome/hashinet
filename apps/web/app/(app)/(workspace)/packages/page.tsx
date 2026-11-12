"use client";

import type { PackageList, PackageRecord, PackageResponse, VenuePackages } from "@hashinet/types";
import { type FormEvent, useState } from "react";
import { Dialog } from "@/components/hearth/dialog";
import { Button, Field, Head, Panel, Table, tsh, useToast } from "@/components/hearth/ui";
import { ApiRequestError, api, messageOf } from "@/lib/api";
import { DURATION_UNITS, type DurationUnit, formatDuration, toMinutes } from "@/lib/duration";
import { LoadFailed, useLoad } from "@/lib/load";
import { useCan, useSession } from "@/lib/session";
import { useVenues } from "@/lib/venues";

type Open =
  | { kind: "add" }
  | { kind: "price"; pkg: PackageRecord }
  | { kind: "remove"; pkg: PackageRecord };

/**
 * Packages (prototype `packages`): what guests can buy. A package keeps its name, time and devices
 * for good, as its vouchers carry them; the owner changes its price, removes it, or adds a new one.
 */
export default function PackagesPage() {
  const { me } = useSession();
  const can = useCan();
  const toast = useToast();
  const { all: venues } = useVenues();
  const owner = can("package.manage");
  const [open, setOpen] = useState<Open | null>(null);
  const list = useLoad(async () => {
    const [{ packages }, sold] = await Promise.all([
      api.get<PackageList>("/api/packages"),
      Promise.all(venues.map((v) => api.get<VenuePackages>(`/api/venues/${v.id}/packages`))),
    ]);
    return { packages, sold };
  }, [me.active.id, venues.map((v) => v.id).join()]);

  const soldAt = (p: PackageRecord) => {
    const at = venues.filter((_, i) => list.data?.sold[i]?.packages.some((x) => x.id === p.id));
    if (venues.length === 1) return at.length ? venues[0]?.name : "Not sold";
    return at.length === venues.length ? "All venues" : `${at.length} of ${venues.length} venues`;
  };
  const solo = venues.length === 1 ? venues[0] : null;

  return (
    <>
      <Head
        title="Packages"
        sub={
          solo
            ? `What guests can buy · ${solo.name}`
            : "What every venue sells, and every new venue starts with"
        }
        actions={
          <>
            <Button
              icon="download"
              onClick={() =>
                api
                  .download("/api/packages/export.csv", "packages.csv")
                  .catch((e) => toast(messageOf(e)))
              }
            >
              Export CSV
            </Button>
            {owner ? (
              <Button kind="primary" icon="plus" onClick={() => setOpen({ kind: "add" })}>
                Add a package
              </Button>
            ) : null}
          </>
        }
      />
      {list.error ? <LoadFailed error={list.error} retry={list.reload} /> : null}
      {list.data ? (
        <Panel
          title="Packages"
          right={owner ? null : <span className="note">Prices are set by the owner</span>}
        >
          {list.data.packages.length ? (
            <Table
              cols={[["Name"], ["Time"], ["Devices", true], ["Price", true], ["Sold at"], [""]]}
              rows={list.data.packages.map((p) => ({
                key: p.id,
                cells: [
                  <span className="name" key="n">
                    {p.name}
                  </span>,
                  formatDuration(p.durationMinutes),
                  p.deviceLimit,
                  tsh(Number(p.priceTsh)),
                  soldAt(p),
                  owner ? (
                    <div className="actions row-actions" key="a">
                      <Button onClick={() => setOpen({ kind: "price", pkg: p })}>
                        Change price
                      </Button>
                      <Button kind="danger" onClick={() => setOpen({ kind: "remove", pkg: p })}>
                        Remove
                      </Button>
                    </div>
                  ) : (
                    ""
                  ),
                ],
              }))}
            />
          ) : (
            <p className="muted empty">
              No packages yet. {owner ? "Add one, and guests can buy it." : "The owner adds them."}
            </p>
          )}
        </Panel>
      ) : null}
      {open?.kind === "price" ? (
        <PriceDialog
          pkg={open.pkg}
          venues={venues.length}
          onClose={() => setOpen(null)}
          onSaved={list.reload}
        />
      ) : open?.kind === "remove" ? (
        <RemoveDialog
          pkg={open.pkg}
          venues={venues.length}
          onClose={() => setOpen(null)}
          onSaved={list.reload}
        />
      ) : open?.kind === "add" ? (
        <AddDialog onClose={() => setOpen(null)} onSaved={list.reload} />
      ) : null}
    </>
  );
}

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

function PriceDialog({
  pkg,
  venues,
  onClose,
  onSaved,
}: {
  pkg: PackageRecord;
  venues: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [price, setPrice] = useState(String(Number(pkg.priceTsh)));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put<PackageResponse>(`/api/packages/${pkg.id}`, {
        ...asInput(pkg),
        priceTsh: Number(price),
      });
      await onSaved();
      onClose();
      toast("Saved");
    } catch (err) {
      setError(fieldError(err, "priceTsh", "Price") || messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label={`Change the price of ${pkg.name}`} onClose={onClose}>
      <h2>{pkg.name}</h2>
      <p className="muted">
        {venues > 1
          ? "Every venue selling it changes now."
          : "Guests see the new price straight away."}{" "}
        Printed vouchers keep the price on them.
      </p>
      <form className="form" onSubmit={save} noValidate>
        <Field label="Price in TSh" id="pp" error={error}>
          <input
            id="pp"
            className="input"
            type="number"
            inputMode="numeric"
            min={500}
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

function RemoveDialog({
  pkg,
  venues,
  onClose,
  onSaved,
}: {
  pkg: PackageRecord;
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
        Guests can no longer buy it{venues > 1 ? " at any venue" : ""}, on the portal or at the
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
              await api.delete(`/api/packages/${pkg.id}`);
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

function AddDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
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
      await api.post<PackageResponse>("/api/packages", {
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
    <Dialog label="Add a package" onClose={onClose}>
      <h2>Add a package</h2>
      <p className="muted">A guest buys time on the WiFi, for one or more devices.</p>
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
          {input("pr", "price", "priceTsh", { ...number, required: true, min: 500, step: 100 })}
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
