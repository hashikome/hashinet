"use client";

import type { VenueOnboarding } from "@hashinet/types";
import type { ReactNode } from "react";
import { LINE_NAME } from "@/lib/issues";
import { tsh } from "@/lib/money";
import { Panel } from "./ui";

/* A venue's way to serving guests, as the team and the owner both see it (prototype `.setup`). */

export interface Step {
  title: string;
  /** Under the title on the rail: what it waits for, or how it went. */
  todo: string;
  done: string;
  body: ReactNode;
  /** Done by the admin and managers whoever holds the issue. */
  anyone?: boolean;
}

/** The steps down a rail, the current one open beside it (prototype `.setup`). */
export function SetupRail({
  steps,
  now,
  lock = null,
  title = "What to do",
}: {
  steps: Step[];
  now: number;
  lock?: ReactNode;
  title?: string;
}) {
  const step = steps[now];
  return (
    <Panel title={title}>
      <div className="setup">
        <ol className="todo checklist setup-rail">
          {steps.map((s, n) => (
            <li
              key={s.title}
              className={n < now ? "done" : n === now ? "now" : ""}
              aria-current={n === now ? "step" : undefined}
            >
              <div>
                <h3>{s.title}</h3>
                <div className="sub">{n < now ? s.done : s.todo}</div>
              </div>
            </li>
          ))}
        </ol>
        {step ? (
          <div className="setup-now">
            <h3>{step.title}</h3>
            {lock && !step.anyone ? lock : step.body}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/** What the package costs, line by line, and its total. */
export function Breakdown({
  agreed,
  money = true,
}: {
  agreed: NonNullable<VenueOnboarding["agreed"]>;
  money?: boolean;
}) {
  return (
    <table className="lines-table">
      <tbody>
        {agreed.lines.map((l, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are in their agreed order
          <tr key={n}>
            <td>
              {LINE_NAME[l.kind]}
              {l.description ? <span className="sub">{l.description}</span> : null}
            </td>
            {money ? <td className="r num">{l.amountTsh ? tsh(l.amountTsh) : "Free"}</td> : null}
          </tr>
        ))}
      </tbody>
      {money ? (
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="r num">{tsh(agreed.totalTsh)}</td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
