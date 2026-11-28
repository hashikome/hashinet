import type { SmsProvider } from "../sender.js";
import { briq } from "./briq.js";
import { outbox } from "./outbox.js";

/** Every SMS provider HashiNet can use, by the name `SMS_PROVIDER` chooses. */
export const SMS_PROVIDERS: Record<string, SmsProvider> = { briq, outbox };
