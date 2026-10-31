import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import type { SmsStatus } from "../generated/prisma/client.js";

const STATUS: Record<string, SmsStatus> = {
  "sms.sent": "sent",
  "sms.delivered": "delivered",
  "sms.failed": "failed",
  "sms.expired": "failed",
};

/**
 * Delivery reports. The send returns a job id and reports name a message id, so a message is
 * matched on either; one nothing reports on becomes `unconfirmed` at its deadline. These events
 * carry no timestamp, so the event id is what stops a replay.
 */
@Injectable()
export class SmsReports {
  constructor(private readonly db: PrismaService) {}

  async apply(report: {
    id: string | null;
    event: string | null;
    jobId: string | null;
    messageId: string | null;
  }): Promise<void> {
    const status = report.event === null ? null : (STATUS[report.event] ?? null);
    const { id, jobId, messageId } = report;
    if (id === null || status === null || (jobId === null && messageId === null)) return;
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.webhookEvent.createMany({
        data: [{ provider: "sms", eventId: id }],
        skipDuplicates: true,
      });
      if (count === 0) return;
      const row = await tx.smsMessage.findFirst({
        where: {
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
