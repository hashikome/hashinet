import { afterAll, describe, expect, test } from "bun:test";
import { R2BrandStore } from "./brand-store.js";

/** Stands in for R2: what matters here is what is asked of it, signed, at which address. */
const objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; type: string | null }>();
const seen: string[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const { pathname, searchParams } = new URL(request.url);
    seen.push(`${request.method} ${pathname} ${request.headers.has("authorization")}`);
    if (request.method === "GET" && searchParams.get("list-type") === "2") {
      // Two pages, as a bucket with many files answers.
      const second = searchParams.get("continuation-token") === "next";
      const keys = [...objects.keys()].map((k) => k.replace("/hashinet/", ""));
      const page = second ? keys.slice(1) : keys.slice(0, 1);
      const items = page
        .map(
          (k) =>
            `<Contents><Key>${k}</Key><LastModified>2026-11-01T10:00:00.000Z</LastModified></Contents>`,
        )
        .join("");
      const more = second
        ? "<IsTruncated>false</IsTruncated>"
        : "<IsTruncated>true</IsTruncated><NextContinuationToken>next</NextContinuationToken>";
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>hashinet</Name>${more}${items}</ListBucketResult>`,
        { headers: { "Content-Type": "application/xml" } },
      );
    }
    const object = objects.get(pathname) ?? null;
    if (request.method === "PUT") {
      objects.set(pathname, {
        bytes: new Uint8Array(await request.arrayBuffer()),
        type: request.headers.get("content-type"),
      });
      return new Response(null, { status: 200 });
    }
    if (request.method === "DELETE") {
      objects.delete(pathname);
      return new Response(null, { status: 204 });
    }
    if (object === null) return new Response(null, { status: 404 });
    return new Response(request.method === "HEAD" ? null : object.bytes, {
      headers: { "Content-Length": String(object.bytes.length) },
    });
  },
});

afterAll(() => server.stop(true));

const store = new R2BrandStore({
  endpoint: `http://127.0.0.1:${server.port}`,
  bucket: "hashinet",
  accessKeyId: "key",
  secretAccessKey: "secret",
});

describe("R2BrandStore", () => {
  test("stores, reads and removes a file in the bucket, with signed requests", async () => {
    const key = "venue/logo-0123456789abcdef.webp";
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await store.get(key)).toBeNull();
    await store.put(key, bytes);
    expect(objects.get(`/hashinet/${key}`)?.type).toBe("image/webp");
    expect(await store.get(key)).toEqual(bytes);
    await store.remove(key);
    expect(await store.get(key)).toBeNull();
    expect(seen.every((line) => line.endsWith("true"))).toBe(true);
  });

  test("lists every file across pages, with when it was written", async () => {
    await store.put("a/logo-0000000000000001.webp", new Uint8Array([1]));
    await store.put("b/background-0000000000000002.webp", new Uint8Array([2]));
    const listed = await store.list();
    expect(listed.map((f) => f.key).sort()).toEqual([
      "a/logo-0000000000000001.webp",
      "b/background-0000000000000002.webp",
    ]);
    expect(listed[0]?.at.toISOString()).toBe("2026-11-01T10:00:00.000Z");
  });
});
