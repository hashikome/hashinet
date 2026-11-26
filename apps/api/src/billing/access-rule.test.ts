import { describe, expect, test } from "bun:test";
import { accessByBills } from "./access-rule.js";

const bill = (dueOn: string, totalTsh: number, payments: [number, string][] = []) => ({
  dueOn,
  totalTsh,
  payments: payments.map(([amountTsh, receivedOn]) => ({ amountTsh, receivedOn })),
});
const AUGUST_LATE = bill("2026-09-07", 5_875, [[5_875, "2026-09-12"]]);
const AUGUST_ON_TIME = bill("2026-09-07", 5_875, [[5_875, "2026-09-05"]]);
const SEPTEMBER = bill("2026-10-07", 6_140);

describe("service access by a business's bills", () => {
  test("nothing overdue, or due today, leaves it enabled", () => {
    expect(accessByBills([], "2026-11-03").access).toBe("enabled");
    expect(accessByBills([SEPTEMBER], "2026-10-07").access).toBe("enabled");
    expect(
      accessByBills([bill("2026-10-07", 6_140, [[6_140, "2026-10-20"]])], "2026-11-03"),
    ).toEqual({
      access: "enabled",
    });
  });

  test("a first late bill starts a grace period that never ends in read-only", () => {
    expect(accessByBills([AUGUST_ON_TIME, SEPTEMBER], "2026-11-03")).toEqual({
      access: "grace_period",
      since: "2026-10-08",
      overdueSince: "2026-10-07",
      overdueTsh: 6_140,
      pausesOn: null,
    });
  });

  test("late before: read-only 14 days after the due date, not a day sooner", () => {
    expect(accessByBills([AUGUST_LATE, SEPTEMBER], "2026-10-20")).toMatchObject({
      access: "grace_period",
      pausesOn: "2026-10-21",
    });
    expect(accessByBills([AUGUST_LATE, SEPTEMBER], "2026-10-21")).toEqual({
      access: "read_only",
      since: "2026-10-21",
      overdueSince: "2026-10-07",
      overdueTsh: 6_140,
      pausesOn: "2026-10-21",
    });
  });

  test("a part payment leaves it overdue; what is owed counts every overdue month", () => {
    const part = bill("2026-10-07", 6_140, [[3_000, "2026-10-15"]]);
    const october = bill("2026-11-07", 6_530);
    expect(accessByBills([AUGUST_LATE, part, october], "2026-11-10")).toMatchObject({
      access: "read_only",
      overdueSince: "2026-10-07",
      overdueTsh: 3_140 + 6_530,
    });
  });

  test("paying the oldest moves the clock to the next overdue month", () => {
    const paidLate = bill("2026-10-07", 6_140, [[6_140, "2026-11-08"]]);
    const october = bill("2026-11-07", 6_530);
    // September was late, so October's lateness counts as a second time: read-only on 21 November.
    expect(accessByBills([AUGUST_ON_TIME, paidLate, october], "2026-11-21")).toMatchObject({
      access: "read_only",
      overdueSince: "2026-11-07",
    });
  });
});
