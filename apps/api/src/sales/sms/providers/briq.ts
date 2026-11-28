import { createHmac } from "node:crypto";
import { sameBytes } from "../../../core/crypto/same-bytes.js";
import { settingsOf, type WebhookOutcome, type WebhookRequest } from "../../providers.js";
import type { SmsProvider, SmsReport, SmsSender } from "../sender.js";

interface SmsEvent {
  id?: string;
  event?: string;
  data?: { job_id?: string; message_id?: string };
}

const STATUS: Record<string, SmsReport["status"]> = {
  "sms.sent": "sent",
  "sms.delivered": "delivered",
  "sms.failed": "failed",
  "sms.expired": "failed",
};

/** BRIQ, from its key, app, sender ID and webhook secret. */
export const briq: SmsProvider = (context) => {
  const s = settingsOf(
    context,
    ["BRIQ_API_KEY", "BRIQ_APP_ID", "BRIQ_SENDER_ID", "BRIQ_WEBHOOK_SECRET"],
    "for BRIQ",
  );
  return s === null
    ? null
    : new BriqSmsSender(s.BRIQ_API_KEY, s.BRIQ_APP_ID, s.BRIQ_SENDER_ID, s.BRIQ_WEBHOOK_SECRET);
};

/** BRIQ's Karibu API. No SDK: one request, with a timeout. */
export class BriqSmsSender implements SmsSender {
  readonly name = "briq";

  constructor(
    private readonly apiKey: string,
    private readonly appId: string,
    private readonly senderId: string,
    private readonly webhookSecret: string,
    private readonly baseUrl = "https://karibu.briq.tz",
  ) {}

  async send(message: { to: string; text: string }) {
    const response = await fetch(`${this.baseUrl}/v1/message/send-instant`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
        // Without the app, delivery reports do not reach our webhook.
        "X-App-ID": this.appId,
      },
      body: JSON.stringify({
        content: message.text,
        recipients: [message.to],
        sender_id: this.senderId,
      }),
    });
    const body = (await response.json()) as { success?: boolean; job_id?: string };
    // Without a job there is nothing a report could match, so it counts as not sent.
    if (!response.ok || body.success !== true || typeof body.job_id !== "string") {
      throw new Error(`The SMS was refused (HTTP ${response.status})`);
    }
    return { jobId: body.job_id };
  }

  /**
   * Signed over the raw body alone, as `sha256=<hex>`. Reports carry no timestamp, so the event id
   * is the only defence against a replay.
   */
  webhook(request: WebhookRequest): WebhookOutcome<SmsReport> {
    const signature = request.header("x-briq-signature");
    if (signature === null) return { kind: "refused" };
    const expected = createHmac("sha256", this.webhookSecret).update(request.rawBody).digest("hex");
    if (!sameBytes(Buffer.from(signature), Buffer.from(`sha256=${expected}`))) {
      return { kind: "refused" };
    }
    const event = JSON.parse(request.rawBody.toString("utf8")) as SmsEvent;
    const status = event.event === undefined ? null : (STATUS[event.event] ?? null);
    const jobId = event.data?.job_id ?? null;
    const messageId = event.data?.message_id ?? null;
    if (event.id === undefined || status === null || (jobId === null && messageId === null)) {
      return { kind: "ignored" };
    }
    return { kind: "report", report: { eventId: event.id, status, jobId, messageId } };
  }
}
