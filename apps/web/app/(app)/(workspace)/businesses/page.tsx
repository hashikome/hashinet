"use client";

import type { BusinessList, InvitationList, InvitationRecord } from "@hashinet/types";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Dialog } from "@/components/hearth/dialog";
import {
  Button,
  CONDITION,
  CopyText,
  Field,
  Head,
  Panel,
  Pill,
  Table,
  useToast,
} from "@/components/hearth/ui";
import { ApiRequestError, api, messageOf } from "@/lib/api";
import { shortDate, when } from "@/lib/dates";
import { LoadFailed, useLoad } from "@/lib/load";
import { useCan, useSession } from "@/lib/session";

/**
 * Businesses (prototype `businesses`), slice 1's minimal list: every business, whether it serves,
 * and the invitations to start one that are not yet accepted. A business's own page comes in
 * slice 3.
 */
export default function BusinessesPage() {
  const { me } = useSession();
  const can = useCan();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const [search, setSearch] = useState("");
  const list = useLoad(async () => {
    const [b, i] = await Promise.all([
      api.get<BusinessList>("/api/businesses"),
      api.get<InvitationList>("/api/invitations/businesses"),
    ]);
    return { businesses: b.businesses, invitations: i.invitations };
  }, [me.active.id]);
  const mayInvite = can("business.invite");
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const businesses = (list.data?.businesses ?? []).filter((b) =>
    words.every((w) =>
      `${b.name} ${b.owner?.name ?? ""} ${b.owner?.email ?? ""} ${b.region} ${b.area}`
        .toLowerCase()
        .includes(w),
    ),
  );
  const venueCount = (list.data?.businesses ?? []).reduce((n, b) => n + b.venues.length, 0);

  const act = async (what: () => Promise<unknown>, done: string) => {
    try {
      await what();
      await list.reload();
      toast(done);
    } catch (e) {
      toast(messageOf(e));
    }
  };

  return (
    <>
      <Head
        title="Businesses"
        sub={
          list.data
            ? `${list.data.businesses.length} ${list.data.businesses.length === 1 ? "business" : "businesses"}, ${venueCount} ${venueCount === 1 ? "venue" : "venues"}`
            : "Every business on HashiNet"
        }
        actions={
          mayInvite ? (
            <Button kind="primary" icon="plus" onClick={() => setInviting(true)}>
              Invite a business
            </Button>
          ) : null
        }
      />
      {list.error ? <LoadFailed error={list.error} retry={list.reload} /> : null}
      {list.data?.invitations.length ? (
        <Panel title={`Invited, not started yet · ${list.data.invitations.length}`}>
          <Table
            cols={[["Owner's email"], ["Invited"], ["Link works until"], [""]]}
            rows={list.data.invitations.map((inv: InvitationRecord) => ({
              key: inv.id,
              cells: [
                <CopyText key="e" text={inv.email} />,
                `${shortDate(inv.createdAt)}${inv.invitedBy ? ` by ${inv.invitedBy}` : ""}`,
                when(inv.expiresAt),
                mayInvite ? (
                  <div className="actions row-actions" key="a">
                    <Button
                      onClick={() =>
                        act(
                          () => api.post(`/api/invitations/${inv.id}/resend`),
                          `A new link is on its way to ${inv.email}`,
                        )
                      }
                    >
                      Resend
                    </Button>
                    <Button
                      kind="danger"
                      onClick={() =>
                        act(
                          () => api.delete(`/api/invitations/${inv.id}`),
                          "Invitation revoked. Its link no longer works.",
                        )
                      }
                    >
                      Revoke
                    </Button>
                  </div>
                ) : (
                  ""
                ),
              ],
            }))}
          />
        </Panel>
      ) : null}
      {list.data ? (
        <>
          <section className="panel">
            <form className="audit-filters" onSubmit={(e) => e.preventDefault()}>
              <div className="field grow">
                <label htmlFor="biz-q">Search</label>
                <input
                  id="biz-q"
                  className="input"
                  type="search"
                  placeholder="Name, owner or region"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </form>
          </section>
          <Panel
            title={`${businesses.length} ${businesses.length === 1 ? "business" : "businesses"}`}
          >
            {businesses.length ? (
              <Table
                cols={[
                  ["Business"],
                  ["Region"],
                  ["Area"],
                  ["Status"],
                  ["Venues", true],
                  ["Routers", true],
                ]}
                rows={businesses.map((b) => {
                  const [state, kind] = CONDITION[b.condition];
                  return {
                    key: b.id,
                    cells: [
                      <div key="n">
                        <div className="name">{b.name}</div>
                        <div className="sub">{b.owner?.name ?? "No owner yet"}</div>
                        <div className="sub">
                          {b.venues.map((v, i) => (
                            <span key={v.id}>
                              {i ? " · " : ""}
                              <Link className="link" href={`/venues/${v.id}/router`}>
                                {v.name}&apos;s router
                              </Link>
                            </span>
                          ))}
                        </div>
                      </div>,
                      b.region,
                      b.area,
                      <Pill key="s" kind={kind}>
                        {state}
                      </Pill>,
                      b.venues.length,
                      b.venues.reduce((n, v) => n + v.routers, 0),
                    ],
                  };
                })}
              />
            ) : (
              <p className="muted empty">
                {list.data.businesses.length
                  ? "Nothing matches this search."
                  : "No businesses yet. Invite the first one."}
              </p>
            )}
          </Panel>
        </>
      ) : null}
      {inviting ? <InviteDialog onClose={() => setInviting(false)} onSent={list.reload} /> : null}
    </>
  );
}

function InviteDialog({ onClose, onSent }: { onClose: () => void; onSent: () => Promise<void> }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/api/invitations/businesses", { email });
      await onSent();
      onClose();
      toast("Invitation sent");
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.details?.email
          ? `The email ${err.details.email}.`
          : messageOf(err),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label="Invite a business" onClose={onClose}>
      <h2>Invite a business</h2>
      <p className="muted">
        Its owner opens the invitation, gives their details and the first venue, then signs in with
        a code. Nothing is created until they do.
      </p>
      <form className="form" onSubmit={send} noValidate>
        <Field
          label="Owner's email"
          id="inv-email"
          error={error}
          hint="Bound to this address, for 72 hours. If they already use HashiNet, the business joins their account menu."
        >
          <input
            id="inv-email"
            className="input"
            type="email"
            autoComplete="off"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby="inv-email-error"
          />
        </Field>
        <div className="callout">It starts with the default packages.</div>
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy}>
            Send invitation
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
