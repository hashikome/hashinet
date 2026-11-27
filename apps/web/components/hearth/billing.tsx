"use client";

import type { BillingProfile, FeeTerms, InvoiceRecord } from "@hashinet/types";
import { useState } from "react";
import { api, messageOf } from "@/lib/api";
import { fullDay, invoiceWhat, STATE } from "@/lib/billing";
import { longDate } from "@/lib/dates";
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

/** Download PDF: the invoice as the API makes it, saved under its number. */
export function DownloadPdf({ invoice }: { invoice: InvoiceRecord }) {
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
        } catch (err) {
          toast(messageOf(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      Download PDF
    </Button>
  );
}

/**
 * A business's invoices, newest first (prototype `invoicesPanel`). An invoice is its PDF: a row is
 * not a link, and its one action downloads it.
 */
export function InvoicesPanel({ invoices }: { invoices: InvoiceRecord[] }) {
  return (
    <Panel title={`Invoices · ${invoices.length}`}>
      {invoices.length ? (
        <Table
          cols={[["Invoice"], ["Issued date"], ["Due date"], ["Total", true], ["Status"], [""]]}
          rows={invoices.map((i) => ({
            key: i.id,
            cells: [
              <div key="n">
                <div className="name nowrap">{i.number}</div>
                <div className="sub">{invoiceWhat(i)}</div>
              </div>,
              <span className="nowrap" key="i">
                {longDate(i.issuedAt)}
              </span>,
              <span className="nowrap" key="d">
                {fullDay(i.dueOn)}
              </span>,
              <span className="nowrap" key="t">
                {tsh(i.totalTsh)}
              </span>,
              <InvoiceStatus invoice={i} key="s" />,
              <DownloadPdf invoice={i} key="pdf" />,
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

/**
 * Record payment and Remind, for HashiNet's admin and managers while something is owed. The
 * payment settles the oldest first, or the invoice chosen. On the business's bill, never in a list's
 * row, since a row that opens a page holds no buttons.
 */
export function BillActions({
  businessId,
  ownerName,
  owedTsh,
  says,
  owed = [],
  onDone,
}: {
  businessId: string;
  ownerName: string | null;
  owedTsh: number;
  /** What is owed, said once, at the top of the dialog. */
  says: string;
  /** Its open invoices, oldest first: with more than one, the payment says which it settles. */
  owed?: InvoiceRecord[];
  onDone: () => void;
}) {
  const can = useCan();
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  const [reminding, setReminding] = useState(false);
  if (owedTsh <= 0) return null;
  return (
    <div className="profile-actions">
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
          invoiceId={null}
          owed={owed}
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
