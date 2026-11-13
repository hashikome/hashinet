import type { EmailMessage } from "../email/email-sender.js";
import { INVITATION_HOURS } from "./invitation-token.js";

/** The invitation to start a business on HashiNet. The link's fragment carries the token. */
export function businessInvitationEmail(to: string, link: string): EmailMessage {
  return {
    to,
    subject: "Start your business on HashiNet",
    text: [
      "HashiNet's team has invited you to set up your business on HashiNet, to sell WiFi to your guests.",
      "",
      `Open this link to name your business and its first venue: ${link}`,
      "",
      `It works once, for ${INVITATION_HOURS} hours. If you were not expecting it, ignore this email: nothing is set up until you open the link.`,
    ].join("\n"),
  };
}

const ROLE_WORDS: Record<string, string> = { manager: "a manager", operator: "an operator" };

/** The invitation to join HashiNet's team in `role`. The link's fragment carries the token. */
export function memberInvitationEmail(to: string, role: string, link: string): EmailMessage {
  return {
    to,
    subject: "Join HashiNet's team",
    text: [
      `You have been invited to join HashiNet's team as ${ROLE_WORDS[role] ?? role}.`,
      "",
      `Open this link to give your name, then sign in with a code: ${link}`,
      "",
      `It works once, for ${INVITATION_HOURS} hours. If you were not expecting it, ignore this email.`,
    ].join("\n"),
  };
}
