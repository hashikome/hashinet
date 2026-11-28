import { type CustomerRecord, type PaymentRecord } from "@hashinet/types";
import { Injectable } from "@nestjs/common";
import type { Principal } from "../../core/access/principal.js";
import { venueScope } from "../../core/access/venue-scope.js";
import { PrismaService } from "../../core/database/prisma.service.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { PaymentListInput } from "./payment-input.js";

import { PAYMENT_INCLUDE, type PaymentRow } from "./payments.service.js";

/** Payments and customers as staff see them, within their reach. */
@Injectable()
export class PaymentLists {
  constructor(private readonly db: PrismaService) {}

  async list(staff: Principal, input: PaymentListInput): Promise<PaymentRecord[]> {
    const owed = { status: "paid", routerProvisionedAt: null } as const;
    const rows = await this.db.payment.findMany({
      where: {
        ...inScope(staff),
        ...(input.status === "owed" ? owed : input.status === null ? {} : { status: input.status }),
      },
      include: PAYMENT_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });
    return rows.map(paymentRecord);
  }

  /** Who has paid, within what this staff member may see. */
  async customers(staff: Principal): Promise<CustomerRecord[]> {
    const scope: Prisma.PaymentWhereInput = {
      ...inScope(staff),
      status: "paid",
      customerId: { not: null },
    };
    const totals = await this.db.payment.groupBy({
      by: ["customerId"],
      where: scope,
      _count: { _all: true },
      _sum: { amountTsh: true },
      _max: { paidAt: true },
      orderBy: { _max: { paidAt: "desc" } },
      take: 200,
    });
    const people = await this.db.customer.findMany({
      where: { id: { in: totals.map((t) => t.customerId ?? "") } },
    });
    const phones = new Map(people.map((p) => [p.id, p.phone]));
    return totals.map((t) => ({
      id: t.customerId ?? "",
      phone: phones.get(t.customerId ?? "") ?? "",
      payments: t._count._all,
      totalTsh: (t._sum.amountTsh ?? new Prisma.Decimal(0)).toFixed(2),
      lastPaidAt: t._max.paidAt?.toISOString() ?? null,
    }));
  }
}

/** Who may see a payment: an admin all of them, a manager their venues' (finding 3). */
function inScope(staff: Principal): Prisma.PaymentWhereInput {
  return staff.scope === "platform" ? {} : { venue: venueScope(staff) };
}

function paymentRecord(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    phone: row.phone,
    amountTsh: row.amountTsh.toFixed(2),
    provider: row.provider,
    status: row.status,
    packageName: row.package?.name ?? null,
    venueName: row.venue?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    owed: row.status === "paid" && row.routerProvisionedAt === null,
    provisionError: row.provisionError,
    sms: row.sms?.status ?? null,
  };
}
