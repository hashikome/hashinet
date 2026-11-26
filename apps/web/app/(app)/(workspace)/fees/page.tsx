"use client";

import type { BillingSettingsRecord, BillingSettingsResponse } from "@hashinet/types";
import { useEffect, useState } from "react";
import { Button, Field, Head, Panel } from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";
import { useCan } from "@/lib/session";
import { useSubmit } from "@/lib/submit";

/** "5", "2.5": a rate in basis points as a percentage. */
const percent = (bp: number) => String(bp / 100);
/** A percentage as typed, in basis points; anything else is left for the API to refuse. */
const basisPoints = (typed: string) => Math.round(Number(typed.trim()) * 100);
/** "2,000,000" as typed, in whole shillings. */
const shillings = (typed: string) => Number(typed.replace(/[\s,]/g, ""));
const grouped = (n: number) => n.toLocaleString("en-US");

interface Form {
  rate: string;
  lowerRate: string;
  above: string;
  minimum: string;
  mobileMoney: string;
  bankName: string;
  bankAccount: string;
  accountName: string;
}

function formOf(s: BillingSettingsRecord): Form {
  return {
    rate: percent(s.terms.rateBp),
    lowerRate: percent(s.terms.lowerRateBp),
    above: grouped(s.terms.lowerRateAboveTsh),
    minimum: grouped(s.terms.minimumTsh),
    mobileMoney: s.payTo.mobileMoney ?? "",
    bankName: s.payTo.bankName ?? "",
    bankAccount: s.payTo.bankAccount ?? "",
    accountName: s.payTo.accountName,
  };
}

/**
 * Fees (prototype `fees`): what businesses pay HashiNet, and where. The platform admin changes them;
 * the terms reach only businesses added after, and where to pay shows on every Billing at once.
 */
export default function FeesPage() {
  const can = useCan();
  const edits = can("fees.update");
  const load = useLoad(
    "billing-settings",
    async () => (await api.get<BillingSettingsResponse>("/api/billing/settings")).settings,
    [],
  );
  const [form, setForm] = useState<Form | null>(null);
  const { busy, errors, run } = useSubmit();
  useEffect(() => {
    if (load.data) setForm(formOf(load.data));
  }, [load.data]);
  const sub = `What businesses pay. Changes apply to businesses added after them.${edits ? "" : " Only the platform admin changes them."}`;
  if (load.error) {
    return (
      <>
        <Head title="Fees" sub={sub} />
        <LoadFailed error={load.error} retry={load.reload} />
      </>
    );
  }
  const s = load.data;
  if (!s || !form) return <Head title="Fees" sub={sub} />;

  if (!edits) {
    const rows: [string, string][] = [
      ["Fee", `${percent(s.terms.rateBp)}% of sales`],
      ["Lower rate", `${percent(s.terms.lowerRateBp)}%`],
      ["Lower rate starts above", `${tsh(s.terms.lowerRateAboveTsh)} a month`],
      ["Monthly minimum per venue", tsh(s.terms.minimumTsh)],
    ];
    const pay: [string, string][] = [
      ["Mobile money business number", s.payTo.mobileMoney ?? "Not set"],
      ["Bank", s.payTo.bankName ?? "Not set"],
      ["Bank account number", s.payTo.bankAccount ?? "Not set"],
      ["Account name", s.payTo.accountName],
    ];
    const list = (items: [string, string][]) => (
      <ul className="rows">
        {items.map(([label, value]) => (
          <li key={label}>
            <div>{label}</div>
            <span className="num">{value}</span>
          </li>
        ))}
      </ul>
    );
    return (
      <>
        <Head title="Fees" sub={sub} />
        <Panel title="Fees">{list(rows)}</Panel>
        <Panel title="Where businesses pay">{list(pay)}</Panel>
      </>
    );
  }

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });
  const input = (key: keyof Form, id: string, numeric = false) => (
    <input
      id={id}
      className="input"
      type="text"
      inputMode={numeric ? "decimal" : undefined}
      value={form[key]}
      onChange={set(key)}
      aria-invalid={errors[id] ? true : undefined}
    />
  );
  const save = (done: string) =>
    run(async () => {
      const saved = await api.put<BillingSettingsResponse>("/api/billing/settings", {
        terms: {
          rateBp: basisPoints(form.rate),
          lowerRateBp: basisPoints(form.lowerRate),
          lowerRateAboveTsh: shillings(form.above),
          minimumTsh: shillings(form.minimum),
        },
        payTo: {
          mobileMoney: form.mobileMoney,
          bankName: form.bankName,
          bankAccount: form.bankAccount,
          accountName: form.accountName,
        },
      });
      load.reload();
      setForm(formOf(saved.settings));
    }, done);
  return (
    <>
      <Head title="Fees" sub={sub} />
      <section className="panel">
        <form
          className="fee-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save("Saved. Businesses added from now start with these.");
          }}
        >
          <Field label="Fee (% of sales)" id="terms.rateBp" error={errors["terms.rateBp"]}>
            {input("rate", "terms.rateBp", true)}
          </Field>
          <Field label="Lower rate (%)" id="terms.lowerRateBp" error={errors["terms.lowerRateBp"]}>
            {input("lowerRate", "terms.lowerRateBp", true)}
          </Field>
          <Field
            label="Lower rate starts above (TSh a month)"
            id="terms.lowerRateAboveTsh"
            error={errors["terms.lowerRateAboveTsh"]}
          >
            {input("above", "terms.lowerRateAboveTsh", true)}
          </Field>
          <Field
            label="Monthly minimum per venue (TSh)"
            id="terms.minimumTsh"
            error={errors["terms.minimumTsh"]}
          >
            {input("minimum", "terms.minimumTsh", true)}
          </Field>
          <div className="form-save">
            <Button kind="primary" type="submit" busy={busy}>
              Save
            </Button>
          </div>
        </form>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Where businesses pay</h2>
        </div>
        <p className="muted fee-lead">
          Shown on every business&apos;s Billing, under How to pay. Changes show at once.
        </p>
        <form
          className="fee-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save("Saved. Every business's Billing shows it now.");
          }}
        >
          <Field
            label="Mobile money business number (optional)"
            id="payTo.mobileMoney"
            error={errors["payTo.mobileMoney"]}
          >
            {input("mobileMoney", "payTo.mobileMoney")}
          </Field>
          <Field label="Bank (optional)" id="payTo.bankName" error={errors["payTo.bankName"]}>
            {input("bankName", "payTo.bankName")}
          </Field>
          <Field
            label="Bank account number (optional)"
            id="payTo.bankAccount"
            error={errors["payTo.bankAccount"]}
          >
            {input("bankAccount", "payTo.bankAccount")}
          </Field>
          <Field label="Account name" id="payTo.accountName" error={errors["payTo.accountName"]}>
            {input("accountName", "payTo.accountName")}
          </Field>
          <div className="form-save">
            <Button kind="primary" type="submit" busy={busy}>
              Save
            </Button>
          </div>
        </form>
      </section>
    </>
  );
}
