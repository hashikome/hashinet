/**
 * Board/firmware differences, in one place.
 *
 * The rest of the provisioner is written against logical operations ("set the SSID",
 * "write a file"); this module decides which RouterOS commands actually implement them
 * on the board in front of us. When a new MikroTik generation changes a menu path, this
 * is the only file that should need editing.
 */

import type { RouterProfile } from "./probe.js";

type FileWriteStrategy = "file-contents" | "tool-fetch" | "manual";

/**
 * How to talk to this board's radio.
 *
 * The two stacks disagree on more than the menu path: legacy takes `ssid=` and
 * `mode=ap-bridge` as top-level properties, wifiwave2 nests them under `configuration.`.
 * Steps ask for "set the SSID" and this decides what that means.
 */
export interface RadioDialect {
  menu: string;
  /** Property holding the network name — `ssid` or `configuration.ssid`. */
  ssidField: string;
  /** Property/value that puts the radio into access-point mode. */
  modeField: string;
  modeValue: string;
  /**
   * Property that stops the interface's `running` flag tracking associated clients, or null where
   * the stack has no such knob. Legacy `/interface wireless` in AP mode reports `running=false`
   * while it is beaconing to nobody, and `/ip dhcp-server` copies that flag and marks itself
   * `invalid` — a working hotspot that reads as broken until the first phone connects. wifiwave2
   * has no equivalent property, hence nullable.
   */
  runningCheckField: string | null;
  /** How the guest radio is made open, with no password (`hotspot-radio-open`). */
  open: OpenRadio;
}

/**
 * A guest network has no password: the portal and the voucher control access (owner, 25 November
 * 2026). The wifi package sets authentication on the interface itself, which takes priority over
 * any profile ("1. Value in interface settings", MikroTik's WiFi documentation), so a profile the
 * owner's own WiFi shares is never touched. Legacy wireless takes a security profile: setup gives
 * the guest radio one of its own with `mode=none`, and never changes `default`.
 */
type OpenRadio =
  | { kind: "interface"; field: string }
  | { kind: "profile"; menu: string; profile: string };

export interface Dialect {
  /** Menu for radio interfaces, or null on boards with no wireless (hEX, CRS…) */
  wirelessMenu: string | null;
  /** null on boards with no radio — the hotspot then runs on ethernet/bridge. */
  radio: RadioDialect | null;
  /** How to get login.html onto the device */
  fileWrite: FileWriteStrategy;
}

export function dialectFor(profile: RouterProfile): Dialect {
  const { capabilities, wirelessStack } = profile;

  const wirelessMenu =
    wirelessStack === "wifi"
      ? "/interface/wifi"
      : wirelessStack === "wireless"
        ? "/interface/wireless"
        : null;

  const radio: RadioDialect | null =
    wirelessStack === "wifi"
      ? {
          menu: "/interface/wifi",
          ssidField: "configuration.ssid",
          modeField: "configuration.mode",
          modeValue: "ap",
          runningCheckField: null,
          open: { kind: "interface", field: "security.authentication-types" },
        }
      : wirelessStack === "wireless"
        ? {
            menu: "/interface/wireless",
            ssidField: "ssid",
            modeField: "mode",
            // ap-bridge, not `ap` — `ap` is a legacy alias that does not bridge clients.
            modeValue: "ap-bridge",
            runningCheckField: "disable-running-check",
            open: {
              kind: "profile",
              menu: "/interface/wireless/security-profiles",
              profile: "wbs-open",
            },
          }
        : null;

  // ALWAYS prefer /tool fetch, on every version.
  //
  // RouterOS 7 does accept `/file/add contents=...`, but it SILENTLY TRUNCATES: pushing a
  // 19,321-byte alogin.html landed 18,651 bytes with no error reported. The loss tracks the
  // multi-byte UTF-8 characters in the page (∞, …, —), which `contents=` does not round
  // trip. A fetch transfers bytes exactly — verified against a 135,313-byte package.
  //
  // `file-contents` is kept only as an explicit last resort; nothing selects it by default.
  const fileWrite: FileWriteStrategy = capabilities.toolFetch ? "tool-fetch" : "manual";

  return {
    wirelessMenu,
    radio,
    fileWrite,
  };
}
