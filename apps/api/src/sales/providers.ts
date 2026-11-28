/**
 * What payment and SMS providers share: how one is built from its own settings, how its webhooks
 * reach it, and how the one in use is chosen. A provider is one file under the area's
 * `providers/`; nothing outside it knows its name, its settings or its formats.
 */

/** What a provider is built from. */
export interface ProviderContext {
  /** A setting by name, honouring `<NAME>_FILE` (docs/SECURITY.md, Credentials); null if unset. */
  setting(name: string): string | null;
  /** Whether this provider is the one chosen, so it must be fully set up. */
  chosen: boolean;
  production: boolean;
  /** The API's public origin, for callback URLs. */
  appUrl: string;
  /** `data/` at the repository root, for development stand-ins. */
  dataDir: string;
}

/** A webhook as received: the exact bytes, for the signature, and its headers. */
export interface WebhookRequest {
  rawBody: Buffer;
  /** A header by its lower-case name; null if absent. */
  header(name: string): string | null;
  nowSeconds: number;
}

/** Refused: the signature does not hold. Ignored: signed, but nothing HashiNet acts on. */
export type WebhookOutcome<T> =
  | { kind: "refused" }
  | { kind: "ignored" }
  | { kind: "report"; report: T };

/**
 * The settings a provider needs, all or none: null when none are set (it isn't set up), the values
 * when all are, and a startup error naming what is missing otherwise, or when it is chosen and
 * nothing is set.
 */
export function settingsOf<K extends string>(
  context: ProviderContext,
  names: readonly K[],
  why: string,
): Record<K, string> | null {
  const values = names.map((n) => [n, context.setting(n)] as const);
  const missing = values.filter(([, v]) => v === null).map(([n]) => n);
  if (missing.length === names.length && !context.chosen) return null;
  if (missing.length > 0) {
    const need = missing.length === names.length ? "needed" : "also needed";
    throw new Error(
      `Invalid configuration:\n  ${missing.map((n) => `${n}: is ${need} ${why}`).join("\n  ")}`,
    );
  }
  return Object.fromEntries(values) as Record<K, string>;
}

/**
 * Builds every provider whose settings are present, and picks the chosen one (`variable` names
 * the setting, such as `PAYMENTS_PROVIDER`); an unknown choice is a startup error.
 */
export function chooseProviders<G extends { name: string }>(
  providers: Record<string, (context: ProviderContext) => G | null>,
  chosen: string | null,
  variable: string,
  base: Omit<ProviderContext, "chosen">,
): { active: G | null; all: G[] } {
  if (chosen !== null && !(chosen in providers)) {
    throw new Error(
      `Invalid configuration:\n  ${variable}: "${chosen}" is not one of ${Object.keys(providers).join(", ")}`,
    );
  }
  const all = Object.entries(providers).flatMap(([name, make]) => {
    const built = make({ ...base, chosen: name === chosen });
    return built === null ? [] : [built];
  });
  return { active: all.find((g) => g.name === chosen) ?? null, all };
}
