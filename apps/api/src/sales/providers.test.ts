import { describe, expect, test } from "bun:test";
import { MobileMoney } from "./payments/gateway.js";
import { MOBILE_MONEY_PROVIDERS } from "./payments/providers/index.js";
import { chooseProviders, type ProviderContext } from "./providers.js";
import { SMS_PROVIDERS } from "./sms/providers/index.js";

function context(settings: Record<string, string>, production = false) {
  return {
    setting: (name: string) => settings[name] ?? null,
    production,
    appUrl: "https://api.example",
    dataDir: "/tmp/hashinet-data",
  } satisfies Omit<ProviderContext, "chosen">;
}

const SNIPPE = { SNIPPE_API_KEY: "key", SNIPPE_WEBHOOK_SECRET: "secret" };
const pay = (chosen: string | null, settings: Record<string, string>, production = false) =>
  chooseProviders(
    MOBILE_MONEY_PROVIDERS,
    chosen,
    "PAYMENTS_PROVIDER",
    context(settings, production),
  );

describe("choosing providers", () => {
  test("off until one is chosen, and nothing is built without its settings", () => {
    expect(pay(null, {})).toEqual({ active: null, all: [] });
    expect(chooseProviders(SMS_PROVIDERS, null, "SMS_PROVIDER", context({}))).toEqual({
      active: null,
      all: [],
    });
  });

  test("the chosen one takes new charges; another set up stays built to finish its own", () => {
    const { active, all } = pay("fake", SNIPPE);
    expect(active?.name).toBe("fake");
    expect(all.map((g) => g.name).sort()).toEqual(["fake", "snippe"]);
    const mobileMoney = new MobileMoney(active, all);
    expect(mobileMoney.byName("snippe")?.name).toBe("snippe");
    expect(mobileMoney.byName("gone")).toBeNull();
  });

  test("half a provider's settings, or a chosen one with none, stops startup naming the rest", () => {
    expect(() => pay(null, { SNIPPE_API_KEY: "key" })).toThrow(/SNIPPE_WEBHOOK_SECRET/);
    expect(() => pay("snippe", {})).toThrow(/SNIPPE_API_KEY/);
    expect(() =>
      chooseProviders(SMS_PROVIDERS, null, "SMS_PROVIDER", context({ BRIQ_API_KEY: "key" })),
    ).toThrow(/BRIQ_SENDER_ID/);
  });

  test("an unknown name is refused, listing the providers there are", () => {
    expect(() => pay("acme", {})).toThrow(/"acme" is not one of snippe, fake/);
  });

  test("the stand-ins can never run in production", () => {
    expect(() => pay("fake", {}, true)).toThrow(/fake is refused in production/);
    expect(() =>
      chooseProviders(SMS_PROVIDERS, "outbox", "SMS_PROVIDER", context({}, true)),
    ).toThrow(/outbox is refused in production/);
  });

  test("a price is payable online only in whole TSH the active provider takes", () => {
    const { active, all } = pay("snippe", SNIPPE);
    const on = new MobileMoney(active, all);
    expect(on.payable("500")).toBe(true);
    expect(on.payable("499")).toBe(false);
    expect(on.payable("1500.50")).toBe(false);
    expect(new MobileMoney(null, all).payable("5000")).toBe(false);
  });
});
