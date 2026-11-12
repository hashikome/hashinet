"use client";

import { type ReactNode, useEffect, useRef } from "react";

/**
 * A dialog over the page (prototype `.dialog`): Escape or a click on the backdrop closes it, focus
 * starts on its first field (or on Cancel, for a confirmation) and stays inside, and returns to
 * where it was on close.
 */
export function Dialog({
  label,
  onClose,
  alert = false,
  children,
}: {
  label: string;
  onClose: () => void;
  /** A confirmation of something that can't be taken back: focus starts on Cancel. */
  alert?: boolean;
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
      : root?.querySelector<HTMLElement>("input, select, textarea, button");
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
        <div ref={box} className="dialog" role="alertdialog" aria-modal="true" aria-label={label}>
          {children}
        </div>
      ) : (
        <div ref={box} className="dialog" role="dialog" aria-modal="true" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
