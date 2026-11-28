"use client";

import type { IssueDetail } from "@hashinet/types";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Button, Panel, useToast } from "@/components/ui/ui";
import { api, messageOf } from "@/lib/api";
import { useCan } from "@/lib/session";
import { Contact } from "./contact";

/** A router that stopped serving: check it, ask the venue, set it up again if it comes back wrong. */
export function RouterSteps({ detail, lock }: { detail: IssueDetail; lock: ReactNode | null }) {
  const { issue, contact } = detail;
  const can = useCan();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Steps
      lock={lock}
      steps={[
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
            Power and internet line first: is the MikroTik router&apos;s light on, and is the ISP
            router online?
            {contact ? <Contact contact={contact} /> : null}
          </>,
          null,
        ],
        [
          "If it comes back wrong",
          "When it reconnects but a check fails, set it up again from its router page.",
          <OpenRouter key="r" issue={issue} />,
        ],
      ]}
    />
  );
}

/**
 * HashiNet set the router up again after a release and the setup stopped (prototype `setupFailed`):
 * until it is set up, guests at this router can't get online.
 */
export function RouterSetupSteps({
  detail,
  lock,
}: {
  detail: IssueDetail;
  lock: ReactNode | null;
}) {
  const { issue, contact } = detail;
  return (
    <Steps
      lock={lock}
      steps={[
        [
          "Set up again",
          "HashiNet's update needs every router set up again, and this one stopped. Run it again from the router page: it applies only what is left.",
          <OpenRouter key="r" issue={issue} />,
        ],
        [
          contact ? "Ask the venue" : "Check the venue",
          <>
            Power and internet line first: a router that loses its line stops mid-setup.
            {contact ? <Contact contact={contact} /> : null}
          </>,
          null,
        ],
        [
          "If it stops at the same step",
          "The router page's checks say what fails. Until it is set up, guests at this router can't get online.",
          null,
        ],
      ]}
    />
  );
}

function OpenRouter({ issue }: { issue: IssueDetail["issue"] }) {
  return (
    <Link
      className="btn secondary"
      href={issue.venue ? `/venues/${issue.venue.id}/router` : "/issues"}
    >
      <span>Open router</span>
    </Link>
  );
}

/** A router issue's steps: the first is now, and its actions wait while someone else holds it. */
function Steps({
  steps,
  lock,
}: {
  steps: [string, ReactNode, ReactNode][];
  lock: ReactNode | null;
}) {
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
