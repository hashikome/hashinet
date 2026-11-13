import type {
  IssueDetail,
  IssueKind,
  IssueRecord,
  OnboardingLineKind,
  OnboardingPaidBy,
  OnboardingPlan,
} from "@hashinet/types";
import type { PillKind } from "@/components/hearth/ui";
import { dayName } from "./dates";
import { tsh } from "./money";
import { ROLE_NAME } from "./nav";

/** How each kind reads in a list's Kind column and filter. */
export const KIND_NAME: Record<IssueKind, string> = {
  router_offline: "Router",
  venue_package: "Package",
  venue_setup: "Setting up",
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

export const PAID_BY: Record<OnboardingPaidBy, string> = {
  cash: "Cash",
  mobile_money: "Mobile money",
  bank_transfer: "Bank transfer",
};

/** An issue's title, open or resolved. */
export function issueTitle(i: IssueRecord): string {
  const open = i.status === "open";
  const venue = i.venue?.name ?? "A venue";
  switch (i.kind) {
    case "router_offline":
      return `${i.router?.name ?? "A router"} ${open ? "is" : "was"} offline`;
    case "venue_package":
      return open ? `Confirm ${venue}'s package` : `${venue}'s package was agreed`;
    case "venue_setup":
      return open ? `Set up ${venue}'s router` : `${venue} was set up`;
  }
}

/** Where it is: the venue, and its business when that names something else. */
export function issueWhere(i: IssueRecord): string {
  const venue = i.venue?.name ?? "";
  const business = i.business && i.business.name !== venue ? i.business.name : "";
  return [venue, business].filter(Boolean).join(" · ");
}

export function issuePill(i: IssueRecord): [string, PillKind] {
  if (i.status === "resolved") return ["Resolved", "ok"];
  if (i.stalled) return ["Stalled", "bad"];
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
      return "Released it";
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
      return `Recorded ${tsh(Number(d.amountTsh))} paid by ${PAID_BY[d.by as OnboardingPaidBy]?.toLowerCase() ?? "hand"}`;
    case "scheduled":
      return `Scheduled the setup for ${dayName(`${d.date}T12:00:00+03:00`)}`;
    case "rescheduled":
      return `Moved the setup to ${dayName(`${d.date}T12:00:00+03:00`)}`;
    default:
      return "A step";
  }
}

/** Who did it: a person and their role, or HashiNet itself. */
export const actorOf = (e: Event) =>
  e.actor ? `${e.actor.name}, ${ROLE_NAME[e.actor.role].toLowerCase()}` : "HashiNet";

/** "Friday 20 November", from a business day (YYYY-MM-DD). */
export const setupDay = (date: string) => dayName(`${date}T12:00:00+03:00`);
