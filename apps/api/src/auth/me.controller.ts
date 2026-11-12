import type { Me, MembershipSummary } from "@hashinet/types";
import { Body, Controller, Get, NotFoundException, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { AccountRoute, CurrentPrincipal } from "../access/access.guard.js";
import { capabilitiesOf } from "../access/policy.js";
import { mustProtect, type Principal } from "../access/principal.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";
import { parseInput } from "../http/validation.js";

const profileInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "is required")
    .max(160)
    .regex(/^[^\p{Cc}]*$/u, "must be one line of text"),
});

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

  /** Everyone may change their own name. */
  @Put()
  @AccountRoute()
  async update(@CurrentPrincipal() principal: Principal, @Body() body: unknown): Promise<Me> {
    const { name } = parseInput(profileInput, body);
    await this.db.user.update({ where: { id: principal.userId }, data: { name } });
    return this.answer({ ...principal, name });
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

  private async answer(principal: Principal): Promise<Me> {
    const [memberships, user, passkeys] = await Promise.all([
      this.db.membership.findMany({
        where: { userId: principal.userId, status: "active" },
        include: { business: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.db.user.findUniqueOrThrow({ where: { id: principal.userId } }),
      this.db.passkey.count({ where: { userId: principal.userId } }),
    ]);
    const summaries: MembershipSummary[] = memberships.map((m) => ({
      id: m.id,
      scope: m.scope,
      role: m.role,
      business: m.business,
    }));
    const active = summaries.find((m) => m.id === principal.membershipId);
    if (!active) throw new NotFoundException(apiError("NOT_FOUND", "No active workspace."));
    return {
      id: principal.userId,
      email: principal.email,
      name: principal.name,
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
      },
    };
  }
}
