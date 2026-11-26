"use client";

import type { InvoiceResponse } from "@hashinet/types";
import Link from "next/link";
import { use, useEffect } from "react";
import {
  BillActions,
  BilledTo,
  HowToPay,
  InvoiceLines,
  InvoiceStatus,
} from "@/components/hearth/billing";
import { BusinessMark } from "@/components/hearth/icons";
import { Panel } from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { fullDay, invoiceWhat } from "@/lib/billing";
import { longDate } from "@/lib/dates";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";
import { useSession } from "@/lib/session";

/**
 * One invoice (prototype `invoice`), opened from its business's bill or the owner's Billing: its
 * lines, what came in and what is left. Record payment here settles this invoice.
 */
export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useSession();
  const platform = me.active.scope === "platform";
  const load = useLoad("invoice", () => api.get<InvoiceResponse>(`/api/billing/invoices/${id}`), [
    id,
    me.active.id,
  ]);
  const x = load.data?.invoice;
  useEffect(() => {
    if (x) document.title = `${x.number} · HashiNet`;
  }, [x]);
  const crumb = (
    <div className="crumb">
      <Link href="/billing">{platform ? "Payments" : "Billing"}</Link> /
      {platform && x ? (
        <>
          {" "}
          <Link href={`/billing/${x.businessId}`}>{x.businessName}</Link> /
        </>
      ) : null}
    </div>
  );
  if (load.error) {
    return (
      <>
        {crumb}
        <LoadFailed error={load.error} retry={load.reload} />
      </>
    );
  }
  if (!load.data || !x) return crumb;
  const a = load.data;
  return (
    <>
      {crumb}
      <aside className="profile-card">
        <div className="panel profile-body">
          <BusinessMark name={a.business.name} size={64} />
          <div>
            <h1>{x.number}</h1>
            <p className="profile-address">{invoiceWhat(x)}</p>
            <p>
              {platform ? (
                <Link className="link" href={`/billing/${a.business.id}`}>
                  {a.business.name}
                </Link>
              ) : (
                a.business.name
              )}
              <br />
              {a.business.area}, {a.business.region}
            </p>
          </div>
          <dl className="profile-list">
            <BilledTo owner={a.owner} />
            <div>
              <dt>Issued date</dt>
              <dd>{longDate(x.issuedAt)}</dd>
            </div>
            <div>
              <dt>Due date</dt>
              <dd>{fullDay(x.dueOn)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <InvoiceStatus invoice={x} />
              </dd>
            </div>
          </dl>
          {platform ? (
            <BillActions
              businessId={a.business.id}
              ownerName={a.owner?.name ?? null}
              owedTsh={x.dueTsh}
              says={`${a.business.name} owes ${tsh(x.dueTsh)} for ${invoiceWhat(x)}, invoice ${x.number}.`}
              invoiceId={x.id}
              onDone={load.reload}
            />
          ) : null}
        </div>
      </aside>
      <Panel title="Invoice">
        <InvoiceLines invoice={x} terms={a.terms} />
      </Panel>
      {!platform && x.dueTsh > 0 ? <HowToPay payTo={a.payTo} /> : null}
    </>
  );
}
