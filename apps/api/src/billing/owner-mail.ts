import { Inject, Injectable } from "@nestjs/common";
import type { AppConfig } from "../core/config/config.js";
import { APP_CONFIG } from "../core/config/config.module.js";
import { PrismaService } from "../core/database/prisma.service.js";
import { EMAIL_SENDER, type EmailMessage, type EmailSender } from "../core/email/email-sender.js";
import { captureFailure } from "../core/observability/telemetry.js";
import type { Prisma } from "../generated/prisma/client.js";

/** A business's active owners: who is billed, and who hears of it. */
export const OWNERS = {
  role: "owner",
  status: "active",
} as const satisfies Prisma.MembershipWhereInput;

/** What a business's owners hear about billing, by email, with a link to their Billing. */
@Injectable()
export class OwnerMail {
  constructor(
    private readonly db: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  /** Each owner gets `build`'s email; a failure to send is reported, not fatal. */
  async send(businessId: string, build: (to: string, billing: string) => EmailMessage) {
    const owners = await this.db.membership.findMany({
      where: { businessId, ...OWNERS },
      select: { user: { select: { email: true } } },
    });
    const billing = `${this.config.frontendOrigin}/billing`;
    for (const o of owners) {
      void this.email.send(build(o.user.email, billing)).catch(captureFailure);
    }
  }
}
