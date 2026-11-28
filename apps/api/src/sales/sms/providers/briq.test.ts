import { afterAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { BriqSmsSender } from "./briq.js";

const seen: { path: string; headers: Headers; body: unknown }[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    seen.push({
      path: new URL(request.url).pathname,
      headers: request.headers,
      body: await request.json(),
    });
    return Response.json(answer.body, { status: answer.status });
  },
});

afterAll(() => server.stop(true));

const sender = new BriqSmsSender(
  "key",
  "app",
  "HASHINET",
  "hook-secret",
  `http://127.0.0.1:${server.port}`,
);
const message = { to: "+255712345678", text: "Your code" };

describe("BriqSmsSender", () => {
  test("sends as the provider documents it, and keeps the job", async () => {
    answer = { status: 200, body: { success: true, job_id: "job-1" } };
    expect(await sender.send(message)).toEqual({ jobId: "job-1" });
    const request = seen.at(-1);
    expect(request?.path).toBe("/v1/message/send-instant");
    expect(request?.headers.get("x-api-key")).toBe("key");
    expect(request?.headers.get("x-app-id")).toBe("app");
    expect(request?.body).toEqual({
      content: "Your code",
      recipients: ["+255712345678"],
      sender_id: "HASHINET",
    });
  });

  test("no job means not sent: nothing could ever confirm it", async () => {
    answer = { status: 200, body: { success: true } };
    expect(sender.send(message)).rejects.toThrow("refused");
    answer = { status: 422, body: { success: false } };
    expect(sender.send(message)).rejects.toThrow("refused");
  });
});

describe("BRIQ's delivery reports", () => {
  const signed = (event: unknown, secret = "hook-secret") => {
    const raw = Buffer.from(JSON.stringify(event));
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    return {
      rawBody: raw,
      nowSeconds: 0,
      header: (name: string) => (name === "x-briq-signature" ? signature : null),
    };
  };

  test("a signed report is read in HashiNet's terms", () => {
    const outcome = sender.webhook(
      signed({ id: "e1", event: "sms.expired", data: { job_id: "job-1", message_id: "m-1" } }),
    );
    expect(outcome).toEqual({
      kind: "report",
      report: { eventId: "e1", status: "failed", jobId: "job-1", messageId: "m-1" },
    });
  });

  test("another secret is refused; an event it doesn't map is ignored", () => {
    expect(sender.webhook(signed({ id: "e1" }, "other")).kind).toBe("refused");
    expect(
      sender.webhook(signed({ id: "e2", event: "sms.queued", data: { job_id: "j" } })).kind,
    ).toBe("ignored");
  });
});
