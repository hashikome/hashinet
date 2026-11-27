import { describe, expect, test } from "bun:test";
import { packageCanThrottle, rateLimitFor, throttledRateLimitFor } from "./mikrotik.js";

/** The speeds RADIUS gives a session, as RouterOS reads a rate limit (ADR-0015). */

describe("rateLimitFor", () => {
  test("is up/down, in that order — RouterOS reads rate-limit as upload/download", () => {
    // Getting this backwards would silently throttle downloads to the upload figure.
    expect(rateLimitFor({ downloadSpeedMbps: 10, uploadSpeedMbps: 2 })).toBe("2M/10M");
  });

  test("mirrors the download speed when no upload is set", () => {
    expect(rateLimitFor({ downloadSpeedMbps: 5, uploadSpeedMbps: null })).toBe("5M/5M");
  });

  test.each([0, -1])("returns null for a download speed of %s, rather than a 0M cap", (speed) => {
    // "0M/0M" would be a real rule blocking everything, not an absent one.
    expect(rateLimitFor({ downloadSpeedMbps: speed, uploadSpeedMbps: null })).toBeNull();
  });
});

describe("packageCanThrottle", () => {
  test("needs a throttled download speed to mean anything", () => {
    expect(packageCanThrottle({ throttledDownloadMbps: null })).toBe(false);
  });

  test.each([0, -1])("rejects %s, which would be a block rather than a throttle", (speed) => {
    expect(packageCanThrottle({ throttledDownloadMbps: speed })).toBe(false);
  });

  test("is true once a throttled speed is set", () => {
    expect(packageCanThrottle({ throttledDownloadMbps: 2 })).toBe(true);
  });
});

describe("throttledRateLimitFor", () => {
  test("is up/down, matching rateLimitFor's argument order", () => {
    expect(throttledRateLimitFor({ throttledDownloadMbps: 2, throttledUploadMbps: 1 })).toBe(
      "1M/2M",
    );
  });

  test("mirrors the throttled download when no throttled upload is set", () => {
    // Not "leave upload uncapped" — that would let a throttled customer keep full upload.
    expect(throttledRateLimitFor({ throttledDownloadMbps: 2, throttledUploadMbps: null })).toBe(
      "2M/2M",
    );
  });

  test("returns null when the package has no throttle configured", () => {
    expect(
      throttledRateLimitFor({ throttledDownloadMbps: null, throttledUploadMbps: 5 }),
    ).toBeNull();
  });
});
