import type { NextFunction, Request, RequestHandler, Response } from "express";
import { runInWideEvent, WideEvent } from "../observability/wide-event.js";
import { apiError } from "./error-envelope.js";

/**
 * One wide event per HTTP request (ADR-0002), placed before everything else so that refusals
 * by the sign-in routes, the origin check and the staff guard are recorded too. The route is
 * the matched pattern, never the raw path, so no id or query value is logged by accident.
 */
export function httpWideEvents(): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const event = new WideEvent("http.request", { "http.method": request.method });
    response.on("close", () => {
      const status = response.statusCode;
      event.set({ "http.status_code": status, "http.route": routeOf(request) });
      event.end(status >= 500 ? "failure" : "success");
    });
    runInWideEvent(event, next);
  };
}

function routeOf(request: Request): string {
  const pattern: unknown = request.route?.path;
  if (typeof pattern === "string") return `${request.baseUrl}${pattern}`;
  const path = request.path;
  // The sign-in routes are a fixed list (auth-http.ts), so their paths carry no values.
  return path.startsWith("/api/auth/") ? path : "unmatched";
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Refuses a cookie-carrying write from any origin but the web's. Session cookies go with a
 * cross-site form post that needs no preflight, so CORS alone does not stop one; Better Auth
 * checks its own routes, and this checks the rest. Requests without cookies (routers, the
 * portal's own calls) are not affected.
 */
export function requireTrustedOrigin(origins: readonly string[]): RequestHandler {
  const trusted = new Set(origins);
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.headers.origin ?? null;
    if (
      UNSAFE.has(request.method) &&
      typeof request.headers.cookie === "string" &&
      !request.path.startsWith("/api/auth/") &&
      (origin === null || !trusted.has(origin))
    ) {
      response.status(403).json(apiError("ORIGIN_NOT_ALLOWED", "This request is not allowed."));
      return;
    }
    next();
  };
}

/**
 * The router's status pages ask for a voucher's time from the router's own origin. That one
 * route answers any origin: it sets no cookie and needs the voucher code.
 */
export function guestSessionPreflight(): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== "OPTIONS" || request.path !== "/api/guest/session") {
      next();
      return;
    }
    response
      .status(204)
      .set({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
      })
      .end();
  };
}

/**
 * A browser may keep an answer but must ask before using it again: never stale, and an unchanged
 * one comes back as a 304 with no body (the ETag), which matters on a phone's connection. Private
 * and varying by cookie, so no shared cache serves one person's answer to another. A route whose
 * answer is a credential (voucher codes) says `no-store` itself, as one that is cacheable for good
 * (the portal's images) says so, and either replaces this.
 */
export function revalidateByDefault(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "private, no-cache");
    res.vary("Cookie");
    next();
  };
}
