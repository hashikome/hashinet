import { describe, expect, test } from "bun:test";
import { normalMac } from "../utils/mac.js";
import { askOf, comesBack, terms, type VoucherFacts } from "./access-decision.js";

const NOW = new Date("2026-11-28T10:00:00Z");
const MAC = "52:54:00:4A:00:10";

const voucher = (over: Partial<VoucherFacts> = {}): VoucherFacts => ({
  id: "v1",
  expiresAt: new Date(NOW.getTime() + 3_600_000),
  deviceLimit: 1,
  dataLimitGb: null,
  usedBytes: 0n,
  blocked: false,
  speed: {
    downloadSpeedMbps: 5,
    uploadSpeedMbps: 2,
    throttledDownloadMbps: 1,
    throttledUploadMbps: null,
    peakStartHour: null,
    peakEndHour: null,
    throttleAfterGb: 2,
  },
  ...over,
});

describe("what a request asks", () => {
  test("a MAC login names the calling station; the API's sign-in sends the code twice", () => {
    expect(askOf("52:54:00:4a:00:10", MAC, null)).toEqual({ kind: "mac", mac: MAC });
    expect(askOf("482716936518", MAC, "482716936518")).toEqual({
      kind: "code",
      code: "482716936518",
      mac: MAC,
    });
  });

  test("a code without its password, or with no station, is not a sign-in", () => {
    expect(askOf("482716936518", MAC, "other")).toEqual({ kind: "unknown" });
    expect(askOf("482716936518", MAC, null)).toEqual({ kind: "unknown" });
    expect(askOf("482716936518", null, "482716936518")).toEqual({ kind: "unknown" });
  });

  test("addresses are kept upper-case and colon-separated", () => {
    expect(normalMac("52-54-00-4a-00-10")).toBe(MAC);
    expect(normalMac("525400")).toBeNull();
  });
});

describe("the terms of a place", () => {
  test("time left from HashiNet, at the package's speed", () => {
    expect(terms(voucher(), NOW)).toEqual({
      accept: true,
      voucherId: "v1",
      sessionSeconds: 3600,
      rateLimit: "2M/5M",
      throttled: false,
    });
  });

  test("throttled past the package's data or in its peak hours; refused past its cap", () => {
    expect(terms(voucher({ usedBytes: 2n * 1024n ** 3n }), NOW)).toMatchObject({
      accept: true,
      rateLimit: "1M/1M",
      throttled: true,
    });
    const v = voucher();
    // 10:00 UTC is 13:00 in Dar es Salaam.
    const peak = voucher({ speed: { ...v.speed, peakStartHour: 12, peakEndHour: 14 } });
    expect(terms(peak, NOW)).toMatchObject({ throttled: true });
    expect(terms(voucher({ dataLimitGb: 1, usedBytes: 1024n ** 3n }), NOW)).toEqual({
      accept: false,
      reason: "data_used",
    });
  });

  test("expired, not started or blocked is refused", () => {
    expect(terms(voucher({ expiresAt: NOW }), NOW)).toEqual({ accept: false, reason: "expired" });
    expect(terms(voucher({ expiresAt: null }), NOW)).toEqual({
      accept: false,
      reason: "not_started",
    });
    expect(terms(voucher({ blocked: true }), NOW)).toEqual({
      accept: false,
      reason: "voucher_blocked",
    });
  });
});

describe("a device coming back by its address", () => {
  test("it takes a free place, or the one it holds", () => {
    expect(comesBack(voucher(), [], MAC, NOW)).toMatchObject({ accept: true });
    expect(comesBack(voucher(), [{ mac: MAC }], MAC, NOW)).toMatchObject({ accept: true });
  });

  test("it never takes a place another device holds: the portal asks for the PIN", () => {
    expect(comesBack(voucher(), [{ mac: "AA:AA:AA:AA:AA:AA" }], MAC, NOW)).toEqual({
      accept: false,
      reason: "in_use",
    });
    expect(
      comesBack(voucher({ deviceLimit: 2 }), [{ mac: "AA:AA:AA:AA:AA:AA" }], MAC, NOW),
    ).toMatchObject({ accept: true });
  });
});
