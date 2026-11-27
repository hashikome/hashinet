import type {
  PaymentWay,
  PaymentWayList,
  PaymentWayRecord,
  VenuePaymentWay,
} from "@hashinet/types";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../access/principal.js";
import { venueScope } from "../access/venue-scope.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import type { PaymentWay as PaymentWayRow, Prisma } from "../generated/prisma/client.js";
import { apiError } from "../http/error-envelope.js";
import { oneLine } from "../http/validation.js";
import { VenuesService } from "../venues/venues.service.js";

const required = (max: number) => oneLine(max).min(1, "is required");
/** Left blank, it is absent. */
const optional = (max: number) =>
  oneLine(max)
    .default("")
    .transform((v) => v || null);
const common = {
  number: z
    .string()
    .trim()
    .regex(/^[0-9 ]{4,40}$/, "must be digits, with spaces if you like"),
  name: required(120),
  label: optional(60),
  /** Venues with no choice of their own read it out from now. */
  makeDefault: z.boolean().default(false),
};

/** A way to pay: each kind asks for what a guest needs to pay it. */
export const paymentWayInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("lipa_namba"), provider: required(60), ...common }),
  z.object({ kind: z.literal("mobile_number"), provider: required(60), ...common }),
  z.object({
    kind: z.literal("bank_account"),
    provider: required(60),
    branch: optional(60),
    ...common,
  }),
]);
type PaymentWayInput = z.infer<typeof paymentWayInput>;

export const venuePaymentWayInput = z.object({
  /** One of the business's ways; null follows the business's default. */
  wayId: z.uuid().nullable(),
});

/** What whoever sells reads first: a Lipa namba and its provider, the network, or the bank. */
const throughOf = (w: Pick<PaymentWayRow, "kind" | "provider">) =>
  w.kind === "lipa_namba"
    ? w.provider
      ? `${w.provider} Lipa namba`
      : "Lipa namba"
    : (w.provider ?? "");

function wayOf(w: PaymentWayRow): PaymentWay {
  return {
    kind: w.kind,
    provider: w.provider,
    number: w.number,
    name: w.name,
    branch: w.branch,
    label: w.label,
    through: throughOf(w),
  };
}

/** The columns a way's input writes, the ones its kind has no use for cleared. */
function columnsOf(input: PaymentWayInput) {
  return {
    kind: input.kind,
    provider: input.provider,
    branch: input.kind === "bank_account" ? input.branch : null,
    number: input.number,
    name: input.name,
    label: input.label,
  };
}

const notFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That way to pay is not in your business."));

/**
 * A business's ways to pay (ADR-0017, 4): where guests pay by mobile money at its counters. Its
 * owner and business managers keep the list; one is the default, which venues with no choice of
 * their own read out, and it can't be removed while it is. Removing another moves the venues that
 * chose it to the default.
 */
@Injectable()
export class PaymentWaysService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly venues: VenuesService,
  ) {}

  async list(staff: Principal): Promise<PaymentWayList> {
    const businessId = this.businessOf(staff);
    const [business, ways, venues] = await Promise.all([
      this.db.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { defaultPaymentWayId: true },
      }),
      this.db.paymentWay.findMany({
        where: { businessId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { addedBy: { select: { user: { select: { name: true } } } } },
      }),
      // Only the venues the reader sees say where a way is used.
      this.db.venue.findMany({
        where: venueScope(staff),
        select: { id: true, name: true, paymentWayId: true },
        orderBy: { name: "asc" },
      }),
    ]);
    const defaultId = business.defaultPaymentWayId;
    const records: PaymentWayRecord[] = ways.map((w) => ({
      ...wayOf(w),
      id: w.id,
      isDefault: w.id === defaultId,
      addedAt: w.createdAt.toISOString(),
      addedBy: w.addedBy?.user.name ?? null,
      venues: venues
        .filter((v) => (v.paymentWayId ?? defaultId) === w.id)
        .map((v) => ({ id: v.id, name: v.name })),
    }));
    return { ways: records.sort((a, b) => Number(b.isDefault) - Number(a.isDefault)) };
  }

  async create(staff: Principal, input: PaymentWayInput): Promise<PaymentWayList> {
    const businessId = this.businessOf(staff);
    await this.db.$transaction(async (tx) => {
      const business = await this.lock(tx, businessId);
      const way = await tx.paymentWay.create({
        data: { businessId, addedById: staff.membershipId, ...columnsOf(input) },
      });
      // A business's first way is its default: there is always one while it has any.
      if (input.makeDefault || business.defaultPaymentWayId === null) {
        await this.makeDefault(tx, businessId, way.id);
      }
      await this.audit.record(
        staff,
        {
          action: "payment_way.create",
          businessId,
          venueId: null,
          target: { type: "payment_way", id: way.id },
          change: { before: {}, after: { kind: input.kind, through: throughOf(way) } },
        },
        tx,
      );
    });
    return this.list(staff);
  }

  async update(staff: Principal, id: string, input: PaymentWayInput): Promise<PaymentWayList> {
    const businessId = this.businessOf(staff);
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, businessId);
      const before = await tx.paymentWay.findFirst({ where: { id, businessId } });
      if (!before) throw notFound();
      const way = await tx.paymentWay.update({ where: { id }, data: columnsOf(input) });
      if (input.makeDefault) await this.makeDefault(tx, businessId, id);
      await this.audit.record(
        staff,
        {
          action: "payment_way.update",
          businessId,
          venueId: null,
          target: { type: "payment_way", id },
          change: {
            before: { through: throughOf(before), number: before.number },
            after: { through: throughOf(way), number: way.number, makeDefault: input.makeDefault },
          },
        },
        tx,
      );
    });
    return this.list(staff);
  }

  async remove(staff: Principal, id: string): Promise<PaymentWayList> {
    const businessId = this.businessOf(staff);
    await this.db.$transaction(async (tx) => {
      const business = await this.lock(tx, businessId);
      const way = await tx.paymentWay.findFirst({ where: { id, businessId } });
      if (!way) throw notFound();
      if (business.defaultPaymentWayId === id) {
        throw new ConflictException(
          apiError(
            "PAYMENT_WAY_IS_DEFAULT",
            "This is your default way to pay. Make another the default first.",
          ),
        );
      }
      // Venues that chose it read out the default from now on.
      const moved = await tx.venue.updateMany({
        where: { businessId, paymentWayId: id },
        data: { paymentWayId: null },
      });
      await tx.paymentWay.delete({ where: { id } });
      await this.audit.record(
        staff,
        {
          action: "payment_way.delete",
          businessId,
          venueId: null,
          target: { type: "payment_way", id },
          change: {
            before: { through: throughOf(way), number: way.number },
            after: { venuesMovedToDefault: moved.count },
          },
        },
        tx,
      );
    });
    return this.list(staff);
  }

  /** The way whoever sells at a venue reads out, within the reader's venues. */
  async atVenue(staff: Principal, venueId: string): Promise<VenuePaymentWay> {
    await this.venues.get(staff, venueId);
    return this.resolve(venueId);
  }

  async choose(
    staff: Principal,
    venueId: string,
    input: z.infer<typeof venuePaymentWayInput>,
  ): Promise<VenuePaymentWay> {
    const venue = await this.venues.get(staff, venueId);
    const { wayId } = input;
    // Under the business's lock, as the list's changes are, so a way removed meanwhile is refused.
    await this.db.$transaction(async (tx) => {
      const business = await this.lock(tx, venue.businessId);
      if (
        wayId !== null &&
        (await tx.paymentWay.count({ where: { id: wayId, businessId: venue.businessId } })) === 0
      ) {
        throw new BadRequestException(
          apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
            wayId: "is not one of your business's ways to pay",
          }),
        );
      }
      const before = await tx.venue.findUniqueOrThrow({
        where: { id: venueId },
        select: { paymentWayId: true },
      });
      // Choosing the default is following it, so a later change of default reaches the venue.
      const chosen = wayId === business.defaultPaymentWayId ? null : wayId;
      await tx.venue.update({ where: { id: venueId }, data: { paymentWayId: chosen } });
      await this.audit.record(
        staff,
        {
          action: "venue.payment_way.choose",
          businessId: venue.businessId,
          venueId,
          target: { type: "venue", id: venueId },
          change: { before: { wayId: before.paymentWayId }, after: { wayId: chosen } },
        },
        tx,
      );
    });
    return this.resolve(venueId);
  }

  /** A venue's way to pay, for a sale: its own choice, or its business's default. */
  async resolve(venueId: string): Promise<VenuePaymentWay> {
    const venue = await this.db.venue.findUniqueOrThrow({
      where: { id: venueId },
      select: {
        paymentWayId: true,
        paymentWay: true,
        business: { select: { defaultPaymentWay: true } },
      },
    });
    const way = venue.paymentWay ?? venue.business.defaultPaymentWay;
    return { way: way ? wayOf(way) : null, choiceId: venue.paymentWayId };
  }

  private businessOf(staff: Principal): string {
    if (staff.businessId === null) throw notFound();
    return staff.businessId;
  }

  /** The default from now; venues that had chosen it follow it, so a later change reaches them. */
  private async makeDefault(tx: Prisma.TransactionClient, businessId: string, wayId: string) {
    await tx.business.update({ where: { id: businessId }, data: { defaultPaymentWayId: wayId } });
    await tx.venue.updateMany({
      where: { businessId, paymentWayId: wayId },
      data: { paymentWayId: null },
    });
  }

  /** One change at a time to a business's ways, so its default is never lost between two. */
  private async lock(tx: Prisma.TransactionClient, businessId: string) {
    await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
    return tx.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { defaultPaymentWayId: true },
    });
  }
}
