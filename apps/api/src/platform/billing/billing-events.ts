import { Injectable } from "@nestjs/common";
import { captureFailure } from "../../core/observability/telemetry.js";

type Listener = (businessId: string) => Promise<void>;

/**
 * What billing tells the rest of the API, without depending on it: a payment recorded on a
 * business, which can open what it paid for (an extra site). A listener's failure is reported, not
 * the payment's.
 */
@Injectable()
export class BillingEvents {
  private readonly paidListeners: Listener[] = [];

  onPaid(listener: Listener): void {
    this.paidListeners.push(listener);
  }

  async paid(businessId: string): Promise<void> {
    for (const listener of this.paidListeners) {
      await listener(businessId).catch(captureFailure);
    }
  }
}
