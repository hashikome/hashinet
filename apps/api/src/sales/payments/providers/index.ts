import type { MobileMoneyProvider } from "../gateway.js";
import { fake } from "./fake.js";
import { snippe } from "./snippe.js";

/** Every mobile money provider HashiNet can use, by the name `PAYMENTS_PROVIDER` chooses. */
export const MOBILE_MONEY_PROVIDERS: Record<string, MobileMoneyProvider> = { snippe, fake };
