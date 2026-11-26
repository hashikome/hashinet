"use client";

import type { BillingProfile, FeeTerms, HashiNetPayTo, InvoiceRecord } from "@hashinet/types";
import { useState } from "react";
import { api, messageOf } from "@/lib/api";
import { fullDay, invoiceWhat, METHOD_NAME, STATE } from "@/lib/billing";
import { longDate } from "@/lib/dates";
import { LINE_NAME } from "@/lib/issues";
import { tsh } from "@/lib/money";
import { useCan } from "@/lib/session";
import { RecordPayment } from "./record-payment";
import { Button, CopyText, Panel, Pill, Table, useToast } from "./ui";

/** "5%", "2.5%". */
export const percent = (bp: number) => `${bp / 100}%`;

/** A business's terms in a sentence (prototype `FEE_NOTE`). */
export function feeNote(t: FeeTerms): string {
  return `Fees are ${percent(t.rateBp)} of each voucher's sale price, ${percent(t.lowerRateBp)} on a venue's monthly sales above ${tsh(t.lowerRateAboveTsh)}, with a minimum of ${tsh(t.minimumTsh)} a month per serving venue. A payment settles the oldest bill first.`;
}

/** An invoice's state, with what came in when it went overdue part paid (prototype `statusOf`). */
export function InvoiceStatus({ invoice }: { invoice: InvoiceRecord }) {
  const [label, kind] = STATE[invoice.state];
  return (
    <>
      <Pill kind={kind}>{label}</Pill>
      {invoice.state === "overdue" && invoice.paidTsh > 0 ? (
        <div className="sub nowrap">{tsh(invoice.paidTsh)} paid</div>
      ) : null}
    </>
  );
}

/** A business's invoices, newest first; a row opens its invoice (prototype `invoicesPanel`). */
export function InvoicesPanel({ invoices }: { invoices: InvoiceRecord[] }) {
  return (
    <Panel title={`Invoices · ${invoices.length}`}>
      {invoices.length ? (
        <Table
          cols={[["Invoice"], ["Issued date"], ["Due date"], ["Total", true], ["Status"]]}
          rows={invoices.map((i) => ({
            key: i.id,
            href: `/billing/invoices/${i.id}`,
            cells: [
              <div key="n">
                <div className="name">{i.number}</div>
                <div className="sub">{invoiceWhat(i)}</div>
              </div>,
              <span className="nowrap" key="i">
                {longDate(i.issuedAt)}
              </span>,
              <span className="nowrap" key="d">
                {fullDay(i.dueOn)}
              </span>,
              tsh(i.totalTsh),
              <InvoiceStatus invoice={i} key="s" />,
            ],
          }))}
        />
      ) : (
        <p className="muted">
          No invoices yet. The first is issued when a month with sales closes.
        </p>
      )}
    </Panel>
  );
}

/** What one line of an invoice charged for, read the way the owner reads it. */
function lineDetail(i: InvoiceRecord["lines"][number], terms: FeeTerms): string {
  if (i.onboardingKind) return i.label;
  const sales = `${tsh(i.netSalesTsh ?? 0)} in sales`;
  if (i.minimumTsh !== null) {
    const served = i.servedBp !== null && i.servedBp < 10_000;
    return `${sales}, ${tsh(i.minimumTsh)} monthly minimum${served ? `, for the ${Math.round((i.servedBp ?? 0) / 100)}% of the month it was served` : ""}`;
  }
  return (i.netSalesTsh ?? 0) > terms.lowerRateAboveTsh
    ? `${sales} at ${percent(terms.rateBp)}, ${percent(terms.lowerRateBp)} above ${tsh(terms.lowerRateAboveTsh)}`
    : `${sales} at ${percent(terms.rateBp)}`;
}

/**
 * An invoice read top to bottom (prototype `invoiceDetail`): what was charged, what came in, and
 * always last what is left to pay.
 */
export function InvoiceLines({ invoice, terms }: { invoice: InvoiceRecord; terms: FeeTerms }) {
  const row = (key: string, a: string, sub: string, amount: string, className = "") => (
    <li className={className} key={key}>
      <span>{a}</span>
      <span className="sub">{sub}</span>
      <span className="num nowrap">{amount}</span>
    </li>
  );
  return (
    <ul className="inv-lines">
      {invoice.lines.map((l, n) =>
        row(
          `l${n}`,
          l.onboardingKind ? LINE_NAME[l.onboardingKind] : l.label,
          lineDetail(l, terms),
          tsh(l.amountTsh),
        ),
      )}
      {row("total", "Total", "", tsh(invoice.totalTsh), "inv-total")}
      {invoice.payments.map((p, n) =>
        row(
          `p${n}`,
          `Paid ${fullDay(p.receivedOn)}`,
          [METHOD_NAME[p.method], p.reference].filter(Boolean).join(" · "),
          `−${tsh(p.amountTsh)}`,
        ),
      )}
      {row("end", "Amount due", "", tsh(invoice.dueTsh), "inv-end")}
    </ul>
  );
}

/** Where businesses pay HashiNet, from Fees; a way left empty is not offered. */
export function HowToPay({ payTo }: { payTo: HashiNetPayTo }) {
  const ways = [
    payTo.mobileMoney ? (
      <li key="mm">
        <div>
          <b>Mobile money</b>
          <span className="sub">
            Business number <CopyText text={payTo.mobileMoney} />
          </span>
        </div>
      </li>
    ) : null,
    payTo.bankAccount ? (
      <li key="bank">
        <div>
          <b>Bank transfer</b>
          <span className="sub">
            {payTo.accountName}
            {payTo.bankName ? `, ${payTo.bankName}` : ""}, account{" "}
            <CopyText text={payTo.bankAccount} />
          </span>
        </div>
      </li>
    ) : null,
  ].filter(Boolean);
  return (
    <Panel title="How to pay">
      {ways.length ? (
        <>
          <ul className="rows">{ways}</ul>
          <p className="muted small">
            Use the invoice number as the reference. A payment settles the oldest invoice first.
          </p>
        </>
      ) : (
        <p className="muted">Contact HashiNet for how to pay: the details aren&apos;t set yet.</p>
      )}
    </Panel>
  );
}

/**
 * Record payment and Remind, for HashiNet's admin and managers while something is owed. On an
 * invoice the payment settles it; on the business, the oldest first. `row` sits them in a table row.
 */
export function BillActions({
  businessId,
  ownerName,
  owedTsh,
  says,
  invoiceId = null,
  row = false,
  onDone,
}: {
  businessId: string;
  ownerName: string | null;
  owedTsh: number;
  /** What is owed, said once, at the top of the dialog. */
  says: string;
  invoiceId?: string | null;
  row?: boolean;
  onDone: () => void;
}) {
  const can = useCan();
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  const [reminding, setReminding] = useState(false);
  if (owedTsh <= 0) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: in a row, the buttons don't open the row's page
    <div
      className={row ? "actions row-actions" : "profile-actions"}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {can("billing.record") ? (
        <Button onClick={() => setPaying(true)}>Record payment</Button>
      ) : null}
      {can("billing.remind") ? (
        <Button
          busy={reminding}
          onClick={async () => {
            setReminding(true);
            try {
              await api.post("/api/billing/reminders", { businessId });
              toast(`Reminded ${ownerName ?? "the owner"} by email.`);
            } catch (e) {
              toast(messageOf(e));
            } finally {
              setReminding(false);
            }
          }}
        >
          Remind
        </Button>
      ) : null}
      {paying ? (
        <RecordPayment
          businessId={businessId}
          invoiceId={invoiceId}
          owedTsh={owedTsh}
          says={says}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            onDone();
          }}
        />
      ) : null}
    </div>
  );
}

/** Who a bill goes to: the owner and their email, on a bill's and an invoice's card. */
export function BilledTo({ owner }: { owner: BillingProfile["owner"] }) {
  return (
    <div>
      <dt>Billed to</dt>
      <dd>
        {owner ? (
          <>
            {owner.name}
            <span className="sub">
              <CopyText text={owner.email} />
            </span>
          </>
        ) : (
          <span className="muted">No owner yet</span>
        )}
      </dd>
    </div>
  );
}
