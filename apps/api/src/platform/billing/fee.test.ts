import { describe, expect, test } from "bun:test";
import { feeOnSales, servedShare, venueFee } from "./fee.js";

const TERMS = { rateBp: 500, lowerRateBp: 250, lowerRateAboveTsh: 2_000_000, minimumTsh: 5_000 };

describe("the fee on a venue's net sales", () => {
  test("5% of each sale, 2.5% on the part above TSh 2,000,000, as ADR-0013 works it", () => {
    expect(feeOnSales(500, TERMS)).toBe(25);
    expect(feeOnSales(100_000, TERMS)).toBe(5_000);
    expect(feeOnSales(2_000_000, TERMS)).toBe(100_000);
    expect(feeOnSales(4_000_000, TERMS)).toBe(150_000);
  });

  test("bands are marginal: one more voucher never lowers the total", () => {
    for (let sales = 1_990_000; sales <= 2_010_000; sales += 500) {
      expect(feeOnSales(sales + 500, TERMS)).toBeGreaterThanOrEqual(feeOnSales(sales, TERMS));
    }
  });

  test("a month refunding more than it sold pays nothing", () => {
    expect(feeOnSales(-3_000, TERMS)).toBe(0);
  });
});

describe("a venue's month", () => {
  test("the minimum lifts a small month, prorated by the share a router served it", () => {
    expect(venueFee({ netSalesTsh: 20_000, servedShare: 1 }, TERMS)).toEqual({
      feeTsh: 5_000,
      minimumTsh: 5_000,
    });
    // Down 10 days of 30: two thirds of the minimum.
    expect(venueFee({ netSalesTsh: 0, servedShare: 20 / 30 }, TERMS)).toEqual({
      feeTsh: 3_333,
      minimumTsh: 3_333,
    });
    // Above the minimum, the minimum plays no part.
    expect(venueFee({ netSalesTsh: 200_000, servedShare: 1 }, TERMS)).toEqual({
      feeTsh: 10_000,
      minimumTsh: null,
    });
  });

  test("before its first full month, or with no router set up, only the 5%", () => {
    expect(venueFee({ netSalesTsh: 20_000, servedShare: null }, TERMS)).toEqual({
      feeTsh: 1_000,
      minimumTsh: null,
    });
  });
});

describe("the share of a month a router served", () => {
  const day = (d: number, h = 0) => new Date(Date.UTC(2026, 10, d, h));
  const from = day(1);
  const to = day(31);
  const after = day(31, 12);

  test("no outage is the whole month; ten days down is two thirds", () => {
    expect(servedShare(from, to, [[]], after)).toBe(1);
    expect(servedShare(from, to, [[{ start: day(5), end: day(15) }]], after)).toBeCloseTo(2 / 3);
  });

  test("a venue is down only while all its routers are", () => {
    const one = [{ start: day(5), end: day(15) }];
    const two = [{ start: day(10), end: day(20) }];
    // Down together from the 10th to the 15th: 5 days of 30.
    expect(servedShare(from, to, [one, two], after)).toBeCloseTo(25 / 30);
  });

  test("an outage still going runs to now; one before the month counts only its part in it", () => {
    expect(servedShare(from, to, [[{ start: day(25), end: null }]], after)).toBeCloseTo(24 / 30);
    expect(
      servedShare(from, to, [[{ start: new Date(Date.UTC(2026, 9, 28)), end: day(4) }]], after),
    ).toBeCloseTo(27 / 30);
  });

  test("with no router, never served", () => {
    expect(servedShare(from, to, [], after)).toBe(0);
  });
});
