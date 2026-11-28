import type { ServiceAccess, ServiceAccessReason } from "@hashinet/types";
import type { EmailMessage } from "../../core/email/email-sender.js";
import { type AccessByBills, sellingStopped } from "./access-rule.js";
import { longDay, tsh } from "./invoice-emails.js";

/** What each state means for the business, in its owner's words. */
const MEANS: Record<ServiceAccess, string> = {
  enabled: "Everything works as usual.",
  grace_period: "Everything works as usual for now.",
  read_only:
    "You can sign in and look, but nobody can sell new vouchers, at the counter or on the portal, and packages and prices stay as they are. Vouchers already sold keep working.",
  suspended:
    "The portal takes no new vouchers. Guests online keep their time until it ends. Sign in to see why and how to get it back.",
};

const REASON: Record<ServiceAccessReason, string> = {
  payment_overdue: "a payment is overdue",
  payment_received: "your payment was received",
  payment_arranged: "a payment was arranged",
  policy_violation: "HashiNet's terms were broken",
  customer_request: "you asked for it",
  contract_ended: "the contract ended",
  issue_resolved: "the issue was resolved",
  other: "HashiNet's team changed it",
};

/**
 * By its bills: overdue, selling paused, or back to normal; or its hold by HashiNet's team ended,
 * and it follows its bills again. Plain text, as every email here is, until the shared email
 * standard is built.
 */
export function accessByBillsEmail(
  to: string,
  business: string,
  step: { from: ServiceAccess; holdEnded: boolean; byBills: AccessByBills },
  billing: string,
): EmailMessage {
  const { byBills } = step;
  const ended = step.holdEnded
    ? [`HashiNet's hold on ${business}'s service has ended, so it follows its bills again.`, ""]
    : [];
  if (byBills.access === "enabled") {
    if (step.holdEnded) {
      return {
        to,
        subject: `${business}'s service is back to normal`,
        text: [...ended, MEANS.enabled].join("\n"),
      };
    }
    // Paid: selling comes back if it had paused; otherwise the bill is simply settled.
    return sellingStopped(step.from)
      ? {
          to,
          subject: `${business} can sell again`,
          text: [
            `HashiNet recorded your payment, so ${business} is back to normal: selling, packages and prices work as usual.`,
            "",
            `Your invoices are on Billing: ${billing}`,
          ].join("\n"),
        }
      : {
          to,
          subject: "Your bill to HashiNet is paid",
          text: [
            `Thank you: HashiNet recorded your payment, and nothing is overdue for ${business}.`,
            "",
            `Your invoices are on Billing: ${billing}`,
          ].join("\n"),
        };
  }
  const owed = `${business}'s bill of ${tsh(byBills.overdueTsh)} has been overdue since ${longDay(byBills.overdueSince)}.`;
  if (byBills.access === "read_only") {
    return {
      to,
      subject: `Selling is paused at ${business}`,
      text: [
        ...ended,
        `${owed} Selling is paused until it is paid.`,
        "",
        MEANS.read_only,
        "",
        `Pay it and selling comes back once HashiNet records your payment. Your invoices, with how to pay, are on Billing: ${billing}`,
      ].join("\n"),
    };
  }
  return {
    to,
    subject: "Your bill to HashiNet is overdue",
    text: [
      ...ended,
      owed,
      "",
      byBills.pausesOn
        ? `Pay it by ${longDay(byBills.pausesOn)} to keep selling. After that, selling pauses until it is paid; vouchers already sold keep working.`
        : "Please pay it soon. Everything works as usual for now.",
      "",
      `Your invoices, with how to pay, are on Billing: ${billing}`,
    ].join("\n"),
  };
}

/** Set by hand by HashiNet's team: the state, why in plain words, and their message, never the note. */
export function accessByHandEmail(
  to: string,
  business: string,
  change: {
    access: ServiceAccess;
    heldUntil: string | null;
    reason: ServiceAccessReason;
    message: string | null;
  },
): EmailMessage {
  const name: Record<ServiceAccess, string> = {
    enabled: "back to normal",
    grace_period: "in a grace period",
    read_only: "read-only",
    suspended: "suspended",
  };
  const until = change.heldUntil ? ` until ${longDay(change.heldUntil)}` : "";
  return {
    to,
    subject: `${business}'s service is ${name[change.access]}`,
    text: [
      `HashiNet's team set ${business}'s service to ${name[change.access]}${until}, as ${REASON[change.reason]}.`,
      "",
      MEANS[change.access],
      ...(change.message ? ["", change.message] : []),
    ].join("\n"),
  };
}
