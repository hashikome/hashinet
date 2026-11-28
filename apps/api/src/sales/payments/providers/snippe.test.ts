import { afterAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { chargeState, SnippeGateway } from "./snippe.js";

/** Stands in for the provider: what matters here is exactly what is sent, and read back. */
const seen: { path: string; headers: Headers; body: unknown }[] = [];
let answer: { status: number; body: unknown } = { status: 201, body: {} };

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    seen.push({
      path: new URL(request.url).pathname,
      headers: request.headers,
      body: request.method === "POST" ? await request.json() : null,
    });
    return Response.json(answer.body, { status: answer.status });
  },
});

afterAll(() => server.stop(true));

const gateway = new SnippeGateway(
  "secret-key",
  "hook-secret",
  "https://api.example/webhooks/payments/snippe",
  `http://127.0.0.1:${server.port}`,
);

describe("SnippeGateway", () => {
  test("asks for a payment as the provider documents it", async () => {
    answer = {
      status: 201,
      body: { data: { reference: "ref-1", expires_at: "2026-11-01T05:00:00.000Z" } },
    };
    const charge = await gateway.charge({
      paymentId: "pay-1",
      idempotencyKey: "abc",
      phone: "+255712345678",
      amount: 1000,
    });
    expect(charge).toEqual({
      reference: "ref-1",
      expiresAt: new Date("2026-11-01T05:00:00.000Z"),
    });
    const request = seen.at(-1);
    expect(request?.path).toBe("/v1/payments");
    expect(request?.headers.get("authorization")).toBe("Bearer secret-key");
    expect(request?.headers.get("idempotency-key")).toBe("abc");
    expect(request?.body).toMatchObject({
      payment_type: "mobile",
      details: { amount: 1000, currency: "TZS" },
      phone_number: "255712345678",
      customer: { firstname: "WiFi", lastname: "Guest", email: "guest@hashikome.com" },
      webhook_url: "https://api.example/webhooks/payments/snippe",
      metadata: { payment_id: "pay-1" },
    });
  });

  test("a refusal rejects, rather than looking like a payment", async () => {
    answer = { status: 400, body: { message: "validation_error" } };
    const charge = gateway.charge({
      paymentId: "p",
      idempotencyKey: "k",
      phone: "+255712345678",
      amount: 1000,
    });
    expect(charge).rejects.toThrow("refused");
  });

  test("reads a payment back", async () => {
    answer = {
      status: 200,
      body: { data: { status: "completed", amount: { value: 1000, currency: "TZS" } } },
    };
    expect(await gateway.state("ref-1")).toEqual({
      state: "completed",
      amount: 1000,
      failureReason: null,
    });
    expect(seen.at(-1)?.path).toBe("/v1/payments/ref-1");
    answer = { status: 404, body: {} };
    expect(await gateway.state("nope")).toBeNull();
  });

  test("a status it does not know stays pending, never a guess", () => {
    expect(chargeState("completed")).toBe("completed");
    for (const status of ["failed", "expired", "voided", "cancelled"]) {
      expect(chargeState(status)).toBe("failed");
    }
    expect(chargeState("pending")).toBe("pending");
    expect(chargeState("something-new")).toBe("pending");
  });
});

describe("Snippe's webhooks", () => {
  const now = 1_800_000_000;
  const body = (event: unknown) => Buffer.from(JSON.stringify(event));
  const signed = (raw: Buffer, stamp = now, secret = "hook-secret") => ({
    rawBody: raw,
    nowSeconds: now,
    header: (name: string) =>
      ({
        "x-webhook-timestamp": String(stamp),
        "x-webhook-signature": createHmac("sha256", secret)
          .update(`${stamp}.`)
          .update(raw)
          .digest("hex"),
      })[name] ?? null,
  });
  const completed = body({
    id: "evt_1",
    type: "payment.completed",
    data: {
      reference: "ref-1",
      amount: { value: 2000, currency: "TZS" },
      metadata: { payment_id: "pay-1" },
    },
  });

  test("a signed report is read in HashiNet's terms", () => {
    expect(gateway.webhook(signed(completed))).toEqual({
      kind: "report",
      report: {
        eventId: "evt_1",
        paymentId: "pay-1",
        reference: "ref-1",
        charge: { state: "completed", amount: 2000, failureReason: null },
        currency: "TZS",
      },
    });
  });

  test("another secret, an old timestamp or no signature is refused", () => {
    expect(gateway.webhook(signed(completed, now, "other")).kind).toBe("refused");
    expect(gateway.webhook(signed(completed, now - 301)).kind).toBe("refused");
    expect(gateway.webhook({ rawBody: completed, nowSeconds: now, header: () => null }).kind).toBe(
      "refused",
    );
  });

  test("a signed event that isn't about a payment is ignored", () => {
    expect(gateway.webhook(signed(body({ id: "evt_2", type: "payout.done" }))).kind).toBe(
      "ignored",
    );
  });
});
