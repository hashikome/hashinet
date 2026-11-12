import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { type Auth, BETTER_AUTH } from "../auth/create-auth.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";
import { enrichWideEvent } from "../observability/wide-event.js";
import { type Action, allows, needsProtectedSession } from "./policy.js";
import type { Principal } from "./principal.js";
import { principalFromSession } from "./principal-from-session.js";

const PUBLIC = Symbol("public");
const ACTION = Symbol("action");
const ACCOUNT = Symbol("account");

/** Reachable without signing in. Everything else needs a signed-in person with a membership. */
export const Public = () => SetMetadata(PUBLIC, true);
/** The action this route takes; the policy says which roles may (ADR-0011, 8). */
export const Can = (action: Action) => SetMetadata(ACTION, action);
/** Part of Account and security: reachable by a session that may do nothing else yet. */
export const AccountRoute = () => SetMetadata(ACCOUNT, true);

type PrincipalRequest = Request & { principal?: Principal };

const SIGN_IN_REQUIRED = apiError("SIGN_IN_REQUIRED", "Sign in to continue.");

export const CurrentPrincipal = createParamDecorator(
  (_: unknown, context: ExecutionContext): Principal => {
    const principal = context.switchToHttp().getRequest<PrincipalRequest>().principal;
    if (!principal) throw new UnauthorizedException(SIGN_IN_REQUIRED);
    return principal;
  },
);

/**
 * The global guard: default deny. A route is public only when it says so; otherwise the session
 * must belong to a person with an active membership, read on every request so a removal takes
 * effect at once. The session acts as one membership (ADR-0011, 7). A session that may only
 * protect its sign-in reaches only Account and security; a route with an action needs a role the
 * policy allows; and making something sellable needs a protected session (ADR-0011, 9).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: PrismaService,
    @Inject(BETTER_AUTH) private readonly auth: Auth,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets) === true) return true;

    const request = context.switchToHttp().getRequest<PrincipalRequest>();
    const principal = await principalFromSession(
      this.db,
      this.auth,
      fromNodeHeaders(request.headers),
    );
    if (!principal) throw new UnauthorizedException(SIGN_IN_REQUIRED);
    request.principal = principal;
    enrichWideEvent({ "membership.id": principal.membershipId, "membership.role": principal.role });

    if (this.reflector.getAllAndOverride<boolean>(ACCOUNT, targets) === true) return true;
    if (principal.access === "account") {
      throw new ForbiddenException(
        apiError(
          "PROTECTION_REQUIRED",
          "Protect your sign-in in Account and security to continue.",
        ),
      );
    }
    const action = this.reflector.getAllAndOverride<Action | undefined>(ACTION, targets);
    if (action === undefined) {
      // Default deny: a signed-in route either names its action or belongs to Account and
      // security.
      throw new ForbiddenException(apiError("FORBIDDEN", "You do not have access to this."));
    }
    if (!allows(principal.role, action)) {
      throw new ForbiddenException(apiError("FORBIDDEN", "You do not have access to this."));
    }
    if (principal.access === "setup" && needsProtectedSession(action)) {
      throw new ForbiddenException(
        apiError("PROTECTION_REQUIRED", "Protect your sign-in before you sell or serve."),
      );
    }
    return true;
  }
}
