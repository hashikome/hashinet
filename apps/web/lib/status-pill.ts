/**
 * One palette for every status pill in the admin UI.
 *
 * Every status in the admin takes its colours from here, so a state reads the same on every page.
 *
 * Each tone is defined once, for both themes:
 *   light — a pale wash of the hue with its dark shade as text (at least 4.5:1 on a white card)
 *   dark  — a stronger wash with its light shade as text (at least 7:1 on the dark card)
 * plus an inset ring rather than a border, so the chip has an edge in both themes without
 * a light-mode hairline surviving into dark mode.
 *
 * Pass the result as `className` on a `<Badge>`; tailwind-merge drops the variant's own
 * background and text colour in favour of these.
 */
export const statusPill = {
  /** Working as intended — online, active, paid, connected. */
  success: "bg-primary/12 text-ember ring-1 ring-inset ring-primary/30 dark:bg-primary/15",

  /** In progress, or fine but worth noticing — provisioning, pending, maintenance. Not ember, which means alive. */
  warning: "bg-secondary text-secondary-foreground ring-1 ring-inset ring-border",

  /** Needs a human — failed, terminated, error. */
  danger:
    "bg-red-500/12 text-red-700 ring-1 ring-inset ring-red-600/20 " +
    "dark:bg-red-400/15 dark:text-red-300 dark:ring-red-400/25",

  /** Finished, neutral-good — a spent voucher, a closed session. */
  info:
    "bg-zinc-500/12 text-zinc-700 ring-1 ring-inset ring-zinc-600/20 " +
    "dark:bg-zinc-400/15 dark:text-zinc-300 dark:ring-zinc-400/25",

  /** Waiting on something external — the router hasn't confirmed yet. */
  accent: "bg-accent text-accent-foreground ring-1 ring-inset ring-primary/20",
  neutral:
    "bg-muted text-muted-foreground ring-1 ring-inset ring-border " +
    "dark:bg-muted dark:text-muted-foreground",
} as const;

export type StatusTone = keyof typeof statusPill;
