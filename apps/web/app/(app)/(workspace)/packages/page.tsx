"use client";

import {
  MINIMUM_PRICE_TSH,
  type PackageList,
  type PackageRecord,
  type PackageResponse,
  type VenuePackages,
  type VenueRecord,
} from "@hashinet/types";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type ReactNode, Suspense, useState } from "react";
import { PausedDialog } from "@/components/hearth/bill-paused";
import { Dialog } from "@/components/hearth/dialog";
import { Button, Field, Head, Panel, Table, useToast } from "@/components/hearth/ui";
import { ApiRequestError, api, messageOf } from "@/lib/api";
import { DURATION_UNITS, type DurationUnit, formatDuration, toMinutes } from "@/lib/duration";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";
import { useCan, useSession } from "@/lib/session";
import { useVenues } from "@/lib/venues";

type Row = PackageList["packages"][number];
type Item = VenuePackages["catalogue"][number];
type Open =
  | { kind: "add"; venue: VenueRecord | null }
  | { kind: "price"; pkg: PackageRecord; venue: VenueRecord | null; item: Item | null }
  | { kind: "remove"; pkg: PackageRecord; venue: VenueRecord | null }
  | { kind: "paused" };

/** Packages keeps the venue it shows in the address, so a venue's packages can be linked to. */
export default function PackagesPage() {
  return (
    <Suspense>
      <Packages />
    </Suspense>
  );
}

/**
 * Packages (prototype `packages`): what guests can buy. The business's packages are sold at every
 * venue, at their price, unless a venue has its own price or stopped selling one; a venue can also
 * have packages of its own. A package keeps its name, time and devices for good, as its vouchers
 * carry them. The owner keeps the business's packages; whoever reaches the whole business sets a
 * venue's prices; a venue's managers add its own.
 */
function Packages() {
  const { me } = useSession();
  const can = useCan();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const { all: venues } = useVenues();
  const owner = can("package.manage");
  const whole = can("package.venue.assign");
  const ownPackages = can("package.venue.own");
  const [open, setOpen] = useState<Open | null>(null);
  // While the business can't sell, its package actions stay in view, quieter, and a tap says why,
  // as Sell does when no router serves (ADR-0014, 2).
  const paused = me.active.pause !== null;
  const act = (next: Open) => () => setOpen(paused ? { kind: "paused" } : next);
  const quiet = paused
    ? ({ className: "paused", "aria-disabled": true, "aria-describedby": "pkg-paused" } as const)
    : {};
  const solo = venues.length === 1 ? venues[0] : null;
  // Whoever reaches the whole business starts on every venue; a venue's manager on their venue.
  const asked = venues.find((v) => v.id === params.get("venue")) ?? null;
  const venue = asked ?? (whole ? null : (venues[0] ?? null));
  const show = (id: string) => router.replace(id === "all" ? "/packages" : `/packages?venue=${id}`);
  const picker =
    venues.length > 1 ? (
      <Field label="Venue" id="pv">
        <select
          id="pv"
          className="input picker"
          value={venue?.id ?? "all"}
          onChange={(e) => show(e.target.value)}
        >
          {whole ? <option value="all">All venues</option> : null}
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </Field>
    ) : null;
  const pausedNote = paused ? (
    <span className="sr" id="pkg-paused">
      Paused while the business can't sell.
    </span>
  ) : null;
  const dialogs = (reload: () => Promise<void>) =>
    open?.kind === "price" ? (
      <PriceDialog
        pkg={open.pkg}
        venue={open.venue}
        item={open.item}
        venues={venues.length}
        onClose={() => setOpen(null)}
        onSaved={reload}
      />
    ) : open?.kind === "remove" ? (
      <RemoveDialog
        pkg={open.pkg}
        venue={open.venue}
        venues={venues.length}
        onClose={() => setOpen(null)}
        onSaved={reload}
      />
    ) : open?.kind === "paused" ? (
      <PausedDialog what="packages" onClose={() => setOpen(null)} />
    ) : open?.kind === "add" ? (
      <AddDialog venue={open.venue} onClose={() => setOpen(null)} onSaved={reload} />
    ) : null;

  if (venue) {
    return (
      <VenueView
        key={venue.id}
        venue={venue}
        whole={whole}
        addOwn={ownPackages}
        quiet={quiet}
        act={act}
        picker={picker}
        pausedNote={pausedNote}
        dialogs={dialogs}
      />
    );
  }
  return (
    <AllVenues
      owner={owner}
      solo={solo}
      quiet={quiet}
      act={act}
      show={show}
      picker={picker}
      pausedNote={pausedNote}
      dialogs={dialogs}
      exportCsv={() =>
        api.download("/api/packages/export.csv", "packages.csv").catch((e) => toast(messageOf(e)))
      }
    />
  );
}

type Quiet = { className?: string; "aria-disabled"?: boolean; "aria-describedby"?: string };

/** Every venue's packages: the business's, with where each sells, and each venue's own. */
function AllVenues({
  owner,
  solo,
  quiet,
  act,
  show,
  picker,
  pausedNote,
  dialogs,
  exportCsv,
}: {
  owner: boolean;
  solo: VenueRecord | null;
  quiet: Quiet;
  act: (next: Open) => () => void;
  show: (id: string) => void;
  picker: ReactNode;
  pausedNote: ReactNode;
  dialogs: (reload: () => Promise<void>) => ReactNode;
  exportCsv: () => void;
}) {
  const { me } = useSession();
  const list = useLoad("packages", () => api.get<PackageList>("/api/packages"), [me.active.id]);
  const soldAt = (p: Row, of: number) => {
    if (p.venue) return `${p.venue.name} only`;
    const where =
      p.soldAt === 0
        ? "Not sold"
        : p.soldAt === of
          ? (solo?.name ?? "All venues")
          : `${p.soldAt} of ${of} venues`;
    return (
      <span>
        {where}
        {p.ownPrices ? (
          <div className="sub">
            {p.ownPrices} with {p.ownPrices === 1 ? "its" : "their"} own price
          </div>
        ) : null}
      </span>
    );
  };
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
            <Button icon="download" onClick={exportCsv}>
              Export CSV
            </Button>
            {owner ? (
              <Button
                kind="primary"
                icon="plus"
                {...quiet}
                onClick={act({ kind: "add", venue: null })}
              >
                Add a package
              </Button>
            ) : null}
          </>
        }
      />
      {pausedNote}
      {picker}
      {list.error ? <LoadFailed error={list.error} retry={list.reload} /> : null}
      {list.data ? (
        <Panel
          title="Packages"
          right={
            owner ? null : (
              <span className="note">
                Prices for all venues are set by the owner; pick a venue to set its own
              </span>
            )
          }
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
                  tsh(p.priceTsh),
                  soldAt(p, list.data?.venues ?? 0),
                  p.venue ? (
                    <div className="actions row-actions" key="a">
                      <Button onClick={() => show(p.venue?.id ?? "all")}>Open venue</Button>
                    </div>
                  ) : owner ? (
                    <div className="actions row-actions" key="a">
                      <Button
                        {...quiet}
                        onClick={act({ kind: "price", pkg: p, venue: null, item: null })}
                      >
                        Change price
                      </Button>
                      <Button
                        kind="danger"
                        {...quiet}
                        onClick={act({ kind: "remove", pkg: p, venue: null })}
                      >
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
      {dialogs(list.reload)}
    </>
  );
}

/** One venue's packages: the business's as this venue sells them, then its own. */
function VenueView({
  venue,
  whole,
  addOwn,
  quiet,
  act,
  picker,
  pausedNote,
  dialogs,
}: {
  venue: VenueRecord;
  whole: boolean;
  addOwn: boolean;
  quiet: Quiet;
  act: (next: Open) => () => void;
  picker: ReactNode;
  pausedNote: ReactNode;
  dialogs: (reload: () => Promise<void>) => ReactNode;
}) {
  const toast = useToast();
  const sold = useLoad(
    "venue-packages",
    () => api.get<VenuePackages>(`/api/venues/${venue.id}/packages`),
    [venue.id],
  );
  const [busy, setBusy] = useState<string | null>(null);
  /** Following the business's price again, or (not) selling it here: no dialog, a toast says it. */
  const quick = async (
    item: Item,
    body: { priceTsh: number | null; onSale: boolean },
    done: string,
  ) => {
    setBusy(item.package.id);
    try {
      await api.put(`/api/venues/${venue.id}/packages/${item.package.id}`, body);
      await sold.reload();
      toast(done);
    } catch (e) {
      toast(messageOf(e));
    } finally {
      setBusy(null);
    }
  };
  const tap = (run: () => void) => (quiet.className ? act({ kind: "paused" }) : run);
  const rows = (sold.data?.catalogue ?? []).map((item) => {
    const p = item.package;
    const tools = item.own ? (
      addOwn ? (
        <>
          <Button {...quiet} onClick={act({ kind: "price", pkg: p, venue, item })}>
            Change price
          </Button>
          <Button kind="danger" {...quiet} onClick={act({ kind: "remove", pkg: p, venue })}>
            Remove
          </Button>
        </>
      ) : null
    ) : !whole ? null : !item.onSale ? (
      <Button
        key="on"
        {...quiet}
        busy={busy === p.id}
        onClick={tap(() =>
          quick(item, { priceTsh: null, onSale: true }, `${p.name} is on sale here.`),
        )}
      >
        Sell it
      </Button>
    ) : (
      <>
        <Button {...quiet} onClick={act({ kind: "price", pkg: p, venue, item })}>
          Change price
        </Button>
        {item.ownPriceTsh ? (
          <Button
            {...quiet}
            busy={busy === p.id}
            onClick={tap(() =>
              quick(
                item,
                { priceTsh: null, onSale: true },
                `${p.name} is back on the default price.`,
              ),
            )}
          >
            Use default
          </Button>
        ) : (
          <Button
            {...quiet}
            busy={busy === p.id}
            onClick={tap(() =>
              quick(item, { priceTsh: null, onSale: false }, `${p.name} is no longer sold here.`),
            )}
          >
            Stop selling
          </Button>
        )}
      </>
    );
    const source = item.own ? (
      "This venue only"
    ) : !item.onSale ? (
      <span className="muted" key="s">
        Not sold here
      </span>
    ) : item.ownPriceTsh ? (
      <span key="s">
        Own price<div className="sub">default {tsh(p.priceTsh)}</div>
      </span>
    ) : (
      "Default"
    );
    return {
      key: p.id,
      cells: [
        <span className="name" key="n">
          {p.name}
        </span>,
        formatDuration(p.durationMinutes),
        p.deviceLimit,
        item.onSale ? (
          tsh(item.ownPriceTsh ?? p.priceTsh)
        ) : (
          <span className="muted" key="p">
            —
          </span>
        ),
        source,
        <div className="actions row-actions" key="a">
          {tools}
        </div>,
      ],
    };
  });
  return (
    <>
      <Head
        title="Packages"
        sub={`What guests can buy at ${venue.name}`}
        actions={
          addOwn ? (
            <Button kind="primary" icon="plus" {...quiet} onClick={act({ kind: "add", venue })}>
              Add for this venue
            </Button>
          ) : null
        }
      />
      {pausedNote}
      {picker}
      {sold.error ? <LoadFailed error={sold.error} retry={sold.reload} /> : null}
      {sold.data ? (
        <Panel
          title="Packages"
          right={whole ? null : <span className="note">Default prices are set by the owner</span>}
        >
          {rows.length ? (
            <Table
              cols={[["Name"], ["Time"], ["Devices", true], ["Price", true], ["Source"], [""]]}
              rows={rows}
            />
          ) : (
            <p className="muted empty">
              No packages yet.{" "}
              {addOwn ? "Add one for this venue, and guests can buy it." : "The owner adds them."}
            </p>
          )}
        </Panel>
      ) : null}
      {dialogs(sold.reload)}
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

/**
 * A package's price: the business's (every venue that follows it changes), a venue's own price for
 * it, or the price of a venue's own package.
 */
function PriceDialog({
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

function RemoveDialog({
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
function AddDialog({
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
