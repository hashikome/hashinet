"use client";

import { groupedCode, type SessionList, type SessionRecord } from "@hashinet/types";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button, Head, Panel, Table } from "@/components/ui/ui";
import { api } from "@/lib/api";
import { dataSize } from "@/lib/data-size";
import { clock } from "@/lib/dates";
import { timeLeft } from "@/lib/duration";
import { LoadFailed, useLoad } from "@/lib/load";
import { useCan, useSession } from "@/lib/session";
import { useSubmit } from "@/lib/submit";
import { useVenues } from "@/lib/venues";

/** Often enough that the list is the room as it is, without a socket of its own. */
const REFRESH_MS = 30_000;

/** Live sessions (prototype `sessions`): who is online now, soonest to end first. */
export default function SessionsPage() {
  const { me } = useSession();
  const can = useCan();
  const { all, shown, filter } = useVenues();
  const [search, setSearch] = useState("");
  const [typed, setTyped] = useState("");
  const [ending, setEnding] = useState<SessionRecord | null>(null);
  // Everyone online, kept from the last load without a search: the head is the venue's, not the search's.
  const [online, setOnline] = useState(0);
  const venueId = filter === "all" ? null : filter;
  useEffect(() => {
    const timer = setTimeout(() => setTyped(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const list = useLoad("live-sessions", async () => {
    const q = new URLSearchParams({ status: "connected", order: "ending", limit: "500" });
    if (venueId) q.set("venueId", venueId);
    if (typed) q.set("search", typed);
    const page = await api.get<SessionList>(`/api/sessions?${q}`);
    if (!typed) setOnline(page.stats.connected);
    return page;
  }, [me.active.id, venueId, typed]);
  const { reload } = list;
  useEffect(() => {
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const scope = shown.length === 1 ? shown[0]?.name : "All venues";
  const showsVenue = all.length > 1;
  const ends = can("session.terminate");
  const sessions = list.data?.sessions ?? [];

  return (
    <>
      <Head
        title="Live sessions"
        sub={`${online} ${online === 1 ? "device" : "devices"} online · ${scope}${list.at ? ` · updated ${clock(list.at)}` : ""}`}
      />
      {list.error ? <LoadFailed error={list.error} retry={list.reload} /> : null}
      <Panel title={`${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`}>
        <div className="tools">
          <input
            className="search"
            type="search"
            placeholder="Device, MAC address or voucher code"
            aria-label="Search by device, MAC address or voucher code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {list.data === null ? null : sessions.length ? (
          <Table
            cols={[
              ["Device"],
              ["Package"],
              ["Since"],
              ["Used", true],
              ["Time left", true],
              ...(showsVenue ? ([["Venue"]] as [string][]) : []),
              ["Router"],
              ...(ends ? ([[""]] as [string][]) : []),
            ]}
            rows={sessions.map((s) => ({
              key: s.id,
              cells: [
                // A device that gave no name is known by its MAC address.
                s.deviceName === null ? (
                  <div key="d" className="name mono">
                    {s.macAddress}
                  </div>
                ) : (
                  <div key="d">
                    <div className="name">{s.deviceName}</div>
                    <div className="sub mono">{s.macAddress}</div>
                  </div>
                ),
                <div key="p">
                  {s.packageName ?? "A package since removed"}
                  {s.voucherCode ? (
                    <div className="sub mono">{groupedCode(s.voucherCode)}</div>
                  ) : null}
                </div>,
                clock(s.startedAt),
                dataSize(s.downloadBytes + s.uploadBytes),
                timeLeft(s.voucherExpiresAt),
                ...(showsVenue ? [s.venueName ?? ""] : []),
                s.routerName ?? "",
                ...(ends
                  ? [
                      <Button key="e" kind="danger" onClick={() => setEnding(s)}>
                        End session
                      </Button>,
                    ]
                  : []),
              ],
            }))}
          />
        ) : (
          <p className="muted empty">
            {typed ? "Nothing matches this search." : "No devices online right now."}
          </p>
        )}
      </Panel>
      {ending ? (
        <EndDialog
          session={ending}
          onClose={() => setEnding(null)}
          onDone={() => {
            setEnding(null);
            void list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function EndDialog({
  session,
  onClose,
  onDone,
}: {
  session: SessionRecord;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, run } = useSubmit();
  return (
    <Dialog label="End this session?" alert onClose={onClose}>
      <h2>End this session?</h2>
      <p className="muted">
        {session.deviceName ?? session.macAddress} goes offline now. Its voucher keeps the time it
        has left, and its place is free for another device.
      </p>
      <div className="dialog-actions">
        <Button
          kind="danger"
          busy={busy}
          onClick={async () => {
            const ok = await run(
              () => api.post(`/api/sessions/${session.id}/terminate`),
              "Session ended. Its place on the voucher is free.",
            );
            if (ok) onDone();
          }}
        >
          End session
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}
