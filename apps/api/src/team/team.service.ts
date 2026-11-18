import {
  INVITED_ROLES,
  type InvitationRecord,
  type MembershipRole,
  type TeamList,
  VENUE_ROLES,
} from "@hashinet/types";
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
import { IssuesService } from "../issues/issues.service.js";
import { captureFailure } from "../observability/telemetry.js";

const venueIds = z.array(z.uuid()).max(50).default([]);

export const inviteMemberInput = z.object({
  email: z.string().trim().toLowerCase().max(255).pipe(z.email("must be an email address")),
  role: z.enum(INVITED_ROLES),
  venueIds,
});

export const changeRoleInput = z.object({ role: z.enum(INVITED_ROLES), venueIds });

const notFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "No such person or invitation."));
const outranked = () =>
  new ForbiddenException(
    apiError("FORBIDDEN", "You can only invite, change or remove roles below your own."),
  );
const outOfReach = () =>
  new ForbiddenException(apiError("FORBIDDEN", "You can only give the venues you manage."));
const badVenues = (message: string) =>
  new BadRequestException(
    apiError("VALIDATION_FAILED", "Check the highlighted fields.", { venueIds: message }),
  );

const isVenueRole = (role: MembershipRole) => (VENUE_ROLES as readonly string[]).includes(role);

/**
 * A workspace's team: its people and the invitations not yet accepted, for HashiNet's team or one
 * business's. Who may give, change or take away a role is by rank: nobody gives more than they
 * have, and nobody acts on someone at or above their own rank (ADR-0011, 3 and 6). A venue manager
 * reaches only the people and venues of their own venues.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly issues: IssuesService,
  ) {}

  async list(staff: Principal): Promise<TeamList> {
    const [members, invitations] = await Promise.all([
      this.db.membership.findMany({
        where: {
          ...workspace(staff),
          status: "active",
          // A venue manager sees themselves and the people at their venues.
          ...(staff.venueIds === null
            ? {}
            : {
                OR: [
                  { id: staff.membershipId },
                  { venues: { some: { venueId: { in: staff.venueIds } } } },
                ],
              }),
        },
        include: {
          user: { select: { name: true, email: true } },
          venues: { select: { venueId: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      this.pendingInvitations(staff),
    ]);
    return {
      members: members.map((m) => {
        const venues = m.venues.map((v) => v.venueId);
        return {
          membershipId: m.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          venueIds: venues,
          joinedAt: m.createdAt.toISOString(),
          lastUsedAt: m.lastUsedAt?.toISOString() ?? null,
          manageable:
            m.id !== staff.membershipId && outranks(staff.role, m.role) && reaches(staff, venues),
        };
      }),
      invitations,
      assignable: assignableRoles(staff.role),
    };
  }

  /**
   * Invites someone to a role below the inviter's. A pending invitation to the same email is
   * replaced, when it is one the inviter could revoke.
   */
  async invite(
    staff: Principal,
    input: z.infer<typeof inviteMemberInput>,
  ): Promise<InvitationRecord> {
    if (!assignableRoles(staff.role).includes(input.role)) throw outranked();
    const venues = await this.venuesFor(staff, input.role, input.venueIds);
    const already = await this.db.membership.findFirst({
      where: { ...workspace(staff), status: "active", user: { email: input.email } },
    });
    if (already) {
      throw new ConflictException(apiError("CONFLICT", "This person is already on this team."));
    }
    // A new invitation replaces a pending one only where the inviter could revoke that one.
    const earlier = await this.db.invitation.findMany({
      where: { ...pending(), email: input.email, ...workspace(staff) },
      select: { role: true, venueIds: true },
    });
    if (earlier.some((i) => !outranks(staff.role, i.role) || !reaches(staff, i.venueIds))) {
      throw new ConflictException(
        apiError("CONFLICT", "Someone above you has already invited this person."),
      );
    }
    const { token, digest } = newInvitationToken();
    const id = await this.db.$transaction(async (tx) => {
      await tx.invitation.updateMany({
        where: { ...pending(), email: input.email, ...workspace(staff) },
        data: { revokedAt: new Date() },
      });
      const created = await tx.invitation.create({
        data: {
          email: input.email,
          ...workspace(staff),
          role: input.role,
          venueIds: venues,
          tokenDigest: digest,
          invitedById: staff.membershipId,
          expiresAt: new Date(Date.now() + INVITATION_HOURS * 3600_000),
        },
      });
      await this.audit.record(
        staff,
        {
          action: "invitation.issue",
          businessId: staff.businessId,
          venueId: venues.length === 1 ? (venues[0] ?? null) : null,
          target: { type: "invitation", id: created.id },
          change: { before: {}, after: { role: input.role, venues: venues.length } },
        },
        tx,
      );
      return created.id;
    });
    await this.send(staff, input.email, input.role, token);
    return this.pendingInvitation(staff, id);
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
        {
          action: "invitation.resend",
          businessId: staff.businessId,
          venueId: null,
          target: { type: "invitation", id },
        },
        tx,
      );
    });
    await this.send(staff, current.email, current.role, token);
    return this.pendingInvitation(staff, id);
  }

  async revoke(staff: Principal, id: string): Promise<void> {
    await this.ownInvitation(staff, id);
    await this.db.$transaction(async (tx) => {
      await tx.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.record(
        staff,
        {
          action: "invitation.revoke",
          businessId: staff.businessId,
          venueId: null,
          target: { type: "invitation", id },
        },
        tx,
      );
    });
  }

  /** Gives someone below the reader another role below the reader's, with its venues. */
  async changeRole(staff: Principal, membershipId: string, input: z.infer<typeof changeRoleInput>) {
    const member = await this.manageable(staff, membershipId);
    if (!assignableRoles(staff.role).includes(input.role)) throw outranked();
    const venues = await this.venuesFor(staff, input.role, input.venueIds);
    const sameVenues =
      venues.length === member.venueIds.length && venues.every((v) => member.venueIds.includes(v));
    if (member.role === input.role && sameVenues) return;
    await this.db.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: member.id }, data: { role: input.role } });
      await tx.membershipVenue.deleteMany({ where: { membershipId: member.id } });
      await tx.membershipVenue.createMany({
        data: venues.map((venueId) => ({ membershipId: member.id, venueId })),
      });
      await this.audit.record(
        staff,
        {
          action: "membership.role",
          businessId: staff.businessId,
          venueId: null,
          target: { type: "membership", id: member.id },
          change: {
            before: { role: member.role, venues: member.venueIds.length },
            after: { role: input.role, venues: venues.length },
          },
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
      // What they held goes back to the team, so nobody waits on someone who has left.
      await this.issues.releaseAllHeldBy(member.id, staff, tx);
      await this.audit.record(
        staff,
        {
          action: "membership.remove",
          businessId: staff.businessId,
          venueId: null,
          target: { type: "membership", id: member.id },
          change: { before: { role: member.role }, after: { role: null } },
        },
        tx,
      );
    });
  }

  /**
   * The venues a role is given: none for a role over the whole workspace; for a venue role at
   * least one, all of this business's, and within the reader's own venues.
   */
  private async venuesFor(
    staff: Principal,
    role: MembershipRole,
    venueIds: string[],
  ): Promise<string[]> {
    const chosen = [...new Set(venueIds)];
    if (!isVenueRole(role)) {
      if (chosen.length > 0) throw badVenues("are given only to a venue manager or operator");
      return [];
    }
    if (chosen.length === 0) throw badVenues("choose at least one venue");
    // A venue role is a business's, so only someone in that business gives one.
    if (staff.businessId === null) throw outranked();
    const found = await this.db.venue.count({
      where: { id: { in: chosen }, businessId: staff.businessId },
    });
    if (found !== chosen.length) throw badVenues("must be this business's venues");
    if (!reaches(staff, chosen)) throw outOfReach();
    return chosen;
  }

  private async manageable(staff: Principal, membershipId: string) {
    const member = await this.db.membership.findFirst({
      where: { id: membershipId, ...workspace(staff), status: "active" },
      include: { venues: { select: { venueId: true } } },
    });
    if (!member) throw notFound();
    if (member.id === staff.membershipId) {
      throw new BadRequestException(
        apiError("BAD_REQUEST", "You can't change or remove yourself."),
      );
    }
    if (!outranks(staff.role, member.role)) throw outranked();
    const venues = member.venues.map((v) => v.venueId);
    if (!reaches(staff, venues)) throw outOfReach();
    return { id: member.id, role: member.role, venueIds: venues };
  }

  /** A pending invitation in the reader's workspace, for a role below theirs, within their venues. */
  private async ownInvitation(staff: Principal, id: string) {
    const row = await this.db.invitation.findFirst({
      where: { id, ...workspace(staff), ...pending() },
    });
    if (!row) throw notFound();
    if (!outranks(staff.role, row.role)) throw outranked();
    if (!reaches(staff, row.venueIds)) throw outOfReach();
    return row;
  }

  private async pendingInvitations(staff: Principal): Promise<InvitationRecord[]> {
    const rows = await this.db.invitation.findMany({
      where: { ...pending(), ...workspace(staff) },
      include: { invitedBy: { include: { user: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.filter((r) => reaches(staff, r.venueIds)).map(invitationRecordOf);
  }

  private async pendingInvitation(staff: Principal, id: string): Promise<InvitationRecord> {
    const found = (await this.pendingInvitations(staff)).find((r) => r.id === id);
    if (!found) throw notFound();
    return found;
  }

  /** Sends the email without waiting on it; a failure is recorded, and Resend sends a new link. */
  private async send(staff: Principal, email: string, role: string, token: string) {
    const link = `${this.config.frontendOrigin}/invite#token=${token}`;
    const business =
      staff.businessId === null
        ? null
        : await this.db.business.findUnique({
            where: { id: staff.businessId },
            select: { name: true },
          });
    const team = business === null ? "HashiNet's team" : `${business.name}'s team`;
    void this.email.send(memberInvitationEmail(email, role, team, link)).catch(captureFailure);
  }
}

/** The reader's workspace: HashiNet's own, or their business. */
function workspace(staff: Principal) {
  return staff.scope === "platform"
    ? { scope: "platform" as const, businessId: null }
    : { scope: "business" as const, businessId: staff.businessId };
}

/** Whether the reader reaches these venues: every one, or a venue manager's own. A role over the
 * whole workspace (no venues) is reached only by a reader over the whole workspace too. */
function reaches(staff: Principal, venueIds: string[]): boolean {
  if (staff.venueIds === null) return true;
  const own = staff.venueIds;
  return venueIds.length > 0 && venueIds.every((v) => own.includes(v));
}
