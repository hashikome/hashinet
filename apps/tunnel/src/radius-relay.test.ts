import { describe, expect, test } from "bun:test";
import type { ApiInit } from "./api.js";
import { limitInFlight, relayPacket } from "./radius-relay.js";

describe("the RADIUS relay", () => {
  test("sends the packet and its sender to the API, and returns the API's reply as it came", async () => {
    let sent: { path: string; init: ApiInit } | null = null;
    const reply = Buffer.from([2, 9, 0, 20, ...Array(16).fill(1)]);
    const out = await relayPacket(
      async (path, init = {}) => {
        sent = { path, init };
        return Response.json({ reply: reply.toString("base64") });
      },
      "secret",
      "10.88.0.7",
      new Uint8Array([1, 9, 0, 20]),
    );
    expect(Buffer.from(out ?? [])).toEqual(reply);
    expect(sent?.path).toBe("/api/internal/radius");
    expect(JSON.parse(String(sent?.init.body))).toEqual({ peer: "10.88.0.7", packet: "AQkAFA==" });
    expect(new Headers(sent?.init.headers).get("authorization")).toBe("Bearer secret");
  });

  test("a dropped request, or a refused relay, sends nothing back", async () => {
    const none = await relayPacket(
      async () => Response.json({ reply: null }),
      "s",
      "p",
      new Uint8Array(),
    );
    expect(none).toBeNull();
    const refused = await relayPacket(
      async () => new Response(null, { status: 401 }),
      "s",
      "p",
      new Uint8Array(),
    );
    expect(refused).toBeNull();
  });
});

describe("relays in flight", () => {
  test("beyond the cap a packet is dropped, and room comes back as relays finish", async () => {
    const run = limitInFlight(2);
    const finish: (() => void)[] = [];
    const job = () =>
      new Promise<void>((done) => {
        finish.push(done);
      });
    expect(run(job)).toBe(true);
    expect(run(job)).toBe(true);
    expect(run(job)).toBe(false);
    finish[0]?.();
    await Bun.sleep(0);
    expect(run(job)).toBe(true);
  });
});
