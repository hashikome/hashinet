"use client";

import {
  groupedCode,
  type VoucherList,
  type VoucherListItem,
  type VoucherStatus,
} from "@hashinet/types";
import { useEffect, useState } from "react";
import { SellButton } from "@/components/hearth/sell";
import {
  Button,
  CopyText,
  Head,
  Panel,
  Pill,
  type PillKind,
  Table,
  Tabs,
} from "@/components/hearth/ui";
import { RefundDialog, ReleaseDialog } from "@/components/hearth/voucher-actions";
import { api } from "@/lib/api";
import { shortDate } from "@/lib/dates";
import { LoadFailed, useLoad } from "@/lib/load";
import { useCan, useSession } from "@/lib/session";
import { useVenues } from "@/lib/venues";

const TABS = ["All", "Not used yet", "Active", "Used", "Expired", "Refunded"] as const;
type Tab = (typeof TABS)[number];
const STATUS_OF: Record<Exclude<Tab, "All">, VoucherStatus> = {
  "Not used yet": "unused",
  Active: "active",
  Used: "used",
  Expired: "expired",
  Refunded: "refunded",
};
const LABEL: Record<VoucherStatus, [string, PillKind]> = {
  unused: ["Not used yet", "neutral"],
  pending_activation: ["Starting", "wait"],
  active: ["Active", "ok"],
  used: ["Used", "neutral"],
  expired: ["Expired", "neutral"],
  refunded: ["Refunded", "neutral"],
};
const PAGE = 100;

/**
 * Vouchers (prototype `vouchers`): every voucher in view, found by its code or narrowed by status.
 * Showing codes is recorded in the audit log (ADR-0012).
 */
export default function VouchersPage() {
  const can = useCan();
  const [acting, setActing] = useState<{
    kind: "refund" | "release";
    voucher: VoucherListItem;
  } | null>(null);
  const { me } = useSession();
  const { all, shown, filter } = useVenues();
  const [tab, setTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");
  const [more, setMore] = useState<VoucherListItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const venueId = filter === "all" ? null : filter;
  // The search asks the API once typing pauses.
  const [digits, setDigits] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDigits(search.replace(/\D/g, "")), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = (before: string | null) => {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (venueId) q.set("venueId", venueId);
    if (tab !== "All") q.set("status", STATUS_OF[tab]);
    if (digits) q.set("code", digits);
    if (before) q.set("before", before);
    return `/api/vouchers?${q}`;
  };
  const list = useLoad("vouchers", async () => {
    const page = await api.get<VoucherList>(query(null));
    setMore([]);
    setNext(page.nextBefore);
    return page.vouchers;
  }, [me.active.id, venueId, tab, digits]);
  const scope = shown.length === 1 ? shown[0]?.name : "All venues";
  const showsVenue = all.length > 1;
  const rows = [...(list.data ?? []), ...more];

  return (
    <>
      <Head title="Vouchers" sub={`Every voucher sold · ${scope}`} actions={<SellButton />} />
      {list.error ? <LoadFailed error={list.error} retry={list.reload} /> : null}
      <Panel title="All vouchers">
        <div className="tools">
          <input
            className="search"
            type="search"
            inputMode="numeric"
            placeholder="Search a code"
            aria-label="Search a code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Tabs label="Vouchers by status" options={TABS} value={tab} onChange={setTab} />
        </div>
        {list.data === null ? null : rows.length ? (
          <Table
            cols={[
              ["Code"],
              ["Package"],
              ["Created"],
              ["Status"],
              ...(showsVenue ? ([["Venue"]] as [string][]) : []),
              [""],
            ]}
            rows={rows.map((v) => ({
              key: v.id,
              cells: [
                <span className="mono" key="c">
                  <CopyText text={v.code} label={groupedCode(v.code)} />
                </span>,
                v.packageName ?? "A package since removed",
                shortDate(v.createdAt),
                <Pill key="s" kind={LABEL[v.status][1]}>
                  {LABEL[v.status][0]}
                </Pill>,
                ...(showsVenue ? [v.venueName ?? ""] : []),
                // In use, it is released to a new device; not used yet, an owner or manager refunds it.
                v.status === "active" && can("voucher.release") ? (
                  <Button key="a" onClick={() => setActing({ kind: "release", voucher: v })}>
                    Release
                  </Button>
                ) : v.status === "unused" && can("voucher.refund") ? (
                  <Button key="a" onClick={() => setActing({ kind: "refund", voucher: v })}>
                    Refund
                  </Button>
                ) : (
                  ""
                ),
              ],
            }))}
          />
        ) : (
          <p className="muted empty">
            {digits || tab !== "All"
              ? "Nothing matches this search."
              : "No vouchers yet. Each one is made when it is sold."}
          </p>
        )}
        {next ? (
          <div className="actions" style={{ marginTop: 12 }}>
            <Button
              onClick={async () => {
                const page = await api.get<VoucherList>(query(next));
                setMore((m) => [...m, ...page.vouchers]);
                setNext(page.nextBefore);
              }}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </Panel>
      {acting === null ? null : acting.kind === "refund" ? (
        <RefundDialog
          voucher={acting.voucher}
          onClose={() => setActing(null)}
          onDone={() => {
            setActing(null);
            void list.reload();
          }}
        />
      ) : (
        <ReleaseDialog
          voucher={acting.voucher}
          onClose={() => setActing(null)}
          onDone={() => {
            setActing(null);
            void list.reload();
          }}
        />
      )}
    </>
  );
}
