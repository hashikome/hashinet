import type {
  IssueDetail,
  IssueKind,
  IssueRecord,
  OnboardingLineKind,
  OnboardingPlan,
  OnboardingStage,
  RouterCondition,
} from "@hashinet/types";
import { CONDITION, type PillKind } from "@/components/hearth/ui";
import { calendarDay, dayName, longDate } from "./dates";
import { formatDuration } from "./duration";
import { tsh } from "./money";
import { ROLE_NAME } from "./nav";

/** How each kind reads in a list's Kind column and filter. */
export const KIND_NAME: Record<IssueKind, string> = {
  router_offline: "Router",
  venue_package: "Package",
  venue_setup: "Setting up",
  bill_due: "Billing",
  selling_paused: "Selling",
};

/** The plans as an owner and the team read them (ADR-0013, 2): each one goes a step further. */
export const PLAN: Record<OnboardingPlan, { name: string; text: string; needs: string }> = {
  connect: {
    name: "Connect",
    text: "The venue already has a MikroTik router on RouterOS 7. We set it up for HashiNet.",
    needs: "your own MikroTik router and an internet line",
  },
  install: {
    name: "Install",
    text: "We bring a MikroTik router for the venue, set it up and install it behind its internet router.",
    needs: "an internet line at the venue",
  },
  launch: {
    name: "Launch",
    text: "Install, plus a new internet line from a partner provider. The owner registers the line in the business's name on the day.",
    needs: "the owner there on the day, to register the line",
  },
};

export const LINE_NAME: Record<OnboardingLineKind, string> = {
  onboarding_fee: "Onboarding fee",
  mikrotik_router: "MikroTik router",
  isp_router: "ISP router",
  internet_line: "Internet line",
  other: "Other",
};

/** An issue's title, open or resolved. */
export function issueTitle(i: IssueRecord): string {
  const open = i.status === "open";
  const venue = i.venue?.name ?? "A venue";
  switch (i.kind) {
    case "router_offline":
      // Said as what took it down: "has no internet" reads truer than "offline" for a router that answers.
      return i.cause === "no-internet"
        ? `${i.router?.name ?? "A router"} ${open ? "has" : "had"} no internet`
        : i.cause === "needs-attention"
          ? `${i.router?.name ?? "A router"} ${open ? "needs" : "needed"} attention`
          : `${i.router?.name ?? "A router"} ${open ? "is" : "was"} offline`;
    case "venue_package":
      return open ? `Confirm ${venue}'s package` : `${venue}'s package was agreed`;
    case "venue_setup":
      return open ? `Set up ${venue}'s router` : `${venue} was set up`;
    case "bill_due":
      return !open
        ? "HashiNet's bill was paid"
        : paused(i)
          ? "Selling is paused"
          : `HashiNet's bill is ${i.overdue ? "overdue" : "due"}`;
    case "selling_paused":
      return !open
        ? "Selling is back"
        : paused(i)
          ? "Selling is paused"
          : `Selling pauses on ${i.access?.pausesOn ? longDate(calendarDay(i.access.pausesOn)) : "its date"}`;
  }
}

/** A manager's selling-paused issue, said plainly: why, and who pays (prototype `selling-paused`). */
export function sellingText(i: IssueRecord): string {
  const business = i.business?.name ?? "The business";
  return paused(i)
    ? `${business}'s bill to HashiNet is overdue, so nobody can sell until the owner pays it. Vouchers already sold keep working.`
    : `${business}'s bill to HashiNet is overdue. Selling pauses then unless the owner pays it.`;
}

/** Its business sells nothing now: read-only or suspended (ADR-0014, 2). */
const paused = (i: IssueRecord) =>
  i.access?.state === "read_only" || i.access?.state === "suspended";

/** Where it is: the venue, and its business when that names something else. */
export function issueWhere(i: IssueRecord): string {
  const venue = i.venue?.name ?? "";
  const business = i.business && i.business.name !== venue ? i.business.name : "";
  return [venue, business].filter(Boolean).join(" · ");
}

export function issuePill(i: IssueRecord): [string, PillKind] {
  if (i.status === "resolved") return ["Resolved", "ok"];
  if (i.stalled) return ["Stalled", "bad"];
  if (i.kind === "bill_due") return i.overdue ? ["Overdue", "bad"] : ["Due", "wait"];
  if (i.kind === "selling_paused") return paused(i) ? ["Paused", "bad"] : ["Overdue", "wait"];
  return i.kind === "router_offline" ? ["Offline", "bad"] : ["Waiting", "wait"];
}

type Event = IssueDetail["events"][number];

/** One line of an issue's history, from what the API recorded. */
export function eventText(e: Event): string {
  const d = e.data ?? {};
  const to = e.to?.name ?? "someone";
  switch (e.action) {
    case "opened":
      return e.to ? `Opened, for ${to}` : "Opened";
    case "claimed":
      return "Claimed it";
    case "released":
      return d.reason === "holder_removed" ? "Released it: they left the team" : "Released it";
    case "handed":
      return `Handed it to ${to}${e.note ? `: ${e.note}` : ""}`;
    case "taken_over":
      return `Took it over: ${e.note ?? ""}`;
    case "noted":
      return e.note ?? "";
    case "resolved":
      return (
        {
          serving: "The router serves again; the issue closed",
          scheduled: "Agreed and scheduled; its setup went to the team",
          first_guest: "The first guest got online; the issue closed",
          router_removed: "The router was removed; the issue closed",
        }[String(d.reason)] ?? "Resolved"
      );
    case "step":
      return stepText(d);
  }
}

function stepText(d: Record<string, string | number | boolean | null>): string {
  const plan = PLAN[d.plan as OnboardingPlan]?.name;
  switch (d.step) {
    case "preferred":
      return plan ? `Prefers ${plan}` : "Asked to talk to the team first";
    case "confirmed":
      return `Confirmed ${plan}: ${Number(d.totalTsh) > 0 ? tsh(Number(d.totalTsh)) : "nothing to charge"}`;
    case "paid":
      return `Paid in full: ${tsh(Number(d.amountTsh))}`;
    case "scheduled":
      return `Scheduled the setup for ${setupDay(String(d.date))}`;
    case "rescheduled":
      return `Moved the setup to ${setupDay(String(d.date))}`;
    case "time_given_back": {
      const each = String(d.minutes)
        .split(",")
        .map((m) => formatDuration(Number(m)));
      const list = each.length > 1 ? `${each.slice(0, -1).join(", ")} and ${each.at(-1)}` : each[0];
      return `Gave ${d.guests} ${d.guests === 1 ? "guest" : "guests"} their time back: ${list}`;
    }
    default:
      return "A step";
  }
}

/** Who did it: a person and their role, or HashiNet itself. */
export const actorOf = (e: Event) =>
  e.actor ? `${e.actor.name}, ${ROLE_NAME[e.actor.role].toLowerCase()}` : "HashiNet";

/** "Friday 20 November", from a business day (YYYY-MM-DD). */
export const setupDay = (date: string) => dayName(calendarDay(date));

/** How far a venue is on its way to serving guests, before its router serves. */
export const STAGE: Record<Exclude<OnboardingStage, "done">, string> = {
  choose: "Choosing how its router comes",
  confirm: "Package to agree",
  pay: "Waiting for payment",
  schedule: "Setup to schedule",
  "add-router": "Router to add",
  "set-up": "Being set up",
  "first-guest": "Waiting for its first guest",
};

/** A venue's status in a list: its routers' condition once it serves, its stage until then. */
export function venueStatus(v: {
  stage: OnboardingStage;
  condition: RouterCondition;
}): [string, PillKind] {
  return v.stage === "done" ? CONDITION[v.condition] : [STAGE[v.stage], "wait"];
}
