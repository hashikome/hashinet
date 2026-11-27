import { createHash, timingSafeEqual } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { apiError } from "../http/error-envelope.js";

const digest = (text: string) => createHash("sha256").update(text).digest();

/**
 * The tunnel service's own secret, on the internal routes only it calls (its peers, the RADIUS it
 * relays): anything else, or no secret configured, is refused.
 */
export function requireTunnelSecret(
  secret: string | null,
  authorization: string | undefined,
): void {
  if (
    secret === null ||
    !timingSafeEqual(digest(authorization ?? ""), digest(`Bearer ${secret}`))
  ) {
    throw new UnauthorizedException(apiError("UNAUTHORIZED", "Refused."));
  }
}
