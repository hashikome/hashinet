import type { VenuePaymentDetails } from "@hashinet/types";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../access/principal.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import { oneLine } from "../http/validation.js";
import { VenuesService } from "../venues/venues.service.js";

/** At most three ways to pay at a venue (the database checks it too). */
export const MAX_PAYMENT_WAYS = 3;

export const paymentDetailsInput = z.object({
  ways: z
    .array(
      z.object({
        through: oneLine(60).min(1, "is required"),
        number: z
          .string()
          .trim()
          .regex(/^[0-9 ]{4,40}$/, "must be digits, with spaces if you like"),
        name: oneLine(120).min(1, "is required"),
      }),
    )
    .max(MAX_PAYMENT_WAYS, `can hold at most ${MAX_PAYMENT_WAYS} ways`),
});

/**
 * A venue's payment details: where guests pay it by mobile money at its counter (ADR-0017, 4).
 * Whoever sells there reads them; its owner or a manager replaces the list, in one transaction.
 */
@Injectable()
export class PaymentDetailsService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly venues: VenuesService,
  ) {}

  async get(staff: Principal, venueId: string): Promise<VenuePaymentDetails> {
    await this.venues.get(staff, venueId);
    return this.read(venueId);
  }

  async update(
    staff: Principal,
    venueId: string,
    input: z.infer<typeof paymentDetailsInput>,
  ): Promise<VenuePaymentDetails> {
    const venue = await this.venues.get(staff, venueId);
    const before = await this.db.venuePaymentWay.count({ where: { venueId } });
    await this.db.$transaction(async (tx) => {
      await tx.venuePaymentWay.deleteMany({ where: { venueId } });
      await tx.venuePaymentWay.createMany({
        data: input.ways.map((w, position) => ({ venueId, position, ...w })),
      });
      await this.audit.record(
        staff,
        {
          action: "venue.payment_details.update",
          businessId: venue.businessId,
          venueId,
          target: { type: "venue", id: venueId },
          change: { before: { ways: before }, after: { ways: input.ways.length } },
        },
        tx,
      );
    });
    return this.read(venueId);
  }

  private async read(venueId: string): Promise<VenuePaymentDetails> {
    const rows = await this.db.venuePaymentWay.findMany({
      where: { venueId },
      orderBy: { position: "asc" },
      select: { through: true, number: true, name: true },
    });
    return { ways: rows };
  }
}
