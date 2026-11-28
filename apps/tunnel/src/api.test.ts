import { afterAll, describe, expect, test } from "bun:test";
import { apiAt, apiThrough } from "./api.js";

const seen: { url: string; host: string | null }[] = [];
const server = Bun.serve({
  port: 0,
  fetch(request) {
    seen.push({ url: request.url, host: request.headers.get("host") });
    return Response.json({ ok: true });
  },
});
afterAll(() => server.stop(true));

describe("reaching the API", () => {
  test("at an origin, the path goes where the origin says", async () => {
    const api = apiAt(`http://127.0.0.1:${server.port}`);
    expect((await api("/api/health")).status).toBe(200);
    expect(seen.at(-1)?.url).toBe(`http://127.0.0.1:${server.port}/api/health`);
  });

  test("through an address, TLS is asked of the public host, never skipped", async () => {
    // The stand-in speaks plain HTTP: a TLS client must refuse it rather than fall back.
    const api = apiThrough(`127.0.0.1:${server.port}`, "https://hashinet.example");
    const before = seen.length;
    expect(api("/api/health")).rejects.toThrow();
    await Bun.sleep(100);
    expect(seen.length).toBe(before);
  });
});
