"use client";

import type { MembershipRole, TeamList, TeamMember } from "@hashinet/types";
import { type FormEvent, useState } from "react";
import { Dialog } from "@/components/hearth/dialog";
import { Button, CopyText, Field, Head, Panel, Table, useToast } from "@/components/hearth/ui";
import { api, messageOf } from "@/lib/api";
import { shortDate, when } from "@/lib/dates";
import { LoadFailed, useLoad } from "@/lib/load";
import { ROLE_NAME } from "@/lib/nav";
import { matchesSearch } from "@/lib/search";
import { useCan, useSession } from "@/lib/session";
import { useSubmit } from "@/lib/submit";

type Ask = { kind: "role" | "remove"; person: TeamMember } | { kind: "invite" } | null;

/**
 * HashiNet's team (prototype `team`, the platform's): who runs HashiNet, by rank. Nobody gives,
 * changes or removes a role at or above their own; the API says whom the reader may manage.
 */
export default function TeamPage() {
  const { me } = useSession();
  const can = useCan();
  const toast = useToast();
  const [ask, setAsk] = useState<Ask>(null);
  const [search, setSearch] = useState("");
  const team = useLoad(() => api.get<TeamList>("/api/team"), [me.active.id]);
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
            ? `The people who run HashiNet · ${team.data.members.length} ${team.data.members.length === 1 ? "person" : "people"}`
            : "The people who run HashiNet"
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
            cols={[["Email"], ["Role"], ["Link works until"], [""]]}
            rows={team.data.invitations.map((inv) => ({
              key: inv.id,
              cells: [
                <CopyText key="e" text={inv.email} />,
                ROLE_NAME[inv.role],
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
                cols={[["Person"], ["Role"], ["Last worked here"], [""]]}
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
          roles={team.data.assignable}
          onClose={() => setAsk(null)}
          onSent={team.reload}
        />
      ) : null}
      {ask?.kind === "role" && team.data ? (
        <RoleDialog
          person={ask.person}
          roles={team.data.assignable}
          onClose={() => setAsk(null)}
          onSave={(role) =>
            act(
              () => api.put(`/api/team/${ask.person.membershipId}`, { role }),
              `${ask.person.name} is ${role === "operator" ? "an" : "a"} ${ROLE_NAME[role].toLowerCase()} now.`,
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

function RoleDialog({
  person,
  roles,
  onClose,
  onSave,
}: {
  person: TeamMember;
  roles: MembershipRole[];
  onClose: () => void;
  onSave: (role: MembershipRole) => void;
}) {
  const [role, setRole] = useState(person.role);
  const first = person.name.split(" ")[0] ?? person.name;
  return (
    <Dialog label={`Change ${first}'s role`} onClose={onClose}>
      <h2>Change {first}&apos;s role</h2>
      <p className="muted">It takes effect the next time they open HashiNet.</p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(role);
        }}
      >
        <Field label="Role" id="tr">
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
        <div className="dialog-actions">
          <Button kind="primary" type="submit" disabled={role === person.role}>
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
  roles,
  onClose,
  onSent,
}: {
  roles: MembershipRole[];
  onClose: () => void;
  onSent: () => Promise<void>;
}) {
  const { busy, errors, run } = useSubmit();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>(roles[roles.length - 1] ?? "operator");
  async function send(e: FormEvent) {
    e.preventDefault();
    const sent = await run(
      () => api.post("/api/team/invitations", { email, role }),
      `Invitation sent to ${email.trim().toLowerCase()}.`,
    );
    if (sent) {
      await onSent();
      onClose();
    }
  }
  return (
    <Dialog label="Invite someone" onClose={onClose}>
      <h2>Invite someone to HashiNet&apos;s team</h2>
      <p className="muted">
        They open the invitation, give their name, then sign in with a code and protect their
        sign-in before they start.
      </p>
      <form className="form" onSubmit={send} noValidate>
        <Field
          label="Their email"
          id="ie"
          error={errors.email ? `The email ${errors.email}.` : undefined}
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
        <Field label="Role" id="ir" hint="Operators install routers at the setups handed to them">
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
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy}>
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
