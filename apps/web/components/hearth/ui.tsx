"use client";

import type { RouterCondition } from "@hashinet/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon, type IconName } from "./icons";

/* The prototype's building blocks (ui.js), as components with the same markup and classes. */

/** A page's title, its one-line purpose, and its actions at the right. */
export function Head({
  title,
  sub,
  actions,
  crumb,
}: {
  title: string;
  sub: ReactNode;
  actions?: ReactNode;
  crumb?: ReactNode;
}) {
  return (
    <div className="head">
      <div>
        {crumb ? <div className="crumb">{crumb}</div> : null}
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}

export function Panel({
  title,
  right,
  children,
  className = "",
  label,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section className={`panel ${className}`.trim()} aria-label={label}>
      <div className="panel-head">
        <h2>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Something that needs the reader, with its action. */
export function Attention({
  title,
  children,
  action,
  bad = false,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  bad?: boolean;
}) {
  return (
    <section className={`panel attention${bad ? " bad" : ""}`}>
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
      {action}
    </section>
  );
}

export type PillKind = "ok" | "wait" | "bad" | "neutral";

export function Pill({ kind = "neutral", children }: { kind?: PillKind; children: ReactNode }) {
  return <span className={`pill ${kind}`}>{children}</span>;
}

/** Three or two figures across: a label, the figure, and what it means. */
export function Figs({ items }: { items: [string, ReactNode, ReactNode][] }) {
  const size = items.length === 3 ? " three" : items.length === 2 ? " pair" : "";
  return (
    <section className={`figs${size}`}>
      {items.map(([label, value, note]) => (
        <div className="fig" key={label}>
          <small>{label}</small>
          <b>{value}</b>
          <span>{note}</span>
        </div>
      ))}
    </section>
  );
}

type ButtonKind = "primary" | "secondary" | "danger";

export function Button({
  kind = "secondary",
  icon,
  busy = false,
  children,
  className = "",
  type = "button",
  ...rest
}: {
  kind?: ButtonKind;
  icon?: IconName;
  busy?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`btn ${kind} ${className}`.trim()}
      type={type === "submit" ? "submit" : "button"}
      disabled={busy || rest.disabled}
      aria-busy={busy || undefined}
    >
      {icon ? <Icon name={icon} size={15} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function ButtonLink({
  href,
  kind = "secondary",
  icon,
  children,
}: {
  href: string;
  kind?: ButtonKind;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <Link className={`btn ${kind}`} href={href}>
      {icon ? <Icon name={icon} size={15} /> : null}
      <span>{children}</span>
    </Link>
  );
}

/** What people copy (an email, a code, a reference) copies when clicked. It is information, not an action. */
export function CopyText({ text, label = text }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="copy-text"
      title="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => undefined);
        toast(`Copied ${label}`);
      }}
    >
      {label}
    </button>
  );
}

/** A labelled field with an optional hint and the API's message for it. */
export function Field({
  label,
  hint,
  error,
  id,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <div className="hint danger" id={`${id}-error`}>
          {error}
        </div>
      ) : hint ? (
        <div className="hint">{hint}</div>
      ) : null}
    </div>
  );
}

/** A column: its heading, and whether it holds a number (right-aligned). A blank heading holds the row's action. */
export type Column = [heading: string, numeric?: boolean];
export interface Row {
  key: string;
  cells: ReactNode[];
  /** Opens the row's page. */
  href?: string;
}

/**
 * A table that stacks on a phone: each cell carries its column's name. With four columns or fewer the
 * subject takes the spare width; a name and one value stay one line on a phone.
 */
export function Table({
  cols,
  rows,
  total,
  narrow = false,
  label,
}: {
  cols: Column[];
  rows: Row[];
  total?: ReactNode[];
  narrow?: boolean;
  label?: string;
}) {
  const few = !narrow && cols.filter(([c]) => c).length <= 4;
  const pair = cols.length === 2 && cols[1]?.[0];
  const cells = (row: ReactNode[]) =>
    row.map((cell, i) => {
      const [heading, numeric] = cols[i] ?? [""];
      const className = numeric ? "r num" : !heading && i === cols.length - 1 ? "act" : undefined;
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional by column
        <td key={i} className={className} data-l={i && heading ? heading : undefined}>
          {i && heading ? <div className="cell">{cell}</div> : cell}
        </td>
      );
    });
  return (
    <table className={`stack${few ? " few" : ""}${pair ? " pair" : ""}`} aria-label={label}>
      <thead>
        <tr>
          {cols.map(([heading, numeric], i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: headings may repeat as blanks
            <th key={i} className={numeric ? "r" : undefined}>
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) =>
          row.href ? (
            <LinkedRow key={row.key} row={row} cells={cells} />
          ) : (
            <tr key={row.key}>{cells(row.cells)}</tr>
          ),
        )}
      </tbody>
      {total ? (
        <tfoot>
          <tr className="total">{cells(total)}</tr>
        </tfoot>
      ) : null}
    </table>
  );
}

function LinkedRow({ row, cells }: { row: Row; cells: (row: ReactNode[]) => ReactNode[] }) {
  const router = useRouter();
  const go = () => {
    if (row.href) router.push(row.href);
  };
  // A whole row opens its page, by click or by Enter, as a link would.
  return (
    // biome-ignore lint/a11y/useSemanticElements: a table row cannot be an anchor
    <tr
      className="go"
      tabIndex={0}
      role="link"
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      }}
    >
      {cells(row.cells)}
    </tr>
  );
}

/**
 * Six boxes for a six-digit code: typing moves on, Backspace moves back, a pasted or autofilled code
 * fills them all. The value keeps a space for each empty box.
 */
export function OtpBoxes({
  label,
  hiddenLabel = false,
  error,
  value,
  onChange,
}: {
  label: string;
  hiddenLabel?: boolean;
  error?: string;
  value: string;
  onChange: (digits: string) => void;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");
  const fill = (start: number, typed: string) => {
    const clean = typed.replace(/\D/g, "");
    const next = digits.slice();
    if (clean.length === 0) {
      next[start] = " ";
      onChange(next.join(""));
      return;
    }
    clean
      .slice(0, 6 - start)
      .split("")
      .forEach((d, i) => {
        next[start + i] = d;
      });
    onChange(next.join(""));
    boxes.current[Math.min(start + clean.length, 5)]?.focus();
  };
  return (
    <fieldset className="otp-set">
      <legend className={hiddenLabel ? "sr" : undefined}>{label}</legend>
      <div className="otp-boxes">
        {digits.map((d, i) => (
          <input
            // biome-ignore lint/suspicious/noArrayIndexKey: six fixed positions
            key={i}
            ref={(el) => {
              boxes.current[i] = el;
            }}
            className="otp-box"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${i + 1} of 6`}
            aria-invalid={error ? true : undefined}
            value={d.trim()}
            onChange={(e) => fill(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !d.trim() && i > 0) {
                e.preventDefault();
                const next = digits.slice();
                next[i - 1] = " ";
                onChange(next.join(""));
                boxes.current[i - 1]?.focus();
              }
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
              if (pasted.length < 2) return;
              e.preventDefault();
              fill(0, pasted);
            }}
          />
        ))}
      </div>
      <div className="otp-error" role="alert">
        {error}
      </div>
    </fieldset>
  );
}

/** Whether all six digits are in. */
export const otpComplete = (value: string) => /^\d{6}$/.test(value);

/** A row of settings: what it is and its state on the left, its action on the right. */
export function SettingRow({
  title,
  sub,
  action,
  className,
}: {
  title: ReactNode;
  sub: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <li className={className}>
      <div>
        <b>{title}</b>
        <span className="sub">{sub}</span>
      </div>
      {action}
    </li>
  );
}

const ToastContext = createContext<(text: string) => void>(() => undefined);

/** A short confirmation at the foot of the screen, read out by screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((next: string) => {
    setText(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(""), 2400);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-slot" role="status" aria-live="polite">
        {text ? <div className="toast">{text}</div> : null}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** How each page says a router's or a business's condition (the API decides which it is). */
export const CONDITION: Record<RouterCondition, [string, PillKind]> = {
  "setting-up": ["Setting up", "wait"],
  serving: ["Serving", "ok"],
  offline: ["Offline", "bad"],
  "needs-attention": ["Needs attention", "bad"],
};
