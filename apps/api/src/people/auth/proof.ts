import { PROOF_HOURS, type ProofAction, type ProofFactor, type ProofRule } from "@hashinet/types";
import type { PrismaClient } from "../../core/database/client.js";

const ANY: ProofFactor[] = ["passkey", "authenticator", "recovery_code"];

/**
 * What each change to protection accepts as proof, and for how long a proof counts (ADR-0011, 9).
 * Replacing the authenticator takes the old app's code or a recovery code: a passkey alone could
 * swap the app for one an intruder holds. New recovery codes take a passkey or the app, never a
 * recovery code: someone making new ones has lost or used up the old. Removing the authenticator
 * takes the passkey that stays. Both of those last only minutes, so they are asked for each time.
 */
const RULES: Record<ProofAction, { accepts: ProofFactor[]; holdsMinutes: number }> = {
  add: { accepts: ANY, holdsMinutes: PROOF_HOURS * 60 },
  removePasskey: { accepts: ANY, holdsMinutes: PROOF_HOURS * 60 },
  newRecoveryCodes: { accepts: ["passkey", "authenticator"], holdsMinutes: PROOF_HOURS * 60 },
  replaceAuthenticator: { accepts: ["authenticator", "recovery_code"], holdsMinutes: 5 },
  removeAuthenticator: { accepts: ["passkey"], holdsMinutes: 5 },
};

export const PROOF_ACTIONS = Object.keys(RULES) as ProofAction[];

/** A session's last proof: when, and with which factor. */
export interface Proof {
  provedAt: Date | null;
  provedWith: string | null;
}

/** Whether the session's proof counts for this change now. */
function proofFits(action: ProofAction, proof: Proof | null): boolean {
  if (!proof?.provedAt || !proof.provedWith) return false;
  const rule = RULES[action];
  return (
    rule.accepts.some((f) => f === proof.provedWith) &&
    proof.provedAt.getTime() + rule.holdsMinutes * 60_000 > Date.now()
  );
}

/** The rule as the web shows it: whether to ask now, and which factors to offer. */
export function proofRule(action: ProofAction, proof: Proof | null, asks = true): ProofRule {
  const rule = RULES[action];
  return {
    needed: asks && !proofFits(action, proof),
    accepts: rule.accepts,
    holdsMinutes: rule.holdsMinutes,
  };
}

/** The session's last proof, read fresh. */
export async function proofOf(
  db: Pick<PrismaClient, "session">,
  sessionId: string,
): Promise<Proof | null> {
  return db.session.findUnique({
    where: { id: sessionId },
    select: { provedAt: true, provedWith: true },
  });
}

/** Whether the session has proof this change accepts. */
export async function provedFor(
  db: Pick<PrismaClient, "session">,
  sessionId: string,
  action: ProofAction,
): Promise<boolean> {
  return proofFits(action, await proofOf(db, sessionId));
}

const ASKS: Record<ProofAction, string> = {
  add: "Confirm it's you with your passkey, authenticator app or a recovery code.",
  removePasskey: "Confirm it's you with your passkey, authenticator app or a recovery code.",
  newRecoveryCodes: "Confirm it's you with your passkey or authenticator app.",
  replaceAuthenticator:
    "Confirm it's you with a code from your current authenticator app or a recovery code.",
  removeAuthenticator: "Confirm it's you with your passkey.",
};

/** The refusal when a change needs proof the session doesn't have (one code, a message per change). */
export const proofRequired = (action: ProofAction) => ({
  code: "PROOF_REQUIRED",
  message: ASKS[action],
});

/** Until when a proof made at `provedAt` holds for the 2-hour changes; null once it has run out. */
export function proofHoldsUntil(provedAt: Date | null | undefined): Date | null {
  if (!provedAt) return null;
  const until = new Date(provedAt.getTime() + PROOF_HOURS * 3_600_000);
  return until.getTime() > Date.now() ? until : null;
}
