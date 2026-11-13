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
}

/** The steps down a rail, the current one open beside it (prototype `.setup`). */
export function SetupRail({ steps, now, title }: { steps: Step[]; now: number; title: string }) {
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
            {step.body}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * What the package is, line by line, with what each costs and the total when the reader sees
 * money (HashiNet's operators see what to bring, not its price).
 */
export function Breakdown({ agreed }: { agreed: NonNullable<VenueOnboarding["agreed"]> }) {
  const total = agreed.totalTsh;
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
            {l.amountTsh === null ? null : (
              <td className="r num">{l.amountTsh ? tsh(l.amountTsh) : "Free"}</td>
            )}
          </tr>
        ))}
      </tbody>
      {total === null ? null : (
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="r num">{tsh(total)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
