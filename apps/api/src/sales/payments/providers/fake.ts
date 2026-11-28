import type { WebhookOutcome } from "../../providers.js";
import type {
  ChargeState,
  MobileMoneyGateway,
  MobileMoneyProvider,
  PaymentReport,
} from "../gateway.js";

/** The stand-in, only when chosen (`PAYMENTS_PROVIDER=fake`), and never in production. */
export const fake: MobileMoneyProvider = (context) => {
  if (!context.chosen) return null;
  if (context.production) {
    throw new Error("Invalid configuration:\n  PAYMENTS_PROVIDER: fake is refused in production");
  }
  return new FakeGateway();
};

/**
 * Development only, refused in production by the configuration: "approves" a few seconds after
 * the charge, so a whole purchase can be walked without a provider. A number ending in 0000
 * declines and one ending in 1111 never answers, to show those paths.
 */
class FakeGateway implements MobileMoneyGateway {
  readonly name = "fake";

  private readonly charges = new Map<
    string,
    { at: number; amount: number; declines: boolean; silent: boolean }
  >();

  constructor(private readonly approvalMs = 6_000) {}

  async charge(request: Parameters<MobileMoneyGateway["charge"]>[0]) {
    const reference = `fake-${request.paymentId}`;
    this.charges.set(reference, {
      at: Date.now(),
      amount: request.amount,
      declines: request.phone.endsWith("0000"),
      silent: request.phone.endsWith("1111"),
    });
    return { reference, expiresAt: new Date(Date.now() + 4 * 3_600_000) };
  }

  async state(reference: string): Promise<ChargeState | null> {
    const charge = this.charges.get(reference) ?? null;
    if (charge === null) return null;
    if (charge.silent || Date.now() - charge.at < this.approvalMs) {
      return { state: "pending", amount: charge.amount, failureReason: null };
    }
    return charge.declines
      ? { state: "failed", amount: charge.amount, failureReason: "Declined" }
      : { state: "completed", amount: charge.amount, failureReason: null };
  }

  accepts(amount: number): boolean {
    return amount >= 500;
  }

  /** It has no webhooks: the guest's waiting screen asks it. */
  webhook(): WebhookOutcome<PaymentReport> {
    return { kind: "refused" };
  }
}
