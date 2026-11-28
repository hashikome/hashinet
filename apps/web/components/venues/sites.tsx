"use client";

import type { VenueSiteRecord, VenueSites } from "@hashinet/types";
import { useState } from "react";
import { api, messageOf } from "@/lib/api";
import { shortDate } from "@/lib/dates";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";
import { useCan } from "@/lib/session";
import { useSubmit } from "@/lib/submit";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Dialog } from "../ui/dialog";
import { Button, Field, Panel, Pill, Table, useToast } from "../ui/ui";

/** What a site costs, as its row says it. */
function costOf(s: VenueSiteRecord): string {
  if (s.cost === "included") return "Included";
  return `${tsh(s.slotTsh ?? 0)} ${s.cost === "paid" ? "paid" : "due"}`;
}

/**
 * A venue's Sites (prototype `sitesPanel`): what guests can open before paying, such as its own
 * website. The first comes with the venue; each more is a slot paid for once, invoiced when it is
 * added and open once HashiNet records the payment, on the owner's bill issue meanwhile. Its owner
 * and managers add and remove them; the owner downloads a waiting slot's invoice.
 */
export function SitesPanel({ venueId, venueName }: { venueId: string; venueName: string }) {
  const can = useCan();
  const manage = can("venue.site.manage");
  const owner = can("billing.read");
  const list = useLoad("venue-sites", () => api.get<VenueSites>(`/api/venues/${venueId}/sites`), [
    venueId,
  ]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<VenueSiteRecord | null>(null);
  const sites = list.data?.sites ?? [];
  const waiting = sites.filter((s) => s.state === "waiting").length;
  const counts = [
    `${sites.length - waiting} open before paying`,
    ...(waiting ? [`${waiting} waiting for payment`] : []),
  ].join(" · ");
  return (
    <Panel
      title="Sites"
      right={
        <div className="actions">
          {sites.length ? <span className="note">{counts}</span> : null}
          {manage && list.data ? (
            <Button icon="plus" onClick={() => setAdding(true)}>
              Add a site
            </Button>
          ) : null}
        </div>
      }
    >
      {list.error ? <LoadFailed error={list.error} retry={list.reload} /> : null}
      {list.data ? (
        sites.length ? (
          <Table
            narrow
            cols={[
              ["Site"],
              ["List"],
              ["Cost"],
              ["Added"],
              ...(manage ? ([[""]] as [string][]) : []),
            ]}
            rows={sites.map((s) => ({
              key: s.id,
              cells: [
                <span key="h">
                  <span className="name">{s.host}</span>
                  {s.note ? <div className="sub">{s.note}</div> : null}
                </span>,
                s.state === "open" ? (
                  <Pill key="l">Open before paying</Pill>
                ) : (
                  <Pill key="l" kind="wait">
                    Waiting for payment
                  </Pill>
                ),
                <span key="c" className="nowrap">
                  {costOf(s)}
                </span>,
                <span key="a">
                  <span className="nowrap">{shortDate(s.addedAt)}</span>
                  {s.addedBy ? <div className="sub">{s.addedBy}</div> : null}
                </span>,
                ...(manage
                  ? [
                      <div className="actions row-actions" key="x">
                        {owner && s.invoice ? <InvoicePdf invoice={s.invoice} /> : null}
                        <Button kind="danger" onClick={() => setRemoving(s)}>
                          Remove
                        </Button>
                      </div>,
                    ]
                  : []),
              ],
            }))}
          />
        ) : (
          <p className="muted">No sites yet. Guests reach only the portal until they pay.</p>
        )
      ) : null}
      {adding && list.data ? (
        <AddSite
          venueId={venueId}
          venueName={venueName}
          costTsh={list.data.nextCostTsh}
          owner={owner}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void list.reload();
          }}
        />
      ) : null}
      {removing ? (
        <RemoveSite
          venueId={venueId}
          site={removing}
          onClose={() => setRemoving(null)}
          onSaved={() => {
            setRemoving(null);
            void list.reload();
          }}
        />
      ) : null}
    </Panel>
  );
}

/** A waiting slot's invoice, as the PDF the API makes. */
function InvoicePdf({ invoice }: { invoice: { id: string; number: string } }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      icon="download"
      busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.download(`/api/billing/invoices/${invoice.id}/pdf`, `${invoice.number}.pdf`);
        } catch (e) {
          toast(messageOf(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      Invoice PDF
    </Button>
  );
}

/** Adding a site says what it costs before it is added (prototype `siteDialog`). */
function AddSite({
  venueId,
  venueName,
  costTsh,
  owner,
  onClose,
  onSaved,
}: {
  venueId: string;
  venueName: string;
  costTsh: number;
  owner: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, errors, run } = useSubmit();
  const [host, setHost] = useState("");
  const [note, setNote] = useState("");
  const paid = costTsh > 0;
  return (
    <Dialog label="Add a site" onClose={onClose}>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(
            () => api.post(`/api/venues/${venueId}/sites`, { host, note }),
            paid
              ? `Added. It opens once its ${tsh(costTsh)} invoice is paid${owner ? ": it's in Issues with how to pay" : "; the owner sees it in Issues"}.`
              : "Added. The router applies it within a minute.",
          );
          if (ok) onSaved();
        }}
      >
        <h2>Add a site</h2>
        <p className="muted">Guests can reach a site open before paying without a voucher.</p>
        <Field
          label="Site"
          id="sh"
          hint="Its address, such as hotel.co.tz"
          error={errors.host ? `The site ${errors.host}.` : undefined}
        >
          <input
            id="sh"
            className="input"
            type="text"
            inputMode="url"
            autoComplete="off"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </Field>
        <Field label="Why (optional)" id="sw" error={errors.note}>
          <input
            id="sw"
            className="input"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <p className="note">
          {paid
            ? `This one takes an extra slot: ${tsh(costTsh)}, paid once. Adding it invoices the slot, due in 7 days, on the owner's bill in Issues; the site opens once HashiNet records the payment.`
            : `Included: the first site open before paying comes with ${venueName}.`}
        </p>
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy} disabled={!host.trim()}>
            Add site
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Removing a site asks first: guests lose it at once. */
function RemoveSite({
  venueId,
  site,
  onClose,
  onSaved,
}: {
  venueId: string;
  site: VenueSiteRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <ConfirmDialog
      title={`Remove ${site.host}?`}
      confirm="Remove site"
      done={`${site.host} removed.`}
      what={
        site.state === "open"
          ? "Guests can no longer reach it before they pay. A slot already paid for stays with the venue."
          : "Its invoice is cancelled if nothing has been paid towards it yet; once something has, it stays on the bill."
      }
      send={() => api.delete(`/api/venues/${venueId}/sites/${site.id}`)}
      onClose={onClose}
      onDone={onSaved}
    />
  );
}
