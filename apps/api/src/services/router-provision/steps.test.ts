import { describe, expect, test } from "bun:test";
import type { ProvisionContext } from "./context.js";
import { dialectFor } from "./dialect.js";
import type { RouterProfile } from "./probe.js";
import { type RosClient, RosRow, toRows } from "./ros-client.js";
import {
  addRuleFirst,
  moveRuleAheadOfHotspotRules,
  PROVISION_STEPS,
  ruleAheadOfHotspotRules,
} from "./steps.js";

/**
 * The `place-before` regression.
 *
 * Both firewall steps used to send `=place-before=0`, which RouterOS rejects with `no such item`
 * when nothing occupies index 0. On a freshly reset board they run moments after the hotspot server
 * is created, before RouterOS has populated its dynamic rules — so the list is empty, the add
 * fails, and because both steps are critical the entire Set up aborts before the portal pages are
 * ever uploaded.
 *
 * It passed the first clean-board test and failed the second, which is exactly the shape of bug a
 * unit test is for.
 */
function fakeRos(rows: Record<string, string>[]) {
  const added: string[][] = [];
  const ros = {
    print: async () => toRows(rows),
    add: async (_menu: string, params: string[]) => {
      added.push(params);
      return null;
    },
  } as unknown as RosClient;
  return { ros, added };
}

describe("addRuleFirst", () => {
  test("omits place-before when the list is empty", async () => {
    const { ros, added } = fakeRos([]);
    await addRuleFirst(ros, "/ip/firewall/filter", "firewall-forward-backend", ["=chain=forward"]);
    expect(added).toHaveLength(1);
    expect(added[0]?.some((p) => p.startsWith("=place-before="))).toBe(false);
  });

  test("never sends the numeric index that the board rejects", async () => {
    for (const rows of [[], [{ ".id": "*2" }]]) {
      const { ros, added } = fakeRos(rows);
      await addRuleFirst(ros, "/ip/firewall/filter", "firewall-input-backend", ["=chain=input"]);
      expect(added[0]).not.toContain("=place-before=0");
    }
  });

  test("places before the current first rule by its real .id", async () => {
    // Measured on an hAP lite: an `.id` is accepted and lands the rule at position 0.
    const { ros, added } = fakeRos([{ ".id": "*2" }, { ".id": "*3" }]);
    await addRuleFirst(ros, "/ip/firewall/filter", "firewall-forward-backend", ["=chain=forward"]);
    expect(added[0]).toContain("=place-before=*2");
  });

  test("always carries the wbs: tag, so the rule stays ours to manage", async () => {
    const { ros, added } = fakeRos([]);
    await addRuleFirst(ros, "/ip/firewall/filter", "firewall-forward-backend", ["=chain=forward"]);
    expect(added[0]).toContain("=comment=wbs:firewall-forward-backend");
  });

  test("passes the caller's params through untouched", async () => {
    const { ros, added } = fakeRos([]);
    const params = ["=chain=forward", "=src-address=10.5.50.0/24", "=action=accept"];
    await addRuleFirst(ros, "/ip/firewall/filter", "firewall-forward-backend", params);
    for (const p of params) expect(added[0]).toContain(p);
  });
});

/**
 * Position is part of correctness for the firewall rules.
 *
 * `addRuleFirst` appending to an empty list is not enough on its own: RouterOS materialises the
 * hotspot's dynamic rules a moment later and they land ABOVE our static accept, leaving it at index
 * 15 of 16 where the hotspot's own reject pre-empts it. Measured on a clean board.
 */
describe("ruleAheadOfHotspotRules", () => {
  const rowsFor = (order: string[]) =>
    order.map((o) =>
      o === "dyn"
        ? { dynamic: "true" }
        : o === "placeholder"
          ? { comment: "place hotspot rules here", dynamic: "false", disabled: "true" }
          : { comment: o, dynamic: "false" },
    ) as Record<string, string>[];

  const ros = (rows: Record<string, string>[]) =>
    ({ print: async () => toRows(rows) }) as unknown as Parameters<
      typeof ruleAheadOfHotspotRules
    >[0];

  test("true when our rule is above the dynamic rules", async () => {
    const rows = rowsFor(["wbs:firewall-forward-backend", "dyn", "dyn"]);
    expect(
      await ruleAheadOfHotspotRules(ros(rows), "/ip/firewall/filter", "firewall-forward-backend"),
    ).toBe(true);
  });

  test("false when the dynamic rules got in front — the bug this catches", async () => {
    const rows = rowsFor(["dyn", "dyn", "wbs:firewall-forward-backend"]);
    expect(
      await ruleAheadOfHotspotRules(ros(rows), "/ip/firewall/filter", "firewall-forward-backend"),
    ).toBe(false);
  });

  test("true when there are no dynamic rules to be above", async () => {
    const rows = rowsFor(["wbs:firewall-forward-backend"]);
    expect(
      await ruleAheadOfHotspotRules(ros(rows), "/ip/firewall/filter", "firewall-forward-backend"),
    ).toBe(true);
  });

  test("true above the hotspot's placeholder even while dynamic rules list first", async () => {
    // RouterOS 7.25 (CHR): a running hotspot keeps its dynamic rules first and re-inserts them
    // directly above the placeholder when it starts. Measured in the router sim.
    const rows = rowsFor(["dyn", "dyn", "wbs:firewall-forward-backend", "placeholder"]);
    expect(
      await ruleAheadOfHotspotRules(ros(rows), "/ip/firewall/filter", "firewall-forward-backend"),
    ).toBe(true);
  });

  test("false below the placeholder, where the hotspot's rules will stay ahead", async () => {
    const rows = rowsFor(["dyn", "dyn", "placeholder", "wbs:firewall-forward-backend"]);
    expect(
      await ruleAheadOfHotspotRules(ros(rows), "/ip/firewall/filter", "firewall-forward-backend"),
    ).toBe(false);
  });

  test("false when the rule is missing entirely", async () => {
    expect(
      await ruleAheadOfHotspotRules(
        ros(rowsFor(["dyn"])),
        "/ip/firewall/filter",
        "firewall-forward-backend",
      ),
    ).toBe(false);
  });

  test("BOTH firewall rules can satisfy it at once", async () => {
    /*
     * The criterion is "above the dynamics", not "first in the list", and that is the whole point:
     * only one rule can ever be index 0, so demanding that would have the two steps shove each
     * other aside on every run and phase 5 could never report a clean re-check.
     */
    const rows = rowsFor(["wbs:firewall-forward-backend", "wbs:firewall-input-backend", "dyn"]);
    for (const id of ["firewall-forward-backend", "firewall-input-backend"]) {
      expect(await ruleAheadOfHotspotRules(ros(rows), "/ip/firewall/filter", id)).toBe(true);
    }
  });
});

/**
 * The fresh-board race, measured on CHR 7.25 in the router sim: the hotspot adds its dynamic
 * rules and placeholder just after the server is created, above the rule the firewall step had
 * already placed, so the read-back found it below the placeholder.
 */
describe("moveRuleAheadOfHotspotRules", () => {
  const ours = { ".id": "*1", comment: "wbs:firewall-forward-backend", dynamic: "false" };
  const placeholder = {
    ".id": "*3",
    comment: "place hotspot rules here",
    dynamic: "false",
    disabled: "true",
  };
  const dynamicRule = { ".id": "*4", dynamic: "true" };

  function lateHotspot(emptyPrints: number) {
    let prints = 0;
    const moves: string[][] = [];
    const ros = {
      print: async () => {
        prints += 1;
        return toRows(prints <= emptyPrints ? [ours] : [dynamicRule, placeholder, ours]);
      },
      exec: async (_command: string, params: string[]) => {
        moves.push(params);
        return [];
      },
    } as unknown as RosClient;
    return { ros, moves };
  }

  test("waits for the hotspot's rules, then moves ours above the placeholder", async () => {
    const { ros, moves } = lateHotspot(2);
    await moveRuleAheadOfHotspotRules(
      ros,
      "/ip/firewall/filter",
      "firewall-forward-backend",
      5_000,
    );
    expect(moves).toEqual([["=numbers=*1", "=destination=*3"]]);
  });

  test("gives up waiting and leaves the rule when no hotspot rules appear", async () => {
    const { ros, moves } = lateHotspot(Number.POSITIVE_INFINITY);
    await moveRuleAheadOfHotspotRules(ros, "/ip/firewall/filter", "firewall-forward-backend", 300);
    expect(moves).toEqual([]);
  });
});

/**
 * Switching a provisioned router between an IPv4 portal and a host-name portal, measured on
 * CHR 7.25: RouterOS rejects setting dst-host on an address entry, and the address-only
 * forward rule must not outlive the IPv4 portal it was written for.
 */
describe("changing the portal origin", () => {
  const step = (id: string) => {
    const found = PROVISION_STEPS.find((s) => s.id === id);
    if (!found) throw new Error(`no step ${id}`);
    return found;
  };

  function recordingRos(tagged: Record<string, string> | null) {
    const calls: string[] = [];
    let current = tagged;
    const ros = {
      print: async (_menu: string, filters: string[] = []) =>
        toRows(filters.some((f) => f.startsWith("?comment=")) && current ? [current] : []),
      findByTag: async () => (current ? new RosRow(current) : null),
      remove: async (menu: string, id: string) => {
        calls.push(`remove ${menu} ${id}`);
        current = null;
      },
      set: async (menu: string, id: string, params: string[]) => {
        calls.push(`set ${menu} ${id} ${params.join(" ")}`);
      },
      add: async (menu: string, params: string[]) => {
        calls.push(`add ${menu} ${params.join(" ")}`);
        return null;
      },
    } as unknown as RosClient;
    return { ros, calls };
  }

  const hostPortal = {
    endpoints: {
      management: { url: "http://10.88.0.1:8080", ip: "10.88.0.1" },
      portal: { origin: "https://portal.example.com", host: "portal.example.com", hostIsIp: false },
    },
    hotspot: { network: "10.5.50.0/24" },
  } as unknown as ProvisionContext;

  test("an address walled-garden entry is replaced, not set, for a host-name portal", async () => {
    const { ros, calls } = recordingRos({ ".id": "*1", "dst-address": "10.0.2.2" });
    await step("walled-garden-backend").apply({ ros, ctx: hostPortal });
    expect(calls[0]).toBe("remove /ip/hotspot/walled-garden/ip *1");
    expect(calls.some((c) => c.startsWith("set "))).toBe(false);
    expect(calls.at(-1)).toContain("=dst-host=portal.example.com");
  });

  test("a host-name portal wants no address forward rule, and removes a stale one", async () => {
    const stale = { ".id": "*7", "dst-address": "10.0.2.2" };
    expect(
      await step("firewall-forward-backend").check({ ...recordingRos(stale), ctx: hostPortal }),
    ).toBe(false);
    const { ros, calls } = recordingRos(stale);
    await step("firewall-forward-backend").apply({ ros, ctx: hostPortal });
    expect(calls).toEqual(["remove /ip/firewall/filter *7"]);
    expect(
      await step("firewall-forward-backend").check({ ...recordingRos(null), ctx: hostPortal }),
    ).toBe(true);
  });
});

describe("a venue's allowed sites", () => {
  const found = PROVISION_STEPS.find((s) => s.id === "venue-allowed-sites");
  if (!found) throw new Error("no step");
  const step = found;
  const backend = {
    ".id": "*1",
    "dst-host": "portal.example.com",
    comment: "wbs:walled-garden-backend",
  };
  const site = (host: string, id: string) => ({
    ".id": id,
    "dst-host": host,
    comment: `wbs:allowed-site:${host}`,
  });
  const ctx = (allowedSites: string[]) =>
    ({ router: { venue: { allowedSites } } }) as unknown as ProvisionContext;

  function ros(rows: Record<string, string>[]) {
    const calls: string[] = [];
    const client = {
      print: async () => toRows(rows),
      findByTag: async () => null,
      remove: async (_menu: string, id: string) => {
        calls.push(`remove ${id}`);
      },
      add: async (_menu: string, params: string[]) => {
        calls.push(`add ${params.join(" ")}`);
        return null;
      },
    } as unknown as RosClient;
    return { ros: client, calls };
  }

  test("matches the list exactly, and HashiNet's own rule does not count", async () => {
    const rows = [backend, site("hotel.co.tz", "*2")];
    expect(await step.check({ ...ros(rows), ctx: ctx(["hotel.co.tz"]) })).toBe(true);
    expect(await step.check({ ...ros(rows), ctx: ctx([]) })).toBe(false);
    expect(await step.check({ ...ros([backend]), ctx: ctx([]) })).toBe(true);
    expect(await step.check({ ...ros([backend]), ctx: ctx(["hotel.co.tz"]) })).toBe(false);
  });

  test("adds what is new and removes what was taken off, leaving HashiNet's rule", async () => {
    const fake = ros([backend, site("old.co.tz", "*2")]);
    await step.apply({ ros: fake.ros, ctx: ctx(["hotel.co.tz"]) });
    expect(fake.calls[0]).toBe("remove *2");
    expect(fake.calls[1]).toContain("=dst-host=hotel.co.tz");
    expect(fake.calls[1]).toContain("=comment=wbs:allowed-site:hotel.co.tz");
    expect(fake.calls).toHaveLength(2);
  });
});

describe("an open guest WiFi", () => {
  const found = PROVISION_STEPS.find((s) => s.id === "hotspot-radio-open");
  if (!found) throw new Error("no step");
  const step = found;
  const ctxFor = (stack: "wifi" | "wireless") =>
    ({
      profile: { capabilities: { hotspot: true }, wirelessStack: stack },
      hotspot: { interface: "wifi2", interfaceIsRadio: true },
      dialect: dialectFor({
        capabilities: { toolFetch: true },
        wirelessStack: stack,
      } as unknown as RouterProfile),
    }) as unknown as ProvisionContext;

  /** A board whose menus hold `rows`, keyed by menu then name; records every write. */
  function board(rows: Record<string, Record<string, Record<string, string>>>) {
    const calls: string[] = [];
    const ros = {
      findByName: async (menu: string, name: string) => {
        const row = rows[menu]?.[name];
        return row ? new RosRow(row) : null;
      },
      set: async (menu: string, id: string, params: string[]) => {
        calls.push(`set ${menu} ${id} ${params.join(" ")}`);
      },
      add: async (menu: string, params: string[]) => {
        calls.push(`add ${menu} ${params.join(" ")}`);
        return null;
      },
    } as unknown as RosClient;
    return { ros, calls };
  }

  test("the wifi package: authentication emptied on the guest radio itself, and nothing else", async () => {
    const secured = board({
      "/interface/wifi": {
        wifi2: { ".id": "*2", name: "wifi2", "security.authentication-types": "wpa2-psk,wpa3-psk" },
      },
    });
    const ctx = ctxFor("wifi");
    expect(await step.check({ ros: secured.ros, ctx })).toBe(false);
    await step.apply({ ros: secured.ros, ctx });
    expect(secured.calls).toEqual(["set /interface/wifi *2 =security.authentication-types="]);
    const open = board({
      "/interface/wifi": {
        wifi2: { ".id": "*2", name: "wifi2", "security.authentication-types": "" },
      },
    });
    expect(await step.check({ ros: open.ros, ctx })).toBe(true);
  });

  test("legacy wireless: its own mode=none profile on the guest radio, never `default`", async () => {
    const fresh = board({
      "/interface/wireless": {
        wifi2: { ".id": "*2", name: "wifi2", "security-profile": "default" },
      },
    });
    const ctx = ctxFor("wireless");
    expect(await step.check({ ros: fresh.ros, ctx })).toBe(false);
    await step.apply({ ros: fresh.ros, ctx });
    expect(fresh.calls).toEqual([
      "add /interface/wireless/security-profiles =name=wbs-open =mode=none =comment=wbs:hotspot-radio-open",
      "set /interface/wireless *2 =security-profile=wbs-open",
    ]);
    expect(fresh.calls.join(" ")).not.toContain("default");
    const done = board({
      "/interface/wireless": {
        wifi2: { ".id": "*2", name: "wifi2", "security-profile": "wbs-open" },
      },
      "/interface/wireless/security-profiles": {
        "wbs-open": { ".id": "*5", name: "wbs-open", mode: "none" },
      },
    });
    expect(await step.check({ ros: done.ros, ctx })).toBe(true);
  });

  test("it never aborts a first setup", () => {
    expect(step.critical).toBe(false);
  });
});

/**
 * Guests reach nothing at the management address (the tunnel's end, whose RADIUS relay is for
 * routers), except the portal's web port when the portal is served from it, as on the router sim.
 */
describe("guests and the management address", () => {
  const step = (id: string) => {
    const found = PROVISION_STEPS.find((s) => s.id === id);
    if (!found) throw new Error(`no step ${id}`);
    return found;
  };

  /** A filter list that adds, sets and moves as RouterOS does. */
  function filterList(initial: Record<string, string>[]) {
    let rows = initial.map((r) => ({ ...r }));
    let next = 100;
    const params = (list: string[]) =>
      Object.fromEntries(
        list.map((p) => {
          const [key = "", ...value] = p.slice(1).split("=");
          return [key, value.join("=")];
        }),
      );
    const ros = {
      print: async () => toRows(rows),
      findByTag: async (_menu: string, id: string) => {
        const row = rows.find((r) => r.comment === `wbs:${id}`);
        return row ? new RosRow(row) : null;
      },
      add: async (_menu: string, list: string[]) => {
        const { "place-before": before, ...fields } = params(list);
        const row = { ".id": `*${next++}`, dynamic: "false", ...fields };
        const at = rows.findIndex((r) => r[".id"] === before);
        rows.splice(at === -1 ? rows.length : at, 0, row);
        return null;
      },
      set: async (_menu: string, id: string, list: string[]) => {
        rows = rows.map((r) => (r[".id"] === id ? { ...r, ...params(list) } : r));
      },
      exec: async (_command: string, list: string[]) => {
        const { numbers, destination } = params(list);
        const row = rows.find((r) => r[".id"] === numbers);
        if (!row) return [];
        rows = rows.filter((r) => r !== row);
        rows.splice(
          rows.findIndex((r) => r[".id"] === destination),
          0,
          row,
        );
        return [];
      },
    } as unknown as RosClient;
    return { ros, order: () => rows.map((r) => r.comment ?? r[".id"]), rows: () => rows };
  }

  const hotspotRules = () => [
    { ".id": "*1", dynamic: "true", comment: "hotspot" },
    { ".id": "*2", dynamic: "false", comment: "place hotspot rules here" },
  ];
  const profile = { capabilities: { hotspot: true } };
  const lanPortal = {
    endpoints: {
      management: { url: "http://10.88.0.1:4006", ip: "10.88.0.1" },
      portal: { origin: "http://10.88.0.1:4006", host: "10.88.0.1", hostIsIp: true },
    },
    hotspot: { network: "10.5.50.0/24" },
    profile,
  } as unknown as ProvisionContext;
  const hostPortal = {
    ...lanPortal,
    endpoints: {
      management: { url: "http://10.88.0.1:4006", ip: "10.88.0.1" },
      portal: { origin: "https://portal.example.com", host: "portal.example.com", hostIsIp: false },
    },
  } as unknown as ProvisionContext;

  test("a portal at the management address: its web port above the drop, both ahead of the hotspot's rules", async () => {
    const list = filterList(hotspotRules());
    for (const id of ["firewall-forward-backend", "firewall-guest-tunnel-drop"]) {
      await step(id).apply({ ros: list.ros, ctx: lanPortal });
    }
    expect(list.order().slice(0, 2)).toEqual([
      "wbs:firewall-forward-backend",
      "wbs:firewall-guest-tunnel-drop",
    ]);
    expect(list.rows()[0]).toMatchObject({ protocol: "tcp", "dst-port": "4006" });
    expect(list.rows()[1]).toMatchObject({
      chain: "forward",
      "src-address": "10.5.50.0/24",
      "dst-address": "10.88.0.1",
      action: "drop",
    });
    // A second run changes nothing.
    for (const id of ["firewall-forward-backend", "firewall-guest-tunnel-drop"]) {
      expect(await step(id).check({ ros: list.ros, ctx: lanPortal })).toBe(true);
    }
  });

  test("the drop below the portal's accept fails its check, and apply puts the accept back above", async () => {
    const list = filterList([
      {
        ".id": "*8",
        comment: "wbs:firewall-guest-tunnel-drop",
        chain: "forward",
        "src-address": "10.5.50.0/24",
        "dst-address": "10.88.0.1",
        action: "drop",
      },
      { ".id": "*9", comment: "wbs:firewall-forward-backend" },
      ...hotspotRules(),
    ]);
    const drop = step("firewall-guest-tunnel-drop");
    expect(await drop.check({ ros: list.ros, ctx: lanPortal })).toBe(false);
    await drop.apply({ ros: list.ros, ctx: lanPortal });
    expect(await drop.check({ ros: list.ros, ctx: lanPortal })).toBe(true);
  });

  test("a host-name portal: the drop alone, ahead of the hotspot's rules", async () => {
    const list = filterList(hotspotRules());
    const drop = step("firewall-guest-tunnel-drop");
    expect(await drop.check({ ros: list.ros, ctx: hostPortal })).toBe(false);
    await drop.apply({ ros: list.ros, ctx: hostPortal });
    expect(list.order()[0]).toBe("wbs:firewall-guest-tunnel-drop");
    expect(await drop.check({ ros: list.ros, ctx: hostPortal })).toBe(true);
  });
});
