"use client";

import type { PackageList, PackageRecord, VenuePackages, VenueRecord } from "@hashinet/types";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useState } from "react";
import { PausedDialog } from "@/components/platform/bill-paused";
import { Button, Field, Head, Panel, Table, useToast } from "@/components/ui/ui";
import { api, messageOf } from "@/lib/api";
import { formatDuration } from "@/lib/duration";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";
import { useCan, useSession } from "@/lib/session";
import { useVenues } from "@/lib/venues";
import { AddDialog, PriceDialog, RemoveDialog } from "./dialogs";

type Row = PackageList["packages"][number];
export type Item = VenuePackages["catalogue"][number];
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
  // One guard for every action: while paused, a tap says why instead.
  const guard = (run: () => void) => (paused ? () => setOpen({ kind: "paused" }) : run);
  const act = (next: Open) => guard(() => setOpen(next));
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
        guard={guard}
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
  guard,
  picker,
  pausedNote,
  dialogs,
}: {
  venue: VenueRecord;
  whole: boolean;
  addOwn: boolean;
  quiet: Quiet;
  act: (next: Open) => () => void;
  guard: (run: () => void) => () => void;
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
    packageId: string,
    body: { priceTsh: number | null; onSale: boolean },
    done: string,
  ) => {
    setBusy(packageId);
    try {
      // The API answers with the venue's packages as they are now.
      sold.set(await api.put<VenuePackages>(`/api/venues/${venue.id}/packages/${packageId}`, body));
      toast(done);
    } catch (e) {
      toast(messageOf(e));
    } finally {
      setBusy(null);
    }
  };
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
        onClick={guard(() =>
          quick(p.id, { priceTsh: null, onSale: true }, `${p.name} is on sale here.`),
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
            onClick={guard(() =>
              quick(
                p.id,
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
            onClick={guard(() =>
              quick(p.id, { priceTsh: null, onSale: false }, `${p.name} is no longer sold here.`),
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
