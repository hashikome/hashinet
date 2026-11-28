import {
  type Me,
  type MembershipSummary,
  type MyPasskey,
  type ProofAction,
  THEME_PREFERENCES,
} from "@hashinet/types";
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Put,
} from "@nestjs/common";
import { z } from "zod";
import { AccountRoute, CurrentPrincipal } from "../../core/access/access.guard.js";
import { capabilitiesOf, needsProtectedSession } from "../../core/access/policy.js";
import { mustProtect, type Principal, SETUP_DAYS } from "../../core/access/principal.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { apiError } from "../../core/http/error-envelope.js";
import { parseInput } from "../../core/http/validation.js";
import { logoUrl } from "../../guest/brand/logos.js";
import {
  PROOF_ACTIONS,
  proofHoldsUntil,
  proofOf,
  proofRequired,
  proofRule,
  provedFor,
} from "./proof.js";

const profileInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "is required")
      .max(160)
      .regex(/^[^\p{Cc}]*$/u, "must be one line of text")
      .optional(),
    theme: z.enum(THEME_PREFERENCES).optional(),
  })
  .refine((v) => v.name !== undefined || v.theme !== undefined, "name or theme is required");

const switchInput = z.object({ membershipId: z.uuid() });

/** The signed-in person: Account and security, reachable by every session (ADR-0011, 9). */
@Controller("api/me")
export class MeController {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  /** Who is signed in, their workspaces, and what the active one allows. */
  @Get()
  @AccountRoute()
  me(@CurrentPrincipal() principal: Principal): Promise<Me> {
    return this.answer(principal);
  }

  /** Everyone may change their own name and theme. */
  @Put()
  @AccountRoute()
  async update(@CurrentPrincipal() principal: Principal, @Body() body: unknown): Promise<Me> {
    const { name, theme } = parseInput(profileInput, body);
    if (name !== undefined) {
      await this.db.user.update({ where: { id: principal.userId }, data: { name } });
    }
    if (theme !== undefined) {
      await this.db.userPreference.upsert({
        where: { userId: principal.userId },
        create: { userId: principal.userId, theme },
        update: { theme },
      });
    }
    return this.answer({ ...principal, name: name ?? principal.name });
  }

  /** The person's passkeys, newest last, with when each was last used. */
  @Get("passkeys")
  @AccountRoute()
  async passkeys(@CurrentPrincipal() principal: Principal): Promise<MyPasskey[]> {
    const rows = await this.db.passkey.findMany({
      where: { userId: principal.userId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      credentialId: p.credentialID,
      createdAt: p.createdAt?.toISOString() ?? null,
      lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Switches the workspace this session acts as, to another of the person's own active
   * memberships; audited (ADR-0011, 7). Anything else answers not found.
   */
  @Post("membership")
  @AccountRoute()
  async switchMembership(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ): Promise<{ membershipId: string }> {
    const { membershipId } = parseInput(switchInput, body);
    const target = await this.db.membership.findFirst({
      where: { id: membershipId, userId: principal.userId, status: "active" },
    });
    if (!target) throw new NotFoundException(apiError("NOT_FOUND", "No such workspace."));
    await this.db.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: principal.sessionId },
        data: { activeMembershipId: target.id },
      });
      await tx.membership.update({ where: { id: target.id }, data: { lastUsedAt: new Date() } });
      await this.audit.record(
        principal,
        {
          action: "membership.switch",
          target: { type: "membership", id: target.id },
          businessId: target.businessId,
          venueId: null,
          change: {
            before: { membership: principal.membershipId },
            after: { membership: target.id },
          },
        },
        tx,
      );
    });
    return { membershipId: target.id };
  }

  /**
   * Starts replacing the authenticator app: the old one stops working, and the person sets up the
   * new one at once with `POST /api/auth/two-factor/enable`. It needs a code from the old app or a
   * recovery code, given just now. Left half done, the session simply asks for protection again:
   * never a way around it.
   */
  @Post("authenticator/replace")
  @HttpCode(200)
  @AccountRoute()
  async replaceAuthenticator(@CurrentPrincipal() principal: Principal): Promise<Me> {
    await this.mustProve(principal, "replaceAuthenticator");
    await this.dropAuthenticator(principal, "authenticator.replace", "replace");
    return this.answer(principal);
  }

  /**
   * Removes the authenticator app for someone who has neither it nor a recovery code, confirmed
   * with the passkey that stays and goes on protecting their sign-in. Its recovery codes go with it.
   */
  @Post("authenticator/remove")
  @HttpCode(200)
  @AccountRoute()
  async removeAuthenticator(@CurrentPrincipal() principal: Principal): Promise<Me> {
    await this.mustProve(principal, "removeAuthenticator");
    if ((await this.db.passkey.count({ where: { userId: principal.userId } })) === 0) {
      throw new ConflictException(
        apiError("PASSKEY_REQUIRED", "Only a passkey that stays can confirm removing the app."),
      );
    }
    await this.dropAuthenticator(principal, "authenticator.remove", "remove");
    return this.answer(principal);
  }

  private async mustProve(principal: Principal, action: ProofAction): Promise<void> {
    if (!(await provedFor(this.db, principal.sessionId, action))) {
      const { code, message } = proofRequired(action);
      throw new ForbiddenException(apiError(code, message));
    }
  }

  /** The app's secret and recovery codes go; signing in no longer asks for its code. */
  private async dropAuthenticator(
    principal: Principal,
    action: "authenticator.replace" | "authenticator.remove",
    verb: string,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: principal.userId } });
      if (user.twoFactorEnabled !== true) {
        throw new NotFoundException(
          apiError("NOT_FOUND", `There is no authenticator app to ${verb}.`),
        );
      }
      await tx.twoFactor.deleteMany({ where: { userId: principal.userId } });
      await tx.user.update({ where: { id: principal.userId }, data: { twoFactorEnabled: false } });
      await this.audit.record(
        principal,
        {
          action,
          businessId: principal.businessId,
          venueId: null,
          category: "auth",
          target: { type: "user", id: principal.userId },
        },
        tx,
      );
    });
  }

  private async answer(principal: Principal): Promise<Me> {
    const [memberships, user, passkeys, preference, session] = await Promise.all([
      this.db.membership.findMany({
        where: { userId: principal.userId, status: "active" },
        include: { business: { select: { id: true, name: true, logoKey: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.db.user.findUniqueOrThrow({ where: { id: principal.userId } }),
      this.db.passkey.count({ where: { userId: principal.userId } }),
      this.db.userPreference.findUnique({ where: { userId: principal.userId } }),
      proofOf(this.db, principal.sessionId),
    ]);
    const provedUntil = proofHoldsUntil(session?.provedAt);
    const isProtected = user.twoFactorEnabled === true || passkeys > 0;
    const summaries: MembershipSummary[] = memberships.map((m) => ({
      id: m.id,
      scope: m.scope,
      role: m.role,
      business: m.business && {
        id: m.business.id,
        name: m.business.name,
        logoUrl: logoUrl(m.business.logoKey),
      },
    }));
    const active = summaries.find((m) => m.id === principal.membershipId);
    const started = memberships.find((m) => m.id === principal.membershipId)?.createdAt;
    if (!active || !started) {
      throw new NotFoundException(apiError("NOT_FOUND", "No active workspace."));
    }
    return {
      id: principal.userId,
      email: principal.email,
      name: principal.name,
      theme: preference?.theme ?? "system",
      memberships: summaries,
      active: {
        ...active,
        venueIds: principal.venueIds,
        access: principal.access,
        // What this session may do now: nothing beyond Account and security until it may act,
        // and nothing sellable while it gets set up without protection (ADR-0011, 9).
        capabilities:
          principal.access === "account"
            ? []
            : capabilitiesOf(principal.role).filter(
                (action) => principal.access === "full" || !needsProtectedSession(action),
              ),
        // While its business can't sell, its selling and package actions stay, paused, saying why.
        pause: principal.pause,
      },
      protection: {
        required: mustProtect(principal.role),
        authenticator: user.twoFactorEnabled === true,
        passkeys,
        setupEndsAt:
          principal.access === "setup"
            ? new Date(started.getTime() + SETUP_DAYS * 86_400_000).toISOString()
            : null,
        provedUntil: provedUntil?.toISOString() ?? null,
        // What asks for proof first, and with what (`proof.ts`): changing protection always does;
        // adding to it does only for someone already protected.
        proof: Object.fromEntries(
          PROOF_ACTIONS.map((action) => [
            action,
            proofRule(action, session, action !== "add" || isProtected),
          ]),
        ) as Me["protection"]["proof"],
      },
    };
  }
}
