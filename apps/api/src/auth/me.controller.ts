import { type Me, type MembershipSummary, THEME_PREFERENCES } from "@hashinet/types";
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Put,
} from "@nestjs/common";
import { z } from "zod";
import { AccountRoute, CurrentPrincipal } from "../access/access.guard.js";
import { capabilitiesOf } from "../access/policy.js";
import { mustProtect, type Principal, SETUP_DAYS } from "../access/principal.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";
import { parseInput } from "../http/validation.js";
import { PROOF_HOURS, provedRecently } from "./create-auth.js";

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
   * new one at once with `POST /api/auth/two-factor/enable`. It needs proof from the last 2 hours.
   * Left half done, the session simply asks for protection again: never a way around it.
   */
  @Post("authenticator/replace")
  @HttpCode(200)
  @AccountRoute()
  async replaceAuthenticator(@CurrentPrincipal() principal: Principal): Promise<Me> {
    if (!(await provedRecently(this.db, principal.sessionId))) {
      throw new ForbiddenException(
        apiError(
          "PROOF_REQUIRED",
          "Confirm it's you with your passkey, authenticator app or a recovery code.",
        ),
      );
    }
    await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: principal.userId } });
      if (user.twoFactorEnabled !== true) {
        throw new NotFoundException(
          apiError("NOT_FOUND", "There is no authenticator app to replace."),
        );
      }
      await tx.twoFactor.deleteMany({ where: { userId: principal.userId } });
      await tx.user.update({ where: { id: principal.userId }, data: { twoFactorEnabled: false } });
      await this.audit.record(
        principal,
        {
          action: "authenticator.replace",
          category: "auth",
          target: { type: "user", id: principal.userId },
        },
        tx,
      );
    });
    return this.answer(principal);
  }

  private async answer(principal: Principal): Promise<Me> {
    const [memberships, user, passkeys, preference, session] = await Promise.all([
      this.db.membership.findMany({
        where: { userId: principal.userId, status: "active" },
        include: { business: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.db.user.findUniqueOrThrow({ where: { id: principal.userId } }),
      this.db.passkey.count({ where: { userId: principal.userId } }),
      this.db.userPreference.findUnique({ where: { userId: principal.userId } }),
      this.db.session.findUnique({
        where: { id: principal.sessionId },
        select: { provedAt: true },
      }),
    ]);
    const provedUntil = session?.provedAt
      ? new Date(session.provedAt.getTime() + PROOF_HOURS * 3_600_000)
      : null;
    const summaries: MembershipSummary[] = memberships.map((m) => ({
      id: m.id,
      scope: m.scope,
      role: m.role,
      business: m.business,
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
        capabilities: principal.access === "account" ? [] : capabilitiesOf(principal.role),
      },
      protection: {
        required: mustProtect(principal.role),
        authenticator: user.twoFactorEnabled === true,
        passkeys,
        setupEndsAt:
          principal.access === "setup"
            ? new Date(started.getTime() + SETUP_DAYS * 86_400_000).toISOString()
            : null,
        provedUntil:
          provedUntil && provedUntil.getTime() > Date.now() ? provedUntil.toISOString() : null,
      },
    };
  }
}
