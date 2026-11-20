"use client";

import type { DeviceList, DeviceRecord } from "@hashinet/types";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/hearth/dialog";
import { Button, Head, Panel, Pill, type PillKind, Table, Tabs } from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { dataSize } from "@/lib/data-size";
import { when } from "@/lib/dates";
import { LoadFailed, useLoad } from "@/lib/load";
import { useCan, useSession } from "@/lib/session";
import { useSubmit } from "@/lib/submit";
import { useVenues } from "@/lib/venues";

const TABS = ["All", "Online", "Offline", "Blocked"] as const;
type Tab = (typeof TABS)[number];
type State = Exclude<Tab, "All">;
const PILL: Record<State, PillKind> = { Online: "ok", Offline: "neutral", Blocked: "bad" };
const PAGE = 100;

const stateOf = (d: DeviceRecord): State =>
  d.status === "blocked" ? "Blocked" : d.isOnline ? "Online" : "Offline";
const nameOf = (d: DeviceRecord) => d.deviceName ?? d.macAddress;
const count = (n: number) => `${n} ${n === 1 ? "device" : "devices"}`;

/**
 * Devices (prototype `devices`): every device the business's venues have seen. Blocking and
 * removing are the business's own: another business that saw a device keeps its own say.
 */
export default function DevicesPage() {
  const { me } = useSession();
  const can = useCan();
  const { shown } = useVenues();
  const [tab, setTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");
  const [typed, setTyped] = useState("");
  const [more, setMore] = useState<DeviceRecord[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [ask, setAsk] = useState<"block" | "remove" | null>(null);
  const { busy, run } = useSubmit();
  useEffect(() => {
    const timer = setTimeout(() => setTyped(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = (before: string | null) => {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (tab !== "All") q.set("status", tab.toLowerCase());
    if (typed) q.set("search", typed);
    if (before) q.set("before", before);
    return `/api/devices?${q}`;
  };
  const list = useLoad("devices", async () => {
    const page = await api.get<DeviceList>(query(null));
    setMore([]);
    setNext(page.nextBefore);
    setPicked(new Set());
    return page;
  }, [me.active.id, tab, typed]);

  const blocks = can("device.block");
  const devices = [...(list.data?.devices ?? []), ...more];
  const chosen = devices.filter((d) => picked.has(d.id));
  const allOn = devices.length > 0 && chosen.length === devices.length;
  const what = chosen.length === 1 && chosen[0] ? nameOf(chosen[0]) : count(chosen.length);
  const stats = list.data?.stats;
  const scope = shown.length === 1 ? shown[0]?.name : "All venues";
  const pick = (id: string, on: boolean) =>
    setPicked((p) => {
      const nextSet = new Set(p);
      if (on) nextSet.add(id);
      else nextSet.delete(id);
      return nextSet;
    });
  const setStatus = (ids: string[], status: "active" | "blocked", done: string) =>
    run(async () => {
      for (const id of ids) await api.put(`/api/devices/${id}/status`, { status });
    }, done).then((ok) => {
      if (ok) {
        setAsk(null);
        void list.reload();
      }
    });

  return (
    <>
      <Head
        title="Devices"
        sub={stats ? `${stats.online} online, ${stats.total} seen · ${scope}` : scope}
      />
      {list.error ? <LoadFailed error={list.error} retry={list.reload} /> : null}
      <Panel
        title={
          blocks && devices.length ? (
            <label className="pick-all">
              <input
                type="checkbox"
                className="pick-box"
                aria-label="Select all shown"
                checked={allOn}
                ref={(el) => {
                  if (el) el.indeterminate = chosen.length > 0 && !allOn;
                }}
                onChange={(e) =>
                  setPicked(new Set(e.target.checked ? devices.map((d) => d.id) : []))
                }
              />
              <span>{chosen.length ? `${chosen.length} selected` : count(devices.length)}</span>
            </label>
          ) : (
            count(devices.length)
          )
        }
        right={
          chosen.length ? (
            <div className="actions">
              {chosen.every((d) => d.status === "blocked") ? (
                <Button
                  busy={busy}
                  onClick={() =>
                    setStatus(
                      chosen.map((d) => d.id),
                      "active",
                      `${count(chosen.length)} unblocked.`,
                    )
                  }
                >
                  Unblock
                </Button>
              ) : (
                <Button onClick={() => setAsk("block")}>Block</Button>
              )}
              {can("device.delete") && chosen.every((d) => !d.isOnline) ? (
                <Button onClick={() => setAsk("remove")}>Remove</Button>
              ) : null}
              <Button onClick={() => setPicked(new Set())}>Clear</Button>
            </div>
          ) : null
        }
      >
        <div className="tools">
          <input
            className="search"
            type="search"
            placeholder="Device or MAC address"
            aria-label="Search by device or MAC address"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Tabs label="Devices by status" options={TABS} value={tab} onChange={setTab} />
        </div>
        {list.data === null ? null : devices.length ? (
          <Table
            cols={[
              ["Device"],
              ["Status"],
              ["Last seen"],
              ["Used", true],
              ...(blocks ? ([[""]] as [string][]) : []),
            ]}
            rows={devices.map((d) => ({
              key: d.id,
              cells: [
                <div key="d" className="pick-cell">
                  {blocks ? (
                    <label className="pick-hit">
                      <input
                        type="checkbox"
                        className="pick-box"
                        aria-label={`Select ${nameOf(d)}`}
                        checked={picked.has(d.id)}
                        onChange={(e) => pick(d.id, e.target.checked)}
                      />
                    </label>
                  ) : null}
                  {d.deviceName === null ? (
                    <div className="name nowrap mono">{d.macAddress}</div>
                  ) : (
                    <div>
                      <div className="name nowrap">{d.deviceName}</div>
                      <div className="sub mono">{d.macAddress}</div>
                    </div>
                  )}
                </div>,
                <Pill key="s" kind={PILL[stateOf(d)]}>
                  {stateOf(d)}
                </Pill>,
                <span key="w" className="nowrap">
                  {d.isOnline ? "Now" : when(d.lastActiveAt ?? d.firstSeenAt)}
                </span>,
                dataSize(d.downloadBytes + d.uploadBytes),
                // Unblocking takes nothing away, so it acts at once, from the row.
                ...(blocks
                  ? [
                      d.status === "blocked" ? (
                        <Button
                          key="u"
                          busy={busy}
                          onClick={() => setStatus([d.id], "active", `${nameOf(d)} is unblocked.`)}
                        >
                          Unblock
                        </Button>
                      ) : (
                        ""
                      ),
                    ]
                  : []),
              ],
            }))}
          />
        ) : (
          <p className="muted empty">
            {typed || tab !== "All" ? "Nothing matches this search." : "No devices seen yet."}
          </p>
        )}
        {next ? (
          <div className="actions" style={{ marginTop: 12 }}>
            <Button
              onClick={async () => {
                const page = await api.get<DeviceList>(query(next));
                setMore((m) => [...m, ...page.devices]);
                setNext(page.nextBefore);
              }}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </Panel>
      {ask === "block" ? (
        <Dialog label={`Block ${what}?`} alert onClose={() => setAsk(null)}>
          <h2>Block {what}?</h2>
          <p className="muted">
            {chosen.length === 1 ? "It" : "They"} can't join this business's WiFi again, with any
            voucher, until someone unblocks {chosen.length === 1 ? "it" : "them"}. Other businesses
            are not affected.
          </p>
          <div className="dialog-actions">
            <Button
              kind="danger"
              busy={busy}
              onClick={() =>
                setStatus(
                  chosen.map((d) => d.id),
                  "blocked",
                  `${count(chosen.length)} blocked.`,
                )
              }
            >
              Block
            </Button>
            <Button onClick={() => setAsk(null)}>Cancel</Button>
          </div>
        </Dialog>
      ) : null}
      {ask === "remove" ? (
        <Dialog label={`Remove ${what}?`} alert onClose={() => setAsk(null)}>
          <h2>Remove {what}?</h2>
          <p className="muted">
            {chosen.length === 1 ? "Its" : "Their"} history goes from the list. If{" "}
            {chosen.length === 1 ? "it comes" : "they come"} back,{" "}
            {chosen.length === 1 ? "it signs" : "they sign"} in again like a new device.
          </p>
          <div className="dialog-actions">
            <Button
              kind="danger"
              busy={busy}
              onClick={() =>
                run(
                  async () => {
                    for (const d of chosen) await api.delete(`/api/devices/${d.id}`);
                  },
                  `${count(chosen.length)} removed.`,
                ).then((ok) => {
                  if (ok) {
                    setAsk(null);
                    void list.reload();
                  }
                })
              }
            >
              Remove
            </Button>
            <Button onClick={() => setAsk(null)}>Cancel</Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
