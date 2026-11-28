import { createHmac } from "node:crypto";
import { sameBytes } from "../../../core/crypto/same-bytes.js";
import { settingsOf, type WebhookOutcome, type WebhookRequest } from "../../providers.js";
import type {
  ChargeState,
  MobileMoneyGateway,
  MobileMoneyProvider,
  PaymentReport,
} from "../gateway.js";

const STALE_SECONDS = 300;

interface PaymentEvent {
  id?: string;
  type?: string;
  data?: {
    reference?: string;
    status?: string;
    amount?: { value?: number; currency?: string };
    failure_reason?: string;
    metadata?: { payment_id?: string };
  };
}

/** Snippe, from `SNIPPE_API_KEY` and `SNIPPE_WEBHOOK_SECRET`. */
export const snippe: MobileMoneyProvider = (context) => {
  const s = settingsOf(context, ["SNIPPE_API_KEY", "SNIPPE_WEBHOOK_SECRET"], "for Snippe");
  return s === null
    ? null
    : new SnippeGateway(
        s.SNIPPE_API_KEY,
        s.SNIPPE_WEBHOOK_SECRET,
        `${context.appUrl}/webhooks/payments/snippe`,
      );
};

/**
 * What ends a payment. The docs list `failed`, `voided` and `expired`; a live account also sends
 * `cancelled`, which the docs omit.
 */
const FAILED = new Set(["failed", "expired", "voided", "cancelled"]);

export function chargeState(status: string): ChargeState["state"] {
  if (status === "completed") return "completed";
  return FAILED.has(status) ? "failed" : "pending";
}

/** Snippe's API, version 2026-01-25. */
export class SnippeGateway implements MobileMoneyGateway {
  readonly name = "snippe";

  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret: string,
    private readonly webhookUrl: string,
    private readonly baseUrl = "https://api.snippe.sh",
  ) {}

  /**
   * Not confirmed with Snippe yet (owner, 13 November 2026); it may be TSh 1,000. Separate from a
   * voucher's lowest price (TSh 500): a package below it still sells at the counter.
   */
  accepts(amount: number): boolean {
    return amount >= 500;
  }

  async charge(request: Parameters<MobileMoneyGateway["charge"]>[0]) {
    const response = await fetch(`${this.baseUrl}/v1/payments`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": request.idempotencyKey,
      },
      body: JSON.stringify({
        payment_type: "mobile",
        details: { amount: request.amount, currency: "TZS" },
        phone_number: request.phone.replace("+", ""),
        // Required by the provider, and not ours to invent per person.
        customer: { firstname: "WiFi", lastname: "Guest", email: "guest@hashikome.com" },
        webhook_url: this.webhookUrl,
        metadata: { payment_id: request.paymentId },
      }),
    });
    const body = (await response.json()) as {
      data?: { reference?: string; expires_at?: string };
    };
    const reference = body.data?.reference ?? null;
    if (!response.ok || reference === null) {
      throw new Error(`The provider refused the payment (HTTP ${response.status})`);
    }
    return { reference, expiresAt: new Date(body.data?.expires_at ?? Date.now() + 4 * 3_600_000) };
  }

  async state(reference: string): Promise<ChargeState | null> {
    const response = await fetch(`${this.baseUrl}/v1/payments/${encodeURIComponent(reference)}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${this.apiKey}` },
    }).catch(() => null);
    if (response === null || !response.ok) return null;
    const body = (await response.json()) as {
      data?: { status?: string; amount?: { value?: number }; failure_reason?: string };
    };
    if (typeof body.data?.status !== "string") return null;
    return {
      state: chargeState(body.data.status),
      amount: body.data.amount?.value ?? null,
      failureReason: body.data.failure_reason ?? null,
    };
  }

  /**
   * Signed over `{timestamp}.{raw body}`; an old timestamp is refused, so a captured request can't
   * be replayed later. The event type comes from the signed body: the event header is only a hint.
   */
  webhook(request: WebhookRequest): WebhookOutcome<PaymentReport> {
    const timestamp = request.header("x-webhook-timestamp");
    const signature = request.header("x-webhook-signature");
    if (timestamp === null || signature === null || !/^\d+$/.test(timestamp)) {
      return { kind: "refused" };
    }
    if (Math.abs(request.nowSeconds - Number(timestamp)) > STALE_SECONDS)
      return { kind: "refused" };
    const expected = createHmac("sha256", this.webhookSecret)
      .update(`${timestamp}.`)
      .update(request.rawBody)
      .digest("hex");
    if (!sameBytes(Buffer.from(signature), Buffer.from(expected))) return { kind: "refused" };
    const event = JSON.parse(request.rawBody.toString("utf8")) as PaymentEvent;
    const status = event.type?.startsWith("payment.") ? event.type.slice(8) : null;
    if (status === null || event.id === undefined) return { kind: "ignored" };
    return {
      kind: "report",
      report: {
        eventId: event.id,
        paymentId: event.data?.metadata?.payment_id ?? null,
        reference: event.data?.reference ?? null,
        charge: {
          state: chargeState(status),
          amount: event.data?.amount?.value ?? null,
          failureReason: event.data?.failure_reason ?? null,
        },
        currency: event.data?.amount?.currency ?? null,
      },
    };
  }
}
