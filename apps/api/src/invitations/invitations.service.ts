import {
  type AcceptedInvitation,
  type InvitationPreview,
  type InvitationRecord,
  REGIONS,
} from "@hashinet/types";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../access/principal.js";
import { AuditLog } from "../audit/audit-log.js";
import { BillingSettings, feeTermsColumns } from "../billing/billing-settings.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { EMAIL_SENDER, type EmailSender } from "../email/email-sender.js";
import { apiError } from "../http/error-envelope.js";
import { oneLine } from "../http/validation.js";
import { captureFailure } from "../observability/telemetry.js";
import { OnboardingService } from "../onboarding/onboarding.service.js";
import { copyToBusiness, copyToVenue } from "../portal/copy-down.js";
import { normalizeTzPhone } from "../utils/phone.js";
import { businessInvitationEmail } from "./invitation-emails.js";
import { digestOf, INVITATION_HOURS, newInvitationToken } from "./invitation-token.js";

const line = (max: number) => oneLine(max).min(1, "is required");

export const inviteBusinessInput = z.object({
  // Trimmed and lower-cased before it is checked, as a pasted address often carries both.
  email: z.string().trim().toLowerCase().max(255).pipe(z.email("must be an email address")),
});

const place = { region: z.enum(REGIONS), area: line(160) };

export const acceptMemberInput = z.object({
  token: z.string().min(20).max(100),
  person: z.object({ name: line(160) }),
});

export const acceptBusinessInput = z.object({
  token: z.string().min(20).max(100),
  person: z.object({
    name: line(160),
    phone: z
      .string()
      .transform((raw) => normalizeTzPhone(raw))
      .refine((phone): phone is string => phone !== null, "must be a Tanzanian mobile number"),
  }),
  business: z.object({ name: line(160), ...place }),
  venue: z.object({ name: line(180), ...place }),
});

/** A new business's packages start at this speed; the owner changes it per package. */
const STARTING_DOWNLOAD_MBPS = 10;

const invitationGone = () =>
  new NotFoundException(
    apiError("INVITATION_NOT_FOUND", "This invitation has expired, been used, or was replaced."),
  );

/**
 * Invitations are the only way in (ADR-0011): issuing one creates nothing but the invitation,
 * its token's digest, the email and the audit row; accepting creates the person, the business,
 * its first venue, its packages and the owner's membership, in one transaction.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly onboarding: OnboardingService,
    private readonly billing: BillingSettings,
  ) {}

  /** The pending invitations to start a business, newest first. */
  async pendingBusinesses(): Promise<InvitationRecord[]> {
    const rows = await this.db.invitation.findMany({
      where: { ...pending(), scope: "business", role: "owner", businessId: null },
      include: { invitedBy: { include: { user: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(invitationRecordOf);
  }

  /** Invites someone to start a business. A pending invitation to the same email is replaced. */
  async inviteBusiness(staff: Principal, email: string): Promise<InvitationRecord> {
    const { token, digest } = newInvitationToken();
    const row = await this.db.$transaction(async (tx) => {
      await tx.invitation.updateMany({
        where: { ...pending(), email, scope: "business", role: "owner", businessId: null },
        data: { revokedAt: new Date() },
      });
      const created = await tx.invitation.create({
        data: {
          email,
          scope: "business",
          role: "owner",
          tokenDigest: digest,
          invitedById: staff.membershipId,
          expiresAt: new Date(Date.now() + INVITATION_HOURS * 3600_000),
        },
      });
      await this.audit.record(
        staff,
        {
          action: "invitation.issue",
          businessId: null,
          venueId: null,
          target: { type: "invitation", id: created.id },
        },
        tx,
      );
      return created;
    });
    this.send(email, token);
    const [record] = (await this.pendingBusinesses()).filter((r) => r.id === row.id);
    if (!record) throw invitationGone();
    return record;
  }

  /** Sends a pending invitation again, with a new link; the old link stops working. */
  async resend(staff: Principal, id: string): Promise<InvitationRecord> {
    const current = await this.db.invitation.findFirst({
      where: { id, ...pending(), ...NEW_BUSINESS },
    });
    if (!current) throw invitationGone();
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
          businessId: null,
          venueId: null,
          target: { type: "invitation", id },
        },
        tx,
      );
    });
    this.send(current.email, token);
    const [record] = (await this.pendingBusinesses()).filter((r) => r.id === id);
    if (!record) throw invitationGone();
    return record;
  }

  async revoke(staff: Principal, id: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const revoked = await tx.invitation.updateMany({
        where: { id, ...pending(), ...NEW_BUSINESS },
        data: { revokedAt: new Date() },
      });
      if (revoked.count === 0) throw invitationGone();
      await this.audit.record(
        staff,
        {
          action: "invitation.revoke",
          businessId: null,
          venueId: null,
          target: { type: "invitation", id },
        },
        tx,
      );
    });
  }

  /** What the invitation page shows first: whom it is for, as what, and until when. Nothing else. */
  async preview(token: string): Promise<InvitationPreview> {
    const row = await this.db.invitation.findFirst({
      where: { tokenDigest: digestOf(token), ...pending() },
      include: { business: { select: { name: true } } },
    });
    if (!row) throw invitationGone();
    const expiresAt = row.expiresAt.toISOString();
    if (row.scope === "platform") {
      return {
        email: row.email,
        kind: "platform_member",
        role: row.role,
        businessName: null,
        expiresAt,
      };
    }
    if (row.business !== null) {
      return {
        email: row.email,
        kind: "business_member",
        role: row.role,
        businessName: row.business.name,
        expiresAt,
      };
    }
    if (row.role !== "owner") throw invitationGone();
    return { email: row.email, kind: "business_owner", role: null, businessName: null, expiresAt };
  }

  /**
   * Accepts an invitation to a team, HashiNet's or a business's, in one transaction: the token is
   * claimed first; the person is found or created, and their membership in that workspace made or
   * given back, with the invitation's venues for a venue role (those the business still has). It
   * never signs anyone in.
   */
  async acceptMember(input: z.infer<typeof acceptMemberInput>): Promise<AcceptedInvitation> {
    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const digest = digestOf(input.token);
      const claimed = await tx.invitation.updateMany({
        where: {
          tokenDigest: digest,
          ...pending(now),
          OR: [{ scope: "platform" }, { scope: "business", businessId: { not: null } }],
        },
        data: { acceptedAt: now },
      });
      if (claimed.count === 0) throw invitationGone();
      const invitation = await tx.invitation.findUniqueOrThrow({ where: { tokenDigest: digest } });
      const user =
        (await tx.user.findUnique({ where: { email: invitation.email } })) ??
        (await tx.user.create({
          data: {
            id: Bun.randomUUIDv7(),
            email: invitation.email,
            name: input.person.name,
            emailVerified: true,
          },
        }));
      const where = {
        userId: user.id,
        scope: invitation.scope,
        businessId: invitation.businessId,
      };
      // One membership per person in a workspace: someone removed earlier is given it back.
      const existing = await tx.membership.findFirst({ where });
      const membership = existing
        ? await tx.membership.update({
            where: { id: existing.id },
            data: { role: invitation.role, status: "active" },
          })
        : await tx.membership.create({ data: { ...where, role: invitation.role } });
      const venues =
        invitation.businessId === null
          ? []
          : await tx.venue.findMany({
              where: { id: { in: invitation.venueIds }, businessId: invitation.businessId },
              select: { id: true },
            });
      await tx.membershipVenue.deleteMany({ where: { membershipId: membership.id } });
      await tx.membershipVenue.createMany({
        data: venues.map((v) => ({ membershipId: membership.id, venueId: v.id })),
      });
      await this.audit.record(
        { membershipId: membership.id, userId: user.id },
        {
          action: "invitation.accept",
          businessId: invitation.businessId,
          venueId: null,
          target: { type: "invitation", id: invitation.id },
          change: { before: {}, after: { role: invitation.role, venues: venues.length } },
        },
        tx,
      );
      return { email: invitation.email, businessId: invitation.businessId };
    });
  }

  /**
   * Accepts an invitation to start a business, in one transaction: the token is claimed first,
   * so two acceptances of one link never both create a business. It never signs anyone in.
   */
  async acceptBusiness(input: z.infer<typeof acceptBusinessInput>): Promise<AcceptedInvitation> {
    const { terms } = await this.billing.get();
    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const digest = digestOf(input.token);
      const claimed = await tx.invitation.updateMany({
        where: {
          tokenDigest: digest,
          ...pending(now),
          scope: "business",
          role: "owner",
          businessId: null,
        },
        data: { acceptedAt: now },
      });
      if (claimed.count === 0) throw invitationGone();
      const invitation = await tx.invitation.findUniqueOrThrow({ where: { tokenDigest: digest } });

      const existing = await tx.user.findUnique({ where: { email: invitation.email } });
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: { phone: existing.phone ?? input.person.phone },
          })
        : await tx.user.create({
            data: {
              id: Bun.randomUUIDv7(),
              email: invitation.email,
              name: input.person.name,
              phone: input.person.phone,
              emailVerified: true,
            },
          });

      const business = await tx.business.create({
        data: {
          name: input.business.name,
          region: input.business.region,
          area: input.business.area,
          // Its own copy of the fee terms as they stand (ADR-0013, 3).
          ...feeTermsColumns(terms),
          venues: { create: { ...input.venue } },
        },
        include: { venues: true },
      });
      const venue = business.venues[0];
      if (!venue) throw new ConflictException(apiError("CONFLICT", "The venue was not created."));
      // Its portal starts as the platform's new businesses do, and its first venue's from it.
      await copyToBusiness(tx, business.id);
      await copyToVenue(tx, venue.id, business.id);
      await this.onboarding.begin(venue.id, tx);

      // A new business starts with the platform's default packages, sold at every venue
      // (ADR-0011, 10); a later change to the defaults never reaches it.
      const defaults = await tx.platformDefaultPackage.findMany({ orderBy: { position: "asc" } });
      for (const d of defaults) {
        await tx.package.create({
          data: {
            businessId: business.id,
            name: d.name,
            durationMinutes: d.durationMinutes,
            deviceLimit: d.deviceLimit,
            priceTsh: d.priceTsh,
            downloadSpeedMbps: STARTING_DOWNLOAD_MBPS,
          },
        });
      }

      const membership = await tx.membership.create({
        data: { userId: user.id, scope: "business", businessId: business.id, role: "owner" },
      });
      const actor = { membershipId: membership.id, userId: user.id };
      await this.audit.record(
        actor,
        {
          action: "invitation.accept",
          businessId: business.id,
          venueId: null,
          target: { type: "invitation", id: invitation.id },
        },
        tx,
      );
      await this.audit.record(
        actor,
        {
          action: "business.create",
          businessId: business.id,
          venueId: null,
          target: { type: "business", id: business.id },
          change: { before: {}, after: { venues: 1, packages: defaults.length } },
        },
        tx,
      );
      return { email: invitation.email, businessId: business.id };
    });
  }

  /** Sends the email without waiting on it; a failure is recorded, and Resend sends a new link. */
  private send(email: string, token: string): void {
    const link = `${this.config.frontendOrigin}/invite#token=${token}`;
    void this.email.send(businessInvitationEmail(email, link)).catch(captureFailure);
  }
}

/** An invitation to start a business: the only kind these routes resend or revoke. */
const NEW_BUSINESS = { scope: "business", role: "owner", businessId: null } as const;

export function invitationRecordOf(row: {
  id: string;
  email: string;
  scope: InvitationRecord["scope"];
  role: InvitationRecord["role"];
  businessId: string | null;
  venueIds: string[];
  invitedBy: { user: { name: string } } | null;
  createdAt: Date;
  expiresAt: Date;
}): InvitationRecord {
  return {
    id: row.id,
    email: row.email,
    scope: row.scope,
    role: row.role,
    businessId: row.businessId,
    venueIds: row.venueIds,
    invitedBy: row.invitedBy?.user.name ?? null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** An invitation that can still be accepted. */
export function pending(now = new Date()) {
  return { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
}
