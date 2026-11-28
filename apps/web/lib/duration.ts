/**
 * Package and voucher durations, in **whole minutes**.
 *
 * Durations were whole *hours* until 2026-08-12 (`0014_duration_minutes.sql`), which made a
 * 30-minute bundle impossible to express. If you find a `durationHours` anywhere, it is a missed
 * call site.
 *
 * This replaces three separate hour-based `formatDuration` copies — in `package-view-dialog.tsx`,
 * `vouchers/page.tsx` and `voucher-preview.tsx` — which had drifted: two used `Math.floor` on
 * weeks and rendered 10 days as "1 week", one capitalised its units, and one pluralised "Week"
 * only above 336 hours so 2 weeks read as "2 Week".
 *
 * A "month" is 30 days, matching the 720-hour convention the presets used.
 */

const MINUTE = 1;
const HOUR = 60;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

export type DurationUnit = "minutes" | "hours" | "days" | "weeks" | "months";

const UNIT_MINUTES: Record<DurationUnit, number> = {
  minutes: MINUTE,
  hours: HOUR,
  days: DAY,
  weeks: WEEK,
  months: MONTH,
};

export const DURATION_UNITS: { value: DurationUnit; label: string }[] = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
];

/** Whole minutes for `value` of `unit`, or null when the input is not a usable duration. */
export function toMinutes(value: number, unit: DurationUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const minutes = Math.round(value * UNIT_MINUTES[unit]);
  return minutes > 0 ? minutes : null;
}

/**
 * The largest unit that divides `minutes` exactly, so editing a package shows the duration the way
 * it was entered: 90 stays "90 minutes" rather than becoming "1.5 hours".
 */
function splitDuration(minutes: number): { value: number; unit: DurationUnit } {
  const units: DurationUnit[] = ["months", "weeks", "days", "hours", "minutes"];
  for (const unit of units) {
    const size = UNIT_MINUTES[unit];
    if (minutes >= size && minutes % size === 0) return { value: minutes / size, unit };
  }
  return { value: minutes, unit: "minutes" };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "45 minutes", "1 hour", "2 days", "1 week". Returns "—" for a missing duration. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes <= 0) return "—";
  const { value, unit } = splitDuration(minutes);
  return plural(value, unit.slice(0, -1));
}

/** "19m left", "22h 41m left", "3d left": a voucher's time from now, where it ends. */
export function timeLeft(endsAt: string | null, now = Date.now()): string {
  if (endsAt === null) return "No end";
  const minutes = Math.floor((new Date(endsAt).getTime() - now) / 60_000);
  if (minutes <= 0) return "Ending now";
  if (minutes < HOUR) return `${minutes}m left`;
  if (minutes < DAY) return `${Math.floor(minutes / HOUR)}h ${minutes % HOUR}m left`;
  return `${Math.floor(minutes / DAY)}d left`;
}

/** "3h 12m", "45m": how long something lasted. */
export function hoursAndMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return h ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}
