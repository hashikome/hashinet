"use client";

import type { IssueDetail, IssueMoved, VenueOnboarding } from "@hashinet/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, use, useState } from "react";
import { Dialog } from "@/components/hearth/dialog";
import {
  Attention,
  Button,
  Field,
  Head,
  Panel,
  Pill,
  Table,
  useToast,
} from "@/components/hearth/ui";
import { ApiRequestError, api, messageOf } from "@/lib/api";
import { when } from "@/lib/dates";
import { actorOf, eventText, issueTitle, issueWhere, setupDay } from "@/lib/issues";
import { LoadFailed, useLoad } from "@/lib/load";
import { useCan, useSession } from "@/lib/session";
import { Contact } from "./contact";
import { Agreed, PackageSteps, SetupSteps } from "./onboarding-steps";

/**
 * An issue's page (prototype `issue`, `setupIssue`, `resolvedIssue`): who is responsible and the
 * steps to Claim, Hand to, Release or Take over; what to do now; and its history, in order. A
 * resolved issue keeps its page, read-only.
 */
export default function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useSession();
  const data = useLoad(async () => {
    const detail = await api.get<IssueDetail>(`/api/issues/${id}`);
    const venueId = detail.issue.kind !== "router_offline" ? detail.issue.venue?.id : null;
    const onboarding = venueId
      ? await api.get<VenueOnboarding>(`/api/venues/${venueId}/onboarding`)
      : null;
    return { detail, onboarding };
  }, [id, me.active.id]);
  const crumb = (
    <>
      <Link href="/issues">Issues</Link> /
    </>
  );
  if (data.error) {
    return (
      <>
        <Head title="Issue" sub="" crumb={crumb} />
        <LoadFailed error={data.error} retry={data.reload} />
      </>
    );
  }
  if (!data.data) return <Head title="Issue" sub="" crumb={crumb} />;
  const { detail, onboarding } = data.data;
  const { issue } = detail;
  const open = issue.status === "open";
  const sub = (
    <>
      {issue.venue ? (
        <Link className="link" href={`/venues/${issue.venue.id}/router`}>
          {issueWhere(issue)}
        </Link>
      ) : null}
      {` · opened ${when(issue.openedAt)}`}
      {issue.resolvedAt ? ` · resolved ${when(issue.resolvedAt)}` : ""}
    </>
  );
  // Someone else holds it: their steps are theirs until it is taken over, except recording a
  // payment, which the admin and managers do whoever is responsible (ADR-0013, 2).
  const lockedBy = open && issue.holder && !issue.mine ? issue.holder.name : null;
  const lock = lockedBy ? (
    <p className="muted">
      {lockedBy} is responsible for this issue.{" "}
      {issue.canTakeOver
        ? "Take over to do this step."
        : "Ask them to release it or hand it to you."}
    </p>
  ) : null;

  return (
    <>
      <Head
        title={issueTitle(issue)}
        sub={sub}
        crumb={crumb}
        actions={open ? <Holder detail={detail} reload={data.reload} /> : null}
      />
      {issue.kind === "router_offline" && open ? <RouterSteps detail={detail} lock={lock} /> : null}
      {issue.kind === "venue_package" && onboarding && open ? (
        <PackageSteps onboarding={onboarding} detail={detail} lock={lock} reload={data.reload} />
      ) : null}
      {issue.kind === "venue_setup" && onboarding && open ? (
        <SetupSteps onboarding={onboarding} detail={detail} lock={lock} />
      ) : null}
      {onboarding?.issueId && onboarding.issueId !== issue.id ? (
        <Attention
          title="Its setup is next"
          action={
            <Link className="btn primary" href={`/issues/${onboarding.issueId}`}>
              <span>Open issue</span>
            </Link>
          }
        >
          {onboarding.setupDate ? `On ${setupDay(onboarding.setupDate)}. ` : ""}
          The setup is its own issue, for whoever goes.
        </Attention>
      ) : null}
      {onboarding?.agreed && (!open || issue.kind === "venue_setup") ? (
        <Agreed onboarding={onboarding} />
      ) : null}
      <History detail={detail} reload={data.reload} />
    </>
  );
}

/** Responsible, and the steps that move the issue between people. */
function Holder({ detail, reload }: { detail: IssueDetail; reload: () => Promise<void> }) {
  const { issue } = detail;
  const toast = useToast();
  const router = useRouter();
  const can = useCan();
  const [dialog, setDialog] = useState<"hand" | "take" | null>(null);
  const [busy, setBusy] = useState(false);
  if (!can("issue.work")) return null;
  const act = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    try {
      const moved = await api.post<IssueMoved | IssueDetail>(
        `/api/issues/${issue.id}/${path}`,
        body,
      );
      setDialog(null);
      toast(done);
      // Given away, an operator no longer sees it.
      if ("visible" in moved && !moved.visible) router.push("/issues");
      else await reload();
    } catch (e) {
      toast(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const stalled = issue.stalled ? <Pill kind="bad">Stalled: nothing done for a day</Pill> : null;
  let controls: ReactNode;
  if (issue.canClaim) {
    controls = (
      <Button busy={busy} onClick={() => act("claim", {}, "It's yours. Others see you're on it.")}>
        Claim
      </Button>
    );
  } else if (issue.canRelease) {
    controls = (
      <>
        {stalled}
        <span className="small muted">Responsible: you</span>
        {detail.handTo.length ? <Button onClick={() => setDialog("hand")}>Hand to</Button> : null}
        <Button
          busy={busy}
          onClick={() => act("release", {}, "Released. Anyone on the team can claim it.")}
        >
          Release
        </Button>
      </>
    );
  } else {
    controls = (
      <>
        {stalled}
        <span className="small muted">Responsible: {issue.holder?.name}</span>
        {issue.canTakeOver ? <Button onClick={() => setDialog("take")}>Take over</Button> : null}
      </>
    );
  }
  return (
    <>
      {controls}
      {dialog === "hand" ? (
        <HandDialog
          detail={detail}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(to, note) =>
            act(
              "hand",
              { to, note: note || null },
              `Handed to ${detail.handTo.find((p) => p.membershipId === to)?.name}.`,
            )
          }
        />
      ) : null}
      {dialog === "take" && issue.holder ? (
        <TakeDialog
          holder={issue.holder.name}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(reason) =>
            act("take-over", { reason }, `It's yours now. ${issue.holder?.name} sees your reason.`)
          }
        />
      ) : null}
    </>
  );
}

function HandDialog({
  detail,
  busy,
  onClose,
  onSave,
}: {
  detail: IssueDetail;
  busy: boolean;
  onClose: () => void;
  onSave: (to: string, note: string) => void;
}) {
  const [to, setTo] = useState(detail.handTo[0]?.membershipId ?? "");
  const [note, setNote] = useState("");
  return (
    <Dialog label="Hand this issue to" onClose={onClose}>
      <h2>Hand this issue to</h2>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(to, note.trim());
        }}
      >
        <Field label="Colleague" id="hw">
          <select id="hw" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            {detail.handTo.map((p) => (
              <option key={p.membershipId} value={p.membershipId}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Note for them"
          id="hn"
          hint="Optional, such as when the owner can take a call"
        >
          <input
            id="hn"
            className="input"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy}>
            Hand over
          </Button>
          <Button data-cancel onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TakeDialog({
  holder,
  busy,
  onClose,
  onSave,
}: {
  holder: string;
  busy: boolean;
  onClose: () => void;
  onSave: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog label="Take over" onClose={onClose}>
      <h2>Take over from {holder}</h2>
      <p className="muted">{holder} sees your reason on the issue.</p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) onSave(reason.trim());
        }}
      >
        <Field label="Reason" id="tr" hint="Such as who is off today, or what is waiting">
          <input
            id="tr"
            className="input"
            maxLength={500}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div className="dialog-actions">
          <Button kind="primary" type="submit" busy={busy} disabled={!reason.trim()}>
            Take over
          </Button>
          <Button data-cancel onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A router that stopped serving: check it, ask the venue, set it up again if it comes back wrong. */
function RouterSteps({ detail, lock }: { detail: IssueDetail; lock: ReactNode | null }) {
  const { issue, contact } = detail;
  const can = useCan();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const routerHref = issue.venue ? `/venues/${issue.venue.id}/router` : "/issues";
  const steps: [string, ReactNode, ReactNode][] = [
    [
      "Run the checks",
      "HashiNet tries the tunnel and the router's API. Once it serves again, this issue closes by itself.",
      can("router.check") && issue.router ? (
        <Button
          key="c"
          kind="primary"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.post(`/api/routers/${issue.router?.id}/verify`);
              toast("Checked. The router page has each result.");
            } catch (e) {
              toast(messageOf(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Run checks
        </Button>
      ) : null,
    ],
    [
      contact ? "Ask the venue" : "Check the venue",
      <>
        Power and internet line first: is the MikroTik router&apos;s light on, and is the ISP router
        online?
        {contact ? <Contact contact={contact} /> : null}
      </>,
      null,
    ],
    [
      "If it comes back wrong",
      "When it reconnects but a check fails, set it up again from its router page.",
      <Link key="r" className="btn secondary" href={routerHref}>
        <span>Open router</span>
      </Link>,
    ],
  ];
  return (
    <Panel title="What to do">
      <ol className="todo checklist setup-steps">
        {steps.map(([title, body, action], n) => (
          <li key={title} className={n === 0 ? "now" : ""}>
            <div>
              <h3>{title}</h3>
              <div className="step-body">
                <p>{body}</p>
                {n === 0 ? lock : null}
              </div>
            </div>
            {action && !lock ? <div className="actions">{action}</div> : null}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** What happened, in order, and a note anyone working on it can add. */
function History({ detail, reload }: { detail: IssueDetail; reload: () => Promise<void> }) {
  const can = useCan();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { issue } = detail;
  const mayNote = issue.canNote && can("issue.work");
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/issues/${issue.id}/note`, { note: note.trim() });
      setNote("");
      await reload();
    } catch (err) {
      toast(
        err instanceof ApiRequestError && err.details?.note
          ? `The note ${err.details.note}.`
          : messageOf(err),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="History">
      <Table
        cols={[["What"], ["Who"], ["When"]]}
        rows={detail.events.map((e, n) => ({
          key: String(n),
          cells: [
            eventText(e),
            actorOf(e),
            <span className="num nowrap" key="w">
              {when(e.at)}
            </span>,
          ],
        }))}
      />
      {mayNote ? (
        <form className="form note-form" onSubmit={add}>
          <Field
            label="Add a note"
            id="in"
            hint={
              issue.holder
                ? "Kept on this issue, with your name"
                : "Adding one makes you responsible"
            }
          >
            <input
              id="in"
              className="input"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="form-save">
            <Button type="submit" busy={busy} disabled={!note.trim()}>
              Add note
            </Button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}
