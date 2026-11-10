import type { EmailMessage } from "../email/email-sender.js";

/**
 * The account emails the Team page sends, plain text. Each tells the person what changed and
 * who to ask; none carries a link that signs anyone in.
 */
export function teamEmail(
  kind:
    | "welcome"
    | "suspended"
    | "reactivated"
    | "role_changed"
    | "removed"
    | "authenticator_reset"
    | "email_changed",
  to: string,
  context: { name: string; role: "admin" | "manager"; signInUrl: string; newEmail: string | null },
): EmailMessage {
  const hello = `Hello ${context.name},`;
  const ask = "If this is unexpected, contact a HashiNet admin.";
  const signIn = `Sign in at ${context.signInUrl} with this email address; a code is sent each time.`;
  const role = context.role === "admin" ? "an admin" : "a venue manager";
  const bodies: Record<typeof kind, { subject: string; lines: string[] }> = {
    welcome: {
      subject: "You have been added to HashiNet",
      lines: [
        `You have been added to HashiNet as ${role}.`,
        signIn,
        ...(context.role === "admin"
          ? ["As an admin you will set up an authenticator app at your first sign-in."]
          : []),
      ],
    },
    suspended: {
      subject: "Your HashiNet account is suspended",
      lines: ["Your HashiNet account has been suspended and you have been signed out.", ask],
    },
    reactivated: {
      subject: "Your HashiNet account is active again",
      lines: ["Your HashiNet account has been reactivated.", signIn],
    },
    role_changed: {
      subject: "Your HashiNet role has changed",
      lines: [
        `You are now ${role} in HashiNet.`,
        ...(context.role === "admin"
          ? ["Set up an authenticator app at your next sign-in; admins must use one."]
          : []),
        ask,
      ],
    },
    removed: {
      subject: "You have been removed from HashiNet",
      lines: ["Your HashiNet account has been removed and you can no longer sign in.", ask],
    },
    authenticator_reset: {
      subject: "Your HashiNet authenticator app was reset",
      lines: [
        "An admin reset your authenticator app and signed you out everywhere.",
        "Set up an authenticator app again at your next sign-in.",
        ask,
      ],
    },
    email_changed: {
      subject: "Your HashiNet sign-in email has changed",
      lines: [
        `Your HashiNet sign-in email is now ${context.newEmail ?? "a new address"}; this address no longer signs in.`,
        ask,
      ],
    },
  };
  const { subject, lines } = bodies[kind];
  return { to, subject, text: [hello, "", ...lines].join("\n") };
}
