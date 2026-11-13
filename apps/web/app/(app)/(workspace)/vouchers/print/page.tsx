"use client";

import type { VenuePackages, VoucherBatchDetail } from "@hashinet/types";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { Button, ButtonLink, Field, Head, Panel, useToast } from "@/components/hearth/ui";
import { type CardFace, VoucherCard } from "@/components/hearth/voucher-card";
import { ApiRequestError, api, messageOf } from "@/lib/api";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";
import { useCan } from "@/lib/session";
import { useVenues } from "@/lib/venues";

/** Twelve 100 by 46 mm cards fit on one A4 sheet, two across. */
const PER_SHEET = 12;
const SAMPLE_CODES = ["482716936518", "730164528194"];

/**
 * Print vouchers (prototype `print`): a sheet of codes to sell at the counter. Making them needs a
 * protected sign-in (ADR-0011, 9); the cards print alone, twelve to an A4 page.
 */
export default function PrintPage() {
  const can = useCan();
  const toast = useToast();
  const { all, shown } = useVenues();
  const [venueId, setVenueId] = useState(shown[0]?.id ?? all[0]?.id ?? "");
  const [packageId, setPackageId] = useState("");
  const [count, setCount] = useState(String(PER_SHEET));
  const [mono, setMono] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<CardFace[]>([]);
  const venue = all.find((v) => v.id === venueId);
  const sold = useLoad(
    () =>
      venueId ? api.get<VenuePackages>(`/api/venues/${venueId}/packages`) : Promise.resolve(null),
    [venueId],
  );
  const packages = sold.data?.packages ?? [];
  const chosen = packages.find((p) => p.id === packageId) ?? packages[0];
  const face = (code: string): CardFace => ({
    code,
    venue: venue?.name ?? "",
    price: Number(chosen?.priceTsh ?? 0),
    packageName: chosen?.name ?? "",
    devices: chosen?.deviceLimit ?? 1,
  });

  // Once the sheet is on the page, the browser's print dialog opens for it.
  useEffect(() => {
    if (sheet.length === 0) return;
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [sheet]);

  if (!can("voucher.print")) {
    return (
      <>
        <Head title="Print vouchers" sub="A sheet of codes to sell at the counter" />
        <Panel title="Protect your sign-in first">
          <p className="muted">
            Vouchers are made only once your sign-in is protected, so an email code alone can&apos;t
            make something guests pay for.
          </p>
          <div className="actions" style={{ marginTop: 12 }}>
            <ButtonLink href="/account/sign-in" kind="primary">
              Open Account and security
            </ButtonLink>
          </div>
        </Panel>
      </>
    );
  }

  async function print(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true);
    setError("");
    try {
      const made = await api.post<VoucherBatchDetail>("/api/vouchers/batches", {
        venueId,
        packageId: chosen.id,
        quantity: Number(count),
      });
      // Each card shows what its voucher was made with, never what this page loaded earlier.
      setSheet(
        made.vouchers.map((v) => ({
          code: v.code,
          venue: v.venueName ?? venue?.name ?? "",
          price: Number(v.priceTsh),
          packageName: v.packageName ?? "",
          devices: v.deviceLimit,
        })),
      );
      toast(`${made.vouchers.length} vouchers ready to print`);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.details?.quantity
          ? `How many ${err.details.quantity}.`
          : messageOf(err),
      );
    } finally {
      setBusy(false);
    }
  }

  const n = Number(count) || 0;
  return (
    <>
      <Head
        title="Print vouchers"
        sub="A sheet of codes to sell at the counter"
        crumb={
          <>
            <Link href="/vouchers">Vouchers</Link> /
          </>
        }
      />
      {sold.error ? <LoadFailed error={sold.error} retry={sold.reload} /> : null}
      <div className="two print-page">
        <section className="panel">
          <form className="form" onSubmit={print} noValidate>
            {all.length > 1 ? (
              <Field label="Venue" id="prv">
                <select
                  id="prv"
                  className="input"
                  value={venueId}
                  onChange={(e) => {
                    setVenueId(e.target.value);
                    setPackageId("");
                  }}
                >
                  {all.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="Package" id="prp">
              <select
                id="prp"
                className="input"
                value={chosen?.id ?? ""}
                onChange={(e) => setPackageId(e.target.value)}
              >
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {tsh(p.priceTsh)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="How many"
              id="prn"
              error={error}
              hint={`${PER_SHEET} fit on one A4 sheet`}
            >
              <input
                id="prn"
                className="input"
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "prn-error" : undefined}
              />
            </Field>
            <div className="field">
              <span className="lbl">Print in</span>
              <div className="segs">
                {(
                  [
                    [false, "Colour"],
                    [true, "Black and white"],
                  ] as const
                ).map(([bw, label]) => (
                  <button
                    key={label}
                    className={`seg${mono === bw ? " on" : ""}`}
                    type="button"
                    aria-pressed={mono === bw}
                    onClick={() => setMono(bw)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {packages.length === 0 && sold.data ? (
              <p className="note">
                {venue?.name ?? "This venue"} sells no package yet. Add one in Packages first.
              </p>
            ) : null}
            <div className="actions">
              <Button kind="primary" type="submit" busy={busy} disabled={!chosen || n < 1}>
                {`Print ${n} ${n === 1 ? "voucher" : "vouchers"}`}
              </Button>
              <ButtonLink href="/vouchers">Cancel</ButtonLink>
            </div>
            {sheet.length ? (
              <p className="muted">
                {sheet.length} made and on the sheet.{" "}
                <button className="link" type="button" onClick={() => window.print()}>
                  Print them again
                </button>
              </p>
            ) : null}
          </form>
        </section>
        <Panel title="Preview" right={<span className="note">{PER_SHEET} to a sheet</span>}>
          <div
            className={mono ? "bw" : ""}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {chosen
              ? SAMPLE_CODES.map((code, i) => (
                  <VoucherCard key={code} face={face(code)} n={i + 1} />
                ))
              : null}
          </div>
        </Panel>
      </div>
      <div className={`print-sheet${mono ? " bw" : ""}`} aria-hidden="true">
        <div className="tickets">
          {sheet.map((card, i) => (
            <VoucherCard key={card.code} face={card} n={i + 1} />
          ))}
        </div>
      </div>
    </>
  );
}
