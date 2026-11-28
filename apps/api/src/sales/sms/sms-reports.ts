import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../core/database/prisma.service.js";
import type { SmsReport } from "./sender.js";

/**
 * Delivery reports. The send returns a job id and reports name a message id, so a message is
 * matched on either, among its provider's texts; one nothing reports on becomes `unconfirmed` at
 * its deadline.
 */
@Injectable()
export class SmsReports {
  constructor(private readonly db: PrismaService) {}

  /** A report from `provider`: its texts only, and each of its events once. */
  async apply(provider: string, report: SmsReport): Promise<void> {
    const { eventId, status, jobId, messageId } = report;
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.webhookEvent.createMany({
        data: [{ provider: `sms:${provider}`, eventId }],
        skipDuplicates: true,
      });
      if (count === 0) return;
      const row = await tx.smsMessage.findFirst({
        where: {
          gateway: provider,
          OR: [
            ...(jobId === null ? [] : [{ jobId }]),
            ...(messageId === null ? [] : [{ messageId }]),
          ],
        },
      });
      // A report can arrive after a later one: delivered is final.
      if (row === null || row.status === "delivered") return;
      await tx.smsMessage.update({
        where: { id: row.id },
        data: {
          status,
          messageId: messageId ?? row.messageId,
          deliveredAt: status === "delivered" ? new Date() : null,
          failureReason: status === "failed" ? "The network could not deliver it" : null,
        },
      });
    });
  }
}
