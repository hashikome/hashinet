import type { ProviderContext, WebhookOutcome, WebhookRequest } from "../providers.js";

/** What a provider says about a payment. Unknown states stay `pending`, never a guess. */
export interface ChargeState {
  state: "pending" | "completed" | "failed";
  /** Whole TSH; null when the provider did not say. */
  amount: number | null;
  failureReason: string | null;
}

/** A provider's webhook about a payment, in HashiNet's terms. */
export interface PaymentReport {
  /** The provider's id for this event: each is acted on once. */
  eventId: string;
  /** Our payment id, when the provider echoes it back; it can arrive before the reference. */
  paymentId: string | null;
  reference: string | null;
  charge: ChargeState;
  /** As reported; only TZS is ever accepted as paid. */
  currency: string | null;
}

/**
 * Collecting mobile money from one provider. Everything about the provider stays behind this:
 * its API, its statuses, its webhook format and signature, and which amounts it takes.
 */
export interface MobileMoneyGateway {
  /** Recorded on each payment it takes, so its checks and webhooks come back to it. */
  readonly name: string;
  /** Whether it takes this amount in whole TSH. */
  accepts(amount: number): boolean;
  /** Asks the customer's phone to approve. Rejects if the provider refuses. */
  charge(request: {
    paymentId: string;
    idempotencyKey: string;
    /** E.164, as `+255...`. */
    phone: string;
    amount: number;
  }): Promise<{ reference: string; expiresAt: Date }>;
  /** Null when the provider cannot be reached, or does not know the reference. */
  state(reference: string): Promise<ChargeState | null>;
  /** A webhook, checked over the exact bytes received. */
  webhook(request: WebhookRequest): WebhookOutcome<PaymentReport>;
}

/** Builds a provider from its own settings: null when none are set, an error when some are. */
export type MobileMoneyProvider = (context: ProviderContext) => MobileMoneyGateway | null;

/**
 * Every provider set up, and the one that takes new charges (`PAYMENTS_PROVIDER`; null while
 * mobile money is off). A payment goes back to the provider that took it, so switching strands
 * nothing in flight.
 */
export class MobileMoney {
  constructor(
    readonly active: MobileMoneyGateway | null,
    private readonly all: MobileMoneyGateway[],
  ) {}

  byName(name: string | null): MobileMoneyGateway | null {
    return this.all.find((g) => g.name === name) ?? null;
  }

  /** Whether a price can be paid online now: whole TSH the active provider takes. */
  payable(priceTsh: string): boolean {
    const amount = Number(priceTsh);
    return this.active !== null && Number.isInteger(amount) && this.active.accepts(amount);
  }
}

export const MOBILE_MONEY = Symbol("MOBILE_MONEY");
