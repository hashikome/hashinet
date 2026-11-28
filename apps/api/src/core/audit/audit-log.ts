import type { AuditAction, AuditCategory, AuditChange, AuditOutcome } from "@hashinet/types";
import { getLogger } from "@logtape/logtape";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { Principal } from "../access/principal.js";

export interface AuditEvent {
  action: AuditAction;
  category?: AuditCategory;
  target: { type: string; id: string | null };
  /**
   * The business and venue the event is about, said at every call, so a business's or a venue's
   * Audit log misses nothing: HashiNet's team acting on a business names that business, and an
   * event about one venue names it. Null when the event belongs to none (the platform's own).
   */
  businessId: string | null;
  venueId: string | null;
  outcome?: AuditOutcome;
  /** Bounded values only: statuses, prices, roles, counts (ADR-0012). */
  change?: { before: AuditChange; after: AuditChange } | null;
}

type Writer = Pick<PrismaClient, "auditLog"> | Prisma.TransactionClient;

/** Who acted: a principal, or someone whose membership an acceptance has just created. */
export type AuditActor = Pick<Principal, "membershipId" | "userId">;

/**
 * The audit log (ADR-0012): append-only. Pass the change's own transaction as `tx` so a failed
 * audit write rolls the change back; the application never edits or deletes a row.
 */
export class AuditLog {
  private readonly logger = getLogger(["hashinet", "audit"]);

  constructor(private readonly db: PrismaClient) {}

  /** Something a person did, as the membership their session acts as (or has just been given). */
  async record(actor: AuditActor, event: AuditEvent, tx: Writer = this.db): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorMembershipId: actor.membershipId,
        actorUserId: actor.userId,
        ...rowOf(event),
      },
    });
  }

  /** Where an event about something at this venue belongs: the venue and its business. */
  async atVenue(venueId: string | null): Promise<Pick<AuditEvent, "businessId" | "venueId">> {
    if (venueId === null) return { businessId: null, venueId: null };
    const venue = await this.db.venue.findUnique({
      where: { id: venueId },
      select: { businessId: true },
    });
    return { businessId: venue?.businessId ?? null, venueId };
  }

  /**
   * Something the system did on its own, such as a failed router push. Never throws: an audit
   * write must not take down the work it describes.
   */
  async system(event: AuditEvent): Promise<void> {
    try {
      await this.db.auditLog.create({ data: rowOf(event) });
    } catch (error) {
      this.logger.error("Failed to write a system audit event {action}", {
        action: event.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function rowOf(event: AuditEvent) {
  return {
    action: event.action,
    category: event.category ?? "change",
    targetType: event.target.type,
    targetId: event.target.id,
    businessId: event.businessId,
    venueId: event.venueId,
    outcome: event.outcome ?? "success",
    change: event.change ?? undefined,
  };
}
