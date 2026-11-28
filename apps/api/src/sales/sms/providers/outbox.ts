import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WebhookOutcome } from "../../providers.js";
import type { SmsProvider, SmsReport, SmsSender } from "../sender.js";

/**
 * The stand-in, only when chosen (`SMS_PROVIDER=outbox`), and never in production: texts go to
 * `SMS_OUTBOX_DIR`, by default `data/sms/` at the repository root.
 */
export const outbox: SmsProvider = (context) => {
  if (!context.chosen) return null;
  if (context.production) {
    throw new Error("Invalid configuration:\n  SMS_PROVIDER: outbox is refused in production");
  }
  return new OutboxSmsSender(context.setting("SMS_OUTBOX_DIR") ?? join(context.dataDir, "sms"));
};

/** Development and tests: one file per message under `data/sms/`, as email does. */
class OutboxSmsSender implements SmsSender {
  readonly name = "outbox";

  constructor(private readonly dir: string) {}

  async send(message: { to: string; text: string }) {
    await mkdir(this.dir, { recursive: true });
    const name = `${Date.now()}-${crypto.randomUUID()}.txt`;
    await writeFile(join(this.dir, name), `To: ${message.to}\n\n${message.text}\n`);
    return { jobId: null };
  }

  /** Nothing reports on it: each text is "delivered" once written. */
  webhook(): WebhookOutcome<SmsReport> {
    return { kind: "refused" };
  }
}
