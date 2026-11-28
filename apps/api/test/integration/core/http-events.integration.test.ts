import { beforeAll, describe, expect, test } from "bun:test";
import type { LogRecord } from "@logtape/logtape";
import { initializeTelemetry } from "../../../src/core/observability/telemetry.js";
import { browser, FRONTEND_ORIGIN, requestSignInCode, signInWithCode, useApi } from "../api.js";
import { useTestDatabase } from "../harness.js";
import { businessMember } from "../people.js";

const records: LogRecord[] = [];
beforeAll(async () => {
  await initializeTelemetry(
    { environment: "test", release: null, sentryDsn: null, tracesSampleRate: 0 },
    [(record) => records.push(record)],
  );
});

const t = useTestDatabase();
const api = useApi();

/** The HTTP wide events emitted since `from`, waiting briefly: they end when the socket closes. */
async function eventsSince(from: number, count: number) {
  for (let i = 0; i < 50; i++) {
    const events = records
      .slice(from)
      .map((r) => r.properties)
      .filter((p) => p.event === "http.request");
    if (events.length >= count) return events;
    await Bun.sleep(20);
  }
  throw new Error("no HTTP wide event");
}

describe("HTTP wide events", () => {
  test("every request has one, refusals included, with the route pattern and no values", async () => {
    const { membershipId: id } = await businessMember(t.db, {
      email: "m@example.com",
      name: "M",
      role: "venue_manager",
    });
    const c = browser(api);

    let from = records.length;
    await c.request("GET", "/api/venues");
    expect(await eventsSince(from, 1)).toEqual([
      expect.objectContaining({
        "http.method": "GET",
        "http.route": "/api/venues",
        "http.status_code": 401,
        outcome: "success",
      }),
    ]);

    from = records.length;
    await requestSignInCode(c, "m@example.com");
    expect((await eventsSince(from, 1))[0]).toMatchObject({
      "http.route": "/api/auth/email-otp/send-verification-otp",
      "http.status_code": 200,
    });

    await signInWithCode(api, c, "m@example.com");
    from = records.length;
    const missing = "01a18895-f25f-7622-b47d-8a428187786f";
    await c.request("GET", `/api/venues/${missing}?mac=AA:BB:CC:DD:EE:FF`);
    const [event] = await eventsSince(from, 1);
    expect(event).toMatchObject({
      "http.route": "/api/venues/:id",
      "http.status_code": 404,
      "membership.id": id,
    });
    expect(JSON.stringify(event)).not.toContain(missing);
    expect(JSON.stringify(event)).not.toContain("AA:BB");
  });
});

describe("caching", () => {
  test("answers are revalidated, never stale; voucher codes are never kept", async () => {
    const health = await fetch(`${api.url}/api/health`);
    expect(health.headers.get("cache-control")).toBe("private, no-cache");
    expect(health.headers.get("vary")).toContain("Cookie");

    await businessMember(t.db, {
      email: "musa@example.com",
      name: "Musa",
      role: "venue_operator",
    });
    const musa = browser(api);
    await signInWithCode(api, musa, "musa@example.com");
    const as = (path: string, extra: Record<string, string> = {}) =>
      fetch(`${api.url}${path}`, {
        headers: { Cookie: musa.cookieHeader(), Origin: FRONTEND_ORIGIN, ...extra },
      });
    // Unchanged since the browser last asked: a 304 with no body.
    const first = await as("/api/venues");
    const etag = first.headers.get("etag") ?? "";
    expect(etag).not.toBe("");
    expect((await as("/api/venues", { "If-None-Match": etag })).status).toBe(304);

    const codes = await as("/api/vouchers");
    expect(codes.status).toBe(200);
    expect(codes.headers.get("cache-control")).toBe("no-store");
  });
});
