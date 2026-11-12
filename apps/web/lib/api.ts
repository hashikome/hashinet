import type { ApiError } from "@hashinet/types";

/** The API's origin. Empty means the page's own origin, as in production. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4006";

/** A failed API call: its status, stable code, message, and any per-field problems. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, string> | null,
  ) {
    super(message);
  }
}

function errorFrom(status: number, body: unknown): ApiRequestError {
  const error = (typeof body === "object" && body !== null ? body : {}) as Partial<ApiError>;
  return new ApiRequestError(
    status,
    typeof error.code === "string" ? error.code : "ERROR",
    typeof error.message === "string" ? error.message : "Something went wrong. Try again.",
    error.details ?? null,
  );
}

async function request<T>(method: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    ...(body === null
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const json = (response.headers.get("content-type") ?? "").includes("application/json");
  const parsed: unknown = text === "" ? null : json ? JSON.parse(text) : text;
  if (!response.ok) throw errorFrom(response.status, parsed);
  return parsed as T;
}

/** The one way the web reaches the API. Response types come from `@hashinet/types`. */
export const api = {
  get: <T>(path: string) => request<T>("GET", path, null),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>("PUT", path, body),
  delete: <T = null>(path: string) => request<T>("DELETE", path, null),
  /** A download the API makes, such as a CSV, saved under the name it gives. */
  async download(path: string, fallbackName: string): Promise<void> {
    const response = await fetch(`${API_URL}${path}`, { credentials: "include" });
    if (!response.ok) throw errorFrom(response.status, await response.json().catch(() => null));
    const name =
      /filename="?([^";]+)"?/.exec(response.headers.get("content-disposition") ?? "")?.[1] ??
      fallbackName;
    const url = URL.createObjectURL(await response.blob());
    const link = Object.assign(document.createElement("a"), { href: url, download: name });
    link.click();
    URL.revokeObjectURL(url);
  },
};

/** The message to show for a failed call, whatever was thrown. */
export function messageOf(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.";
}
