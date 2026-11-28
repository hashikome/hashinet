import { describe, expect, test } from "bun:test";
import { dialectFor } from "./dialect.js";
import type { RouterProfile } from "./probe.js";

/**
 * `dialect.ts` is the ONLY place version/stack command differences belong, so this suite pins the
 * differences that were learned from real hardware rather than from documentation.
 */

const profile = (over: Partial<RouterProfile> = {}): RouterProfile =>
  ({
    identity: "test",
    boardName: "hAP lite",
    version: "7.23.2 (stable)",
    architecture: "smips",
    versionMajor: 7,
    versionMinor: 23,
    wirelessStack: "wireless",
    interfaces: [],
    addresses: [],
    capabilities: { hotspot: true, toolFetch: true, hotspotLogin: true },
    warnings: [],
    compatibility: "compatible",
    ...over,
  }) as unknown as RouterProfile;

describe("radio menus per wireless stack", () => {
  test("legacy boards use /interface wireless with top-level properties", () => {
    const d = dialectFor(profile({ wirelessStack: "wireless" }));
    expect(d.radio).toEqual({
      menu: "/interface/wireless",
      ssidField: "ssid",
      modeField: "mode",
      // ap-bridge, not `ap` — `ap` is a legacy alias that does not bridge clients.
      modeValue: "ap-bridge",
      runningCheckField: "disable-running-check",
      // Its own profile for the guest radio; `default` is never changed.
      open: {
        kind: "profile",
        menu: "/interface/wireless/security-profiles",
        profile: "wbs-open",
      },
    });
  });

  test("wifiwave2 boards nest them under configuration.*", () => {
    const d = dialectFor(profile({ wirelessStack: "wifi" }));
    expect(d.radio).toEqual({
      menu: "/interface/wifi",
      ssidField: "configuration.ssid",
      modeField: "configuration.mode",
      modeValue: "ap",
      // No equivalent property on this stack.
      runningCheckField: null,
      // Set on the interface, which wins over any profile the owner's own WiFi shares.
      open: { kind: "interface", field: "security.authentication-types" },
    });
  });

  test("a board with no radio has no radio dialect", () => {
    // hEX, CRS — the hotspot then runs on ethernet or a bridge the admin names explicitly.
    expect(dialectFor(profile({ wirelessStack: undefined })).radio).toBeNull();
  });
});

describe("disable-running-check", () => {
  /**
   * Only legacy `/interface wireless` has this. It matters because on that stack an AP in
   * `ap-bridge` mode reports `running=false` while it is beaconing to nobody, `/ip dhcp-server`
   * copies that flag into its own `invalid`, and a perfectly working hotspot reads as broken until
   * the first phone associates. Measured on an hAP lite (7.23.2) on 2026-08-12.
   */
  test("is offered on legacy wireless and withheld on wifiwave2", () => {
    expect(dialectFor(profile({ wirelessStack: "wireless" })).radio?.runningCheckField).toBe(
      "disable-running-check",
    );
    expect(dialectFor(profile({ wirelessStack: "wifi" })).radio?.runningCheckField).toBeNull();
  });
});
