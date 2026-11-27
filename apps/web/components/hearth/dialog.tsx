"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

/**
 * A dialog over the page (prototype `.dialog`): Escape or a click on the backdrop closes it, focus
 * starts on its first field (or on Cancel, for a confirmation) and stays inside, and returns to
 * where it was on close.
 */
export function Dialog({
  label,
  onClose,
  alert = false,
  className = "",
  children,
}: {
  label: string;
  onClose: () => void;
  /** A confirmation of something that can't be taken back: focus starts on Cancel. */
  alert?: boolean;
  /** A dialog's own look, such as Sell's (`sell`, `sell-c`, `sale-card`). */
  className?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  // The latest close, so typing in the dialog (a new onClose each render) never refocuses it.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const root = box.current;
    const first = alert
      ? root?.querySelector<HTMLElement>("[data-cancel]")
      : // The first field, else the first button: never the × in the corner when there is a field.
        (root?.querySelector<HTMLElement>("input, select, textarea") ??
        root?.querySelector<HTMLElement>("button:not(.dialog-close)") ??
        root?.querySelector<HTMLElement>("button"));
    first?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close.current();
      if (e.key !== "Tab" || !root) return;
      const all = [
        ...root.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input, select, textarea",
        ),
      ];
      const [head, tail] = [all[0], all[all.length - 1]];
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail?.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head?.focus();
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      before?.focus();
    };
  }, [alert]);
  return (
    // The backdrop closes on a click; the keyboard closes with Escape, above.
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is not a control
    <div
      className="dialog-wrap"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {alert ? (
        <div
          ref={box}
          className={`dialog ${className}`.trim()}
          role="alertdialog"
          aria-modal="true"
          aria-label={label}
        >
          {children}
        </div>
      ) : (
        <div
          ref={box}
          className={`dialog ${className}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** The × in a dialog's corner (Sell, a change to how you sign in): closes it, as Escape does. */
export function DialogClose({ onClose }: { onClose: () => void }) {
  return (
    <button className="dialog-close" type="button" aria-label="Close" onClick={onClose}>
      <Icon name="close" size={16} />
    </button>
  );
}

/** What closing a step costs, asked before it closes: "Stop replacing your authenticator app?" */
export interface LeaveQuestion {
  question: string;
  why: string;
  /** The button that closes anyway: "Stop", "Close". */
  stop: string;
}

/**
 * A dialog with steps (prototype `flowCard`): one size through every step and one place on the screen,
 * so moving on never resizes or moves it; its name with one quiet line for where you are ("Scan and
 * verify · 2 of 3"); the step below; and the × in its corner. Where closing costs something (`leave`),
 * the ×, Escape and a click outside ask first, in the same dialog, and the step is kept for Keep going.
 */
export function StepDialog({
  title,
  step,
  leave = null,
  onClose,
  className = "",
  children,
}: {
  title: string;
  /** Where this step is: its name, its place and how many; null for a flow of one step. */
  step: { name: string; at: number; of: number } | null;
  leave?: LeaveQuestion | null;
  onClose: () => void;
  /** The flow's own look inside, such as Account's (`acct-flow`). */
  className?: string;
  children: ReactNode;
}) {
  const [leaving, setLeaving] = useState(false);
  const stay = () => setLeaving(false);
  const close = leaving ? stay : leave ? () => setLeaving(true) : onClose;
  return (
    <Dialog label={title} className={`step-dialog ${className}`.trim()} onClose={close}>
      <DialogClose onClose={close} />
      {leaving && leave ? (
        <>
          <div className="step-head">
            <h2>{leave.question}</h2>
          </div>
          <p className="muted">{leave.why}</p>
          <div className="dialog-actions">
            <button className="btn primary" type="button" onClick={stay}>
              Keep going
            </button>
            <button className="btn danger" type="button" onClick={onClose}>
              {leave.stop}
            </button>
          </div>
        </>
      ) : (
        <div className="step-head">
          <h2>{title}</h2>
          {step && step.of > 1 ? (
            <p className="step-where">
              {step.name} · {step.at} of {step.of}
            </p>
          ) : null}
        </div>
      )}
      {/* Kept while the question shows, so Keep going returns to the step as it was. */}
      <div className="step-body" hidden={leaving}>
        {children}
      </div>
    </Dialog>
  );
}
