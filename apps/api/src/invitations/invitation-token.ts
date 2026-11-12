import { createHash, randomBytes } from "node:crypto";

/** How long an invitation can be accepted (business-scopes M3). */
export const INVITATION_HOURS = 72;

/**
 * A single-use invitation token: 256 random bits, sent only in the link's fragment so it never
 * reaches a server log, and stored only as its digest, so a copy of the database accepts nothing.
 */
export function newInvitationToken(): { token: string; digest: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, digest: digestOf(token) };
}

export function digestOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
