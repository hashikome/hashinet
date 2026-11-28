import {
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  WebAuthnError,
} from "@simplewebauthn/browser";
import { api } from "./api";

export const passkeysSupported = () =>
  typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";

/**
 * Signs in with a passkey; the device asks for its unlock (user verification is required). With
 * `autofill`, it waits for the person to pick a passkey from the email field's suggestions; with
 * `only`, the device offers that one passkey alone (a credential ID), as "Try it" does.
 */
export async function signInWithPasskey({
  autofill = false,
  only = null,
}: {
  autofill?: boolean;
  only?: string | null;
} = {}): Promise<void> {
  const options = await api.get<PublicKeyCredentialRequestOptionsJSON>(
    "/api/auth/passkey/generate-authenticate-options",
  );
  const { clientExtensionResults: _, ...response } = await startAuthentication({
    optionsJSON:
      only === null
        ? options
        : { ...options, allowCredentials: [{ id: only, type: "public-key" }] },
    useBrowserAutofill: autofill,
  });
  await api.post("/api/auth/passkey/verify-authentication", { response });
}

/** Stops a waiting autofill sign-in, before starting another ceremony. */
export const cancelPasskeyWait = () => WebAuthnAbortService.cancelCeremony();

/** Adds a passkey on this device, named for the device and browser so the list says which is which. */
export async function addPasskey(): Promise<void> {
  const options = await api.get<PublicKeyCredentialCreationOptionsJSON>(
    "/api/auth/passkey/generate-register-options",
  );
  const { clientExtensionResults: _, ...response } = await startRegistration({
    optionsJSON: options,
  });
  await api.post("/api/auth/passkey/verify-registration", { response, name: deviceName() });
}

/** "Chrome on macOS", from the browser's own description of itself. */
function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const system = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "this device";
  return `${browser} on ${system}`;
}

/** The person cancelled or the device refused: not worth an error message of its own. */
export const cancelled = (error: unknown) =>
  error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");

/** The device already holds a passkey for this person, and refuses a second. */
export const alreadyOnDevice = (error: unknown) =>
  error instanceof WebAuthnError && error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED";
