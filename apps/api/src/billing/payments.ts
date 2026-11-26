import { BILL_PAYMENT_METHODS } from "@hashinet/types";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../access/principal.js";
import { businessDayOf } from "../analytics/business-day.js";
import { AuditLog } from "../audit/audit-log.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";
import { oneLine } from "../http/validation.js";
import { IssuesService } from "../issues/issues.service.js";
import { packageKey } from "../onboarding/begin.js";
import { tsh } from "./invoice-emails.js";

export const recordPaymentInput = z.object({
  businessId: z.uuid(),
  invoiceId: z.uuid().nullable(),
  amountTsh: z
    .number("must be a number")
    .int("must be whole shillings")
    .positive("must be above zero"),
  receivedOn: z.iso.date("must be a date"),
  method: z.enum(BILL_PAYMENT_METHODS),
  reference: oneLine(80).transform((v) => (v === "" ? null : v)),
});

const invalid = (field: string, message: string) =>
  new BadRequestException(
    apiError("VALIDATION_FAILED", "Check the highlighted fields.", { [field]: message }),
  );

/**
 * Money a business paid HashiNet, recorded as it arrived (ADR-0013, 6), by HashiNet's admin or a
 * manager. Recorded on an invoice it settles that invoice; recorded on the business, the oldest
 * first (owner, 26 November 2026). Never more than is owed, so nothing is left unaccounted for.
 */
@Injectable()
export class BillPayments {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly issues: IssuesService,
  ) {}

  async record(staff: Principal, input: z.infer<typeof recordPaymentInput>): Promise<void> {
    if (input.receivedOn > businessDayOf(new Date())) {
      throw invalid("receivedOn", "can't be in the future");
    }
    await this.db.$transaction(async (tx) => {
      // One payment at a time for a business, so two at once can't settle the same amount twice.
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM businesses WHERE id = ${input.businessId}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException(apiError("NOT_FOUND", "There is no such business."));

      const invoices = await tx.invoice.findMany({
        where: { businessId: input.businessId },
        include: { allocations: { select: { amountTsh: true } } },
        orderBy: [{ dueOn: "asc" }, { issuedAt: "asc" }],
      });
      const owing = invoices
        .map((i) => ({
          ...i,
          left: i.totalTsh - i.allocations.reduce((sum, a) => sum + a.amountTsh, 0),
        }))
        .filter((i) => i.left > 0);

      let targets = owing;
      if (input.invoiceId !== null) {
        const one = invoices.find((i) => i.id === input.invoiceId);
        if (!one) throw new NotFoundException(apiError("NOT_FOUND", "There is no such invoice."));
        targets = owing.filter((i) => i.id === input.invoiceId);
        if (targets.length === 0) throw new ConflictException(apiError("CONFLICT", "It is paid."));
      }
      const owed = targets.reduce((sum, i) => sum + i.left, 0);
      if (owed === 0) throw new ConflictException(apiError("CONFLICT", "Nothing is owed."));
      if (input.amountTsh > owed) {
        throw invalid("amountTsh", `is more than is owed: ${tsh(owed)}`);
      }

      let left = input.amountTsh;
      const parts: { invoice: (typeof targets)[number]; amountTsh: number }[] = [];
      for (const invoice of targets) {
        if (left === 0) break;
        const part = Math.min(left, invoice.left);
        parts.push({ invoice, amountTsh: part });
        left -= part;
      }
      const payment = await tx.billPayment.create({
        data: {
          businessId: input.businessId,
          amountTsh: input.amountTsh,
          receivedOn: new Date(`${input.receivedOn}T00:00:00Z`),
          method: input.method,
          reference: input.reference,
          recordedById: staff.membershipId,
          allocations: {
            create: parts.map((p) => ({ invoiceId: p.invoice.id, amountTsh: p.amountTsh })),
          },
        },
      });

      // A venue's package paid in full: its issue says so, and its setup can be scheduled.
      for (const p of parts) {
        if (p.invoice.kind !== "onboarding" || p.invoice.venueId === null) continue;
        if (p.amountTsh < p.invoice.left) continue;
        const open = await tx.issue.findFirst({
          where: { key: packageKey(p.invoice.venueId), status: "open" },
          select: { id: true },
        });
        if (!open) continue;
        await this.issues.step(
          staff,
          packageKey(p.invoice.venueId),
          { step: "paid", amountTsh: p.invoice.totalTsh },
          { anyone: true },
          tx,
        );
      }

      await this.audit.record(
        staff,
        {
          action: "billing.payment",
          businessId: input.businessId,
          venueId: null,
          target: { type: "bill_payment", id: payment.id },
          change: {
            before: {},
            after: {
              amountTsh: input.amountTsh,
              method: input.method,
              receivedOn: input.receivedOn,
              settles: parts.map((p) => p.invoice.number).join(", "),
            },
          },
        },
        tx,
      );
    });
  }
}
