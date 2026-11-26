"use client";

import type { BillingAccount } from "@hashinet/types";
import Link from "next/link";
import { use, useEffect } from "react";
import { BillActions, BilledTo, feeNote, InvoicesPanel } from "@/components/hearth/billing";
import { BusinessMark } from "@/components/hearth/icons";
import { api } from "@/lib/api";
import { owesLine } from "@/lib/billing";
import { LoadFailed, useLoad } from "@/lib/load";
import { tsh } from "@/lib/money";

/**
 * A business's bill, as HashiNet's team sees it (prototype `bill`): who it is billed to, what it
 * has paid and owes, and its invoices; Record payment settles the oldest first.
 */
export default function BillPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const load = useLoad(
    "billing-account",
    () => api.get<BillingAccount>(`/api/billing/account?businessId=${businessId}`),
    [businessId],
  );
  const a = load.data;
  useEffect(() => {
    if (a) document.title = `${a.business.name} · HashiNet`;
  }, [a]);
  const crumb = (
    <div className="crumb">
      <Link href="/billing">Payments</Link> /
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
  if (!a) return crumb;
  return (
    <>
      {crumb}
      <aside className="profile-card">
        <div className="panel profile-body">
          <BusinessMark name={a.business.name} size={64} />
          <div>
            <h1>{a.business.name}</h1>
            <p className="profile-address">
              {a.business.area}, {a.business.region}
            </p>
            <p>
              <Link className="link" href={`/businesses/${a.business.id}`}>
                Open business
              </Link>
            </p>
          </div>
          <dl className="profile-list">
            <BilledTo owner={a.owner} />
            <div>
              <dt>Paid to HashiNet</dt>
              <dd>
                {tsh(a.paidTsh)}
                <span className="sub">{a.dueTsh ? `${tsh(a.dueTsh)} due` : "nothing due"}</span>
              </dd>
            </div>
          </dl>
          <BillActions
            businessId={a.business.id}
            ownerName={a.owner?.name ?? null}
            owedTsh={a.dueTsh}
            says={owesLine(a.business.name, a.owed)}
            owed={a.owed}
            onDone={load.reload}
          />
        </div>
      </aside>
      <InvoicesPanel invoices={a.invoices} />
      <p className="muted small">{feeNote(a.terms)}</p>
    </>
  );
}
