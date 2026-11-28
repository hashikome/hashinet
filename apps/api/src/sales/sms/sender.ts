import type { ProviderContext, WebhookOutcome, WebhookRequest } from "../providers.js";

/** A provider's delivery report, in HashiNet's terms. */
export interface SmsReport {
  /** The provider's id for this event: each is acted on once. */
  eventId: string;
  status: "sent" | "delivered" | "failed";
  /** The send names a job and reports a message; a message is matched on either. */
  jobId: string | null;
  messageId: string | null;
}

/**
 * Sends one text to one number through one provider. Resolves once accepted; delivery is reported
 * separately. A null job means no report is coming (the development outbox).
 */
export interface SmsSender {
  /** Recorded on each text it sends, so its reports are matched to its own texts. */
  readonly name: string;
  send(message: { to: string; text: string }): Promise<{ jobId: string | null }>;
  /** A delivery report, checked over the exact bytes received. */
  webhook(request: WebhookRequest): WebhookOutcome<SmsReport>;
}

/** Builds a provider from its own settings: null when none are set, an error when some are. */
export type SmsProvider = (context: ProviderContext) => SmsSender | null;

/** Every SMS provider set up, and the one that sends new texts (`SMS_PROVIDER`; null: none). */
export class Texts {
  constructor(
    readonly active: SmsSender | null,
    private readonly all: SmsSender[],
  ) {}

  byName(name: string | null): SmsSender | null {
    return this.all.find((s) => s.name === name) ?? null;
  }
}

export const SMS_SENDER = Symbol("SMS_SENDER");
