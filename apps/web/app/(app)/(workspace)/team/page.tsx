"use client";

import {
  type MembershipRole,
  type TeamList,
  type TeamMember,
  VENUE_ROLES,
  type VenueRecord,
} from "@hashinet/types";
import { type FormEvent, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button, CopyText, Field, Head, Panel, Table, useToast } from "@/components/ui/ui";
import { api, messageOf } from "@/lib/api";
import { shortDate, when } from "@/lib/dates";
import { LoadFailed, useLoad } from "@/lib/load";
import { ROLE_NAME } from "@/lib/nav";
import { matchesSearch } from "@/lib/search";
import { useCan, useSession } from "@/lib/session";
import { useSubmit } from "@/lib/submit";
import { useVenues } from "@/lib/venues";

const isVenueRole = (role: MembershipRole) => (VENUE_ROLES as readonly string[]).includes(role);

/** What each role does, said under the role's choice. */
const ROLE_HINT: Record<MembershipRole, string> = {
  admin: "Runs HashiNet",
  manager: "Runs businesses' onboarding and routers",
  operator: "Installs routers at the setups handed to them",
  owner: "Owns the business",
  business_manager: "Runs every venue: its team, packages and payments",
  venue_manager: "Runs the venues you choose: their team and their day",
  venue_operator: "Sells at the counter of the venues you choose",
};

type Ask = { kind: "role" | "remove"; person: TeamMember } | { kind: "invite" } | null;

/**
 * A workspace's team (prototype `team`): HashiNet's, or a business's with each venue role's venues.
 * Nobody gives, changes or removes a role at or above their own; the API says whom the reader may
 * manage, and a venue manager reaches only their own venues' people.
 */
export default function TeamPage() {
  const { me } = useSession();
  const can = useCan();
  const toast = useToast();
  const [ask, setAsk] = useState<Ask>(null);
  const [search, setSearch] = useState("");
  const team = useLoad("team", () => api.get<TeamList>("/api/team"), [me.active.id]);
  const { all: venues } = useVenues();
  const business = me.active.scope === "business";
  const who = business
    ? `the people who run ${me.active.business?.name ?? "the business"}`
    : "the people who run HashiNet";
  const venuesOf = (ids: string[]) =>
    ids.length === 0
      ? "Every venue"
      : ids
          .map((id) => venues.find((v) => v.id === id)?.name ?? "A venue since removed")
          .join(", ");
  const mayInvite = can("team.manage") && (team.data?.assignable.length ?? 0) > 0;
  const members = (team.data?.members ?? []).filter((m) =>
    matchesSearch(search, m.name, m.email, ROLE_NAME[m.role]),
  );
  const act = async (what: () => Promise<unknown>, done: string) => {
    try {
      await what();
      await team.reload();
      toast(done);
    } catch (e) {
      toast(messageOf(e));
    }
  };

  return (
    <>
      <Head
        title="Team"
        sub={
          team.data
            ? `${who[0]?.toUpperCase()}${who.slice(1)} · ${team.data.members.length} ${team.data.members.length === 1 ? "person" : "people"}`
            : `${who[0]?.toUpperCase()}${who.slice(1)}`
        }
        actions={
          mayInvite ? (
            <Button kind="primary" icon="plus" onClick={() => setAsk({ kind: "invite" })}>
              Invite someone
            </Button>
          ) : null
        }
      />
      {team.error ? <LoadFailed error={team.error} retry={team.reload} /> : null}
      {team.data?.invitations.length ? (
        <Panel title={`Invited, not joined yet · ${team.data.invitations.length}`}>
          <Table
            cols={[
              ["Email"],
              ["Role"],
              ...(business ? ([["Venues"]] as [string][]) : []),
              ["Link works until"],
              [""],
            ]}
            rows={team.data.invitations.map((inv) => ({
              key: inv.id,
              cells: [
                <CopyText key="e" text={inv.email} />,
                ROLE_NAME[inv.role],
                ...(business ? [venuesOf(inv.venueIds)] : []),
                when(inv.expiresAt),
                can("team.manage") ? (
                  <div className="actions row-actions" key="a">
                    <Button
                      onClick={() =>
                        act(
                          () => api.post(`/api/team/invitations/${inv.id}/resend`),
                          `A new link is on its way to ${inv.email}.`,
                        )
                      }
                    >
                      Resend
                    </Button>
                    <Button
                      kind="danger"
                      onClick={() =>
                        act(
                          () => api.delete(`/api/team/invitations/${inv.id}`),
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
      {team.data ? (
        <>
          <section className="panel">
            <form className="audit-filters" onSubmit={(e) => e.preventDefault()}>
              <div className="field grow">
                <label htmlFor="tq">Search</label>
                <input
                  id="tq"
                  className="input"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </form>
          </section>
          <Panel title={`${members.length} ${members.length === 1 ? "person" : "people"}`}>
            {members.length ? (
              <Table
                cols={[
                  ["Person"],
                  ["Role"],
                  ...(business ? ([["Venues"]] as [string][]) : []),
                  ["Last worked here"],
                  [""],
                ]}
                rows={members.map((m) => ({
                  key: m.membershipId,
                  cells: [
                    <div key="n">
                      <div className="name">{m.name}</div>
                      <div className="sub">
                        <CopyText text={m.email} />
                      </div>
                    </div>,
                    ROLE_NAME[m.role],
                    ...(business ? [venuesOf(m.venueIds)] : []),
                    m.lastUsedAt ? when(m.lastUsedAt) : `Joined ${shortDate(m.joinedAt)}`,
                    m.membershipId === me.active.id ? (
                      <span className="muted" key="y">
                        You
                      </span>
                    ) : m.manageable && can("team.manage") ? (
                      <div className="actions row-actions" key="a">
                        {(team.data?.assignable.length ?? 0) > 1 ? (
                          <Button onClick={() => setAsk({ kind: "role", person: m })}>
                            Change role
                          </Button>
                        ) : null}
                        <Button kind="danger" onClick={() => setAsk({ kind: "remove", person: m })}>
                          Remove
                        </Button>
                      </div>
                    ) : (
                      ""
                    ),
                  ],
                }))}
              />
            ) : (
              <p className="muted empty">Nobody matches this search.</p>
            )}
          </Panel>
        </>
      ) : null}
      {ask?.kind === "invite" && team.data ? (
        <InviteDialog
          team={business ? (me.active.business?.name ?? "the business") : "HashiNet"}
          venues={venues}
          roles={team.data.assignable}
          onClose={() => setAsk(null)}
          onSent={team.reload}
        />
      ) : null}
      {ask?.kind === "role" && team.data ? (
        <RoleDialog
          person={ask.person}
          venues={venues}
          roles={team.data.assignable}
          onClose={() => setAsk(null)}
          onSave={(role, venueIds) =>
            act(
              () => api.put(`/api/team/${ask.person.membershipId}`, { role, venueIds }),
              `${ask.person.name} is ${/^[aeio]/i.test(ROLE_NAME[role]) ? "an" : "a"} ${ROLE_NAME[role].toLowerCase()} now.`,
            ).then(() => setAsk(null))
          }
        />
      ) : null}
      {ask?.kind === "remove" ? (
        <Dialog label={`Remove ${ask.person.name}`} alert onClose={() => setAsk(null)}>
          <h2>Remove {ask.person.name}</h2>
          <p className="muted">
            {ask.person.name.split(" ")[0]} loses access straight away and is signed out everywhere.
            What they did stays in the audit log.
          </p>
          <div className="dialog-actions">
            <Button
              kind="danger"
              onClick={() =>
                act(
                  () => api.delete(`/api/team/${ask.person.membershipId}`),
                  `${ask.person.name} is removed.`,
                ).then(() => setAsk(null))
              }
            >
              Remove
            </Button>
            <Button data-cancel onClick={() => setAsk(null)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

/** The venues a venue role works at: at least one, from those the reader reaches. */
function VenuePicker({
  venues,
  value,
  onChange,
}: {
  venues: VenueRecord[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="field" aria-labelledby="vp-l">
      <span className="lbl" id="vp-l">
        Venues
      </span>
      {venues.map((v) => (
        <label className="check" key={v.id}>
          <input
            type="checkbox"
            checked={value.includes(v.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, v.id] : value.filter((id) => id !== v.id))
            }
          />{" "}
          <span>{v.name}</span>
        </label>
      ))}
      <span className="hint">They work only at the venues you choose</span>
    </fieldset>
  );
}

/** A venue role starts at the reader's one venue, when there is only one. */
const startingVenues = (venues: VenueRecord[]) =>
  venues.length === 1 && venues[0] ? [venues[0].id] : [];

function RoleDialog({
  person,
  venues,
  roles,
  onClose,
  onSave,
}: {
  person: TeamMember;
  venues: VenueRecord[];
  roles: MembershipRole[];
  onClose: () => void;
  onSave: (role: MembershipRole, venueIds: string[]) => void;
}) {
  const [role, setRole] = useState(person.role);
  const [chosen, setChosen] = useState(
    person.venueIds.length ? person.venueIds : startingVenues(venues),
  );
  const venueIds = isVenueRole(role) ? chosen : [];
  const same =
    role === person.role &&
    venueIds.length === person.venueIds.length &&
    venueIds.every((v) => person.venueIds.includes(v));
  const first = person.name.split(" ")[0] ?? person.name;
  return (
    <Dialog label={`Change ${first}'s role`} onClose={onClose}>
      <h2>Change {first}&apos;s role</h2>
      <p className="muted">It takes effect the next time they open HashiNet.</p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(role, venueIds);
        }}
      >
        <Field label="Role" id="tr" hint={ROLE_HINT[role]}>
          <select
            id="tr"
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as MembershipRole)}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_NAME[r]}
              </option>
            ))}
          </select>
        </Field>
        {isVenueRole(role) ? (
          <VenuePicker venues={venues} value={chosen} onChange={setChosen} />
        ) : null}
        <div className="dialog-actions">
          <Button
            kind="primary"
            type="submit"
            disabled={same || (isVenueRole(role) && venueIds.length === 0)}
          >
            Change role
          </Button>
          <Button data-cancel onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function InviteDialog({
  team,
  venues,
  roles,
  onClose,
  onSent,
}: {
  team: string;
  venues: VenueRecord[];
  roles: MembershipRole[];
  onClose: () => void;
  onSent: () => Promise<void>;
}) {
  const { busy, errors, run } = useSubmit();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>(roles[roles.length - 1] ?? "operator");
  const [chosen, setChosen] = useState(startingVenues(venues));
  const venueIds = isVenueRole(role) ? chosen : [];
  async function send(e: FormEvent) {
    e.preventDefault();
    const sent = await run(
      () => api.post("/api/team/invitations", { email, role, venueIds }),
      `Invitation sent to ${email.trim().toLowerCase()}.`,
    );
    if (sent) {
      await onSent();
      onClose();
    }
  }
  return (
    <Dialog label="Invite someone" onClose={onClose}>
      <h2>Invite someone to {team}&apos;s team</h2>
      <p className="muted">
        They open the invitation, give their name, then sign in with a code
        {role === "venue_operator" ? "." : " and protect their sign-in before they start."}
      </p>
      <form className="form" onSubmit={send} noValidate>
        <Field
          label="Their email"
          id="ie"
          {...(errors.email ? { error: `The email ${errors.email}.` } : {})}
          hint="The link works for this address only, for 72 hours"
        >
          <input
            id="ie"
            className="input"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Role" id="ir" hint={ROLE_HINT[role]}>
          <select
            id="ir"
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as MembershipRole)}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_NAME[r]}
              </option>
            ))}
          </select>
        </Field>
        {isVenueRole(role) ? (
          <VenuePicker venues={venues} value={chosen} onChange={setChosen} />
        ) : null}
        {errors.venueIds ? <p className="hint danger">The venues {errors.venueIds}.</p> : null}
        <div className="dialog-actions">
          <Button
            kind="primary"
            type="submit"
            busy={busy}
            disabled={isVenueRole(role) && venueIds.length === 0}
          >
            Send invitation
          </Button>
          <Button data-cancel onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
