import type { InvitationRecord, MembershipRole, TeamList } from "@hashinet/types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../access/principal.js";
import { assignableRoles, outranks } from "../access/rank.js";
import { AuditLog } from "../audit/audit-log.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { EMAIL_SENDER, type EmailSender } from "../email/email-sender.js";
import { apiError } from "../http/error-envelope.js";
import { memberInvitationEmail } from "../invitations/invitation-emails.js";
import { INVITATION_HOURS, newInvitationToken } from "../invitations/invitation-token.js";
import { invitationRecordOf, pending } from "../invitations/invitations.service.js";
import { captureFailure } from "../observability/telemetry.js";

export const inviteMemberInput = z.object({
  email: z.string().trim().toLowerCase().max(255).pipe(z.email("must be an email address")),
  role: z.enum(["manager", "operator"]),
});

export const changeRoleInput = z.object({ role: z.enum(["manager", "operator"]) });

const notFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "No such person or invitation."));
const outranked = () =>
  new ForbiddenException(
    apiError("FORBIDDEN", "You can only invite, change or remove roles below your own."),
  );

/**
 * HashiNet's team: its people and the invitations not yet accepted. Who may give, change or take
 * away a role is by rank: nobody gives more than they have, and nobody acts on someone at or above
 * their own rank (ADR-0011, 3 and 6). A business's team comes with its own slice.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  async list(staff: Principal): Promise<TeamList> {
    const [members, invitations] = await Promise.all([
      this.db.membership.findMany({
        where: { scope: "platform", status: "active" },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.pendingInvitations(),
    ]);
    return {
      members: members.map((m) => ({
        membershipId: m.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        joinedAt: m.createdAt.toISOString(),
        lastUsedAt: m.lastUsedAt?.toISOString() ?? null,
        manageable: m.id !== staff.membershipId && outranks(staff.role, m.role),
      })),
      invitations,
      assignable: assignableRoles(staff.role),
    };
  }

  /** Invites someone to a role below the inviter's. A pending invitation to the same email is replaced. */
  async invite(
    staff: Principal,
    input: z.infer<typeof inviteMemberInput>,
  ): Promise<InvitationRecord> {
    if (!assignableRoles(staff.role).includes(input.role)) throw outranked();
    const already = await this.db.membership.findFirst({
      where: { scope: "platform", status: "active", user: { email: input.email } },
    });
    if (already) {
      throw new ConflictException(
        apiError("CONFLICT", "This person is already on HashiNet's team."),
      );
    }
    const { token, digest } = newInvitationToken();
    const id = await this.db.$transaction(async (tx) => {
      await tx.invitation.updateMany({
        where: { ...pending(), email: input.email, scope: "platform" },
        data: { revokedAt: new Date() },
      });
      const created = await tx.invitation.create({
        data: {
          email: input.email,
          scope: "platform",
          role: input.role,
          tokenDigest: digest,
          invitedById: staff.membershipId,
          expiresAt: new Date(Date.now() + INVITATION_HOURS * 3600_000),
        },
      });
      await this.audit.record(
        staff,
        {
          action: "invitation.issue",
          target: { type: "invitation", id: created.id },
          change: { before: {}, after: { role: input.role } },
        },
        tx,
      );
      return created.id;
    });
    this.send(input.email, input.role, token);
    return this.pendingInvitation(id);
  }

  /** Sends a pending invitation again, with a new link; the old link stops working. */
  async resend(staff: Principal, id: string): Promise<InvitationRecord> {
    const current = await this.ownInvitation(staff, id);
    const { token, digest } = newInvitationToken();
    await this.db.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id },
        data: {
          tokenDigest: digest,
          expiresAt: new Date(Date.now() + INVITATION_HOURS * 3600_000),
        },
      });
      await this.audit.record(
        staff,
        { action: "invitation.resend", target: { type: "invitation", id } },
        tx,
      );
    });
    this.send(current.email, current.role, token);
    return this.pendingInvitation(id);
  }

  async revoke(staff: Principal, id: string): Promise<void> {
    await this.ownInvitation(staff, id);
    await this.db.$transaction(async (tx) => {
      await tx.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.record(
        staff,
        { action: "invitation.revoke", target: { type: "invitation", id } },
        tx,
      );
    });
  }

  /** Gives someone below the reader another role below the reader's. */
  async changeRole(staff: Principal, membershipId: string, role: MembershipRole) {
    const member = await this.manageable(staff, membershipId);
    if (!assignableRoles(staff.role).includes(role)) throw outranked();
    if (member.role === role) return;
    await this.db.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: member.id }, data: { role } });
      await this.audit.record(
        staff,
        {
          action: "membership.role",
          target: { type: "membership", id: member.id },
          change: { before: { role: member.role }, after: { role } },
        },
        tx,
      );
    });
  }

  /** Takes someone below the reader off the team: their sessions end, and their history stays. */
  async remove(staff: Principal, membershipId: string): Promise<void> {
    const member = await this.manageable(staff, membershipId);
    await this.db.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: member.id }, data: { status: "removed" } });
      await tx.session.deleteMany({ where: { activeMembershipId: member.id } });
      await this.audit.record(
        staff,
        {
          action: "membership.remove",
          target: { type: "membership", id: member.id },
          change: { before: { role: member.role }, after: { role: null } },
        },
        tx,
      );
    });
  }

  private async manageable(staff: Principal, membershipId: string) {
    const member = await this.db.membership.findFirst({
      where: { id: membershipId, scope: "platform", status: "active" },
    });
    if (!member) throw notFound();
    if (member.id === staff.membershipId) {
      throw new BadRequestException(
        apiError("BAD_REQUEST", "You can't change or remove yourself."),
      );
    }
    if (!outranks(staff.role, member.role)) throw outranked();
    return member;
  }

  /** A pending platform invitation for a role below the reader's. */
  private async ownInvitation(staff: Principal, id: string) {
    const row = await this.db.invitation.findFirst({
      where: { id, scope: "platform", ...pending() },
    });
    if (!row) throw notFound();
    if (!outranks(staff.role, row.role)) throw outranked();
    return row;
  }

  private async pendingInvitations(): Promise<InvitationRecord[]> {
    const rows = await this.db.invitation.findMany({
      where: { ...pending(), scope: "platform" },
      include: { invitedBy: { include: { user: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(invitationRecordOf);
  }

  private async pendingInvitation(id: string): Promise<InvitationRecord> {
    const found = (await this.pendingInvitations()).find((r) => r.id === id);
    if (!found) throw notFound();
    return found;
  }

  /** Sends the email without waiting on it; a failure is recorded, and Resend sends a new link. */
  private send(email: string, role: string, token: string): void {
    const link = `${this.config.frontendOrigin}/invite#token=${token}`;
    void this.email.send(memberInvitationEmail(email, role, link)).catch(captureFailure);
  }
}
