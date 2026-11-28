import { describe, expect, spyOn, test } from "bun:test";
import { RouterSync } from "../../src/network/monitor/router-sync.js";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { businessMember, testBusinessId } from "./people.js";

const t = useTestDatabase();
const api = useApi();

/** The test business's owner, signed in with an authenticator app. */
async function owner(): Promise<Client> {
  await businessMember(t.db, { email: "owner@example.com", name: "Owner", role: "owner" });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, "owner@example.com");
  return c;
}

async function manager(email: string): Promise<{ client: Client; id: string }> {
  const { membershipId: id } = await businessMember(t.db, {
    email,
    name: email,
    role: "venue_manager",
  });
  const client = browser(api);
  await enrollAuthenticatorFor(api, client, email);
  return { client, id };
}

let macs = 0;

/**
 * Two venues, a manager for the first, and one phone seen at both: 1 GB down at the manager's
 * venue, 4 GB at the other, connected now only at the other.
 */
async function world() {
  const own = await manager("own@example.com");
  const mine = await t.db.venue.create({
    data: {
      businessId: await testBusinessId(t.db),
      name: "Home",
      region: "Dar es Salaam",
      area: "Dar",
    },
  });
  if (own.id)
    await t.db.membershipVenue.create({ data: { membershipId: own.id, venueId: mine.id } });
  const theirs = await t.db.venue.create({
    data: {
      businessId: await testBusinessId(t.db),
      name: "Other",
      region: "Dar es Salaam",
      area: "Arusha",
    },
  });
  macs += 1;
  const mac = `AA:BB:CC:00:00:${String(macs).padStart(2, "0")}`;
  const phone = await t.db.device.create({ data: { macAddress: mac, deviceName: "Pixel" } });
  const only = await t.db.device.create({ data: { macAddress: `${mac.slice(0, -2)}FF` } });
  const voucher = await t.db.voucher.create({
    data: {
      venueId: theirs.id,
      code: `LIVE-${macs}`,
      status: "active",
      durationMinutes: 60,
      priceTsh: "1000",
    },
  });
  const session = (
    venueId: string,
    deviceId: string,
    status: "connected" | "disconnected",
    gb: number,
  ) =>
    t.db.wifiSession.create({
      data: {
        venueId,
        deviceId,
        macAddress: mac,
        status,
        downloadBytes: BigInt(gb) * 1_073_741_824n,
        ...(status === "connected" ? { voucherId: voucher.id } : {}),
      },
    });
  const atMine = await session(mine.id, phone.id, "disconnected", 1);
  const atTheirs = await session(theirs.id, phone.id, "connected", 4);
  await session(theirs.id, only.id, "disconnected", 2);
  await t.db.voucherDevice.create({ data: { voucherId: voucher.id, deviceId: phone.id } });
  return { own, mine, theirs, phone, only, atMine, atTheirs, voucher };
}

type Body = Record<string, unknown>;

describe("devices", () => {
  test("a manager sees a device only as their venues saw it", async () => {
    const w = await world();
    const list = (await w.own.client.request("GET", "/api/devices")).body as {
      devices: Body[];
      stats: Body;
    };
    expect(list.devices.map((d) => d.id)).toEqual([w.phone.id]);
    expect(list.devices[0]).toMatchObject({
      downloadBytes: 1_073_741_824,
      // Connected, but at someone else's venue.
      isOnline: false,
      deviceName: "Pixel",
    });
    expect(list.stats).toEqual({ total: 1, online: 0, offline: 1, blocked: 0 });
    expect((await w.own.client.request("GET", `/api/devices/${w.only.id}`)).status).toBe(404);

    const all = (await (await owner()).request("GET", "/api/devices")).body as {
      devices: Body[];
      stats: Body;
    };
    expect(all.stats).toEqual({ total: 2, online: 1, offline: 1, blocked: 0 });
    const phone = all.devices.find((d) => d.id === w.phone.id);
    expect(phone).toMatchObject({ downloadBytes: 5 * 1_073_741_824, isOnline: true });
  });

  test("search and status filters, a page at a time", async () => {
    const w = await world();
    const c = await owner();
    const online = (await c.request("GET", "/api/devices?status=online")).body as {
      devices: Body[];
    };
    expect(online.devices.map((d) => d.id)).toEqual([w.phone.id]);
    const found = (await c.request("GET", "/api/devices?search=pixel")).body as { devices: Body[] };
    expect(found.devices.map((d) => d.id)).toEqual([w.phone.id]);
    const page = (await c.request("GET", "/api/devices?limit=1")).body as {
      devices: Body[];
      nextBefore: string;
    };
    expect(page.devices).toHaveLength(1);
    const next = (await c.request("GET", `/api/devices?limit=1&before=${page.nextBefore}`))
      .body as { devices: Body[]; nextBefore: string | null };
    expect(next.devices).toHaveLength(1);
    expect(next.nextBefore).toBeNull();
  });

  test("blocking ends the device's sessions everywhere; only the owner and business managers remove", async () => {
    const w = await world();
    const path = `/api/devices/${w.phone.id}`;
    expect((await w.own.client.request("DELETE", path)).status).toBe(403);

    const c = await owner();
    const blocked = await c.request("PUT", `${path}/status`, { status: "blocked" });
    expect(blocked.body).toMatchObject({ device: { status: "blocked", isOnline: false } });
    expect(
      await t.db.wifiSession.findUniqueOrThrow({ where: { id: w.atTheirs.id } }),
    ).toMatchObject({ status: "terminated", terminationReason: "device_blocked" });
    const stats = ((await c.request("GET", "/api/devices")).body as { stats: Body }).stats;
    expect(stats).toEqual({ total: 2, online: 0, offline: 1, blocked: 1 });
    // The block is on the voucher it used too: a new address gets nowhere with it.
    const voucherOf = () => t.db.voucher.findUniqueOrThrow({ where: { id: w.voucher.id } });
    expect((await voucherOf()).blockedAt).not.toBeNull();

    expect((await c.request("PUT", `${path}/status`, { status: "active" })).body).toMatchObject({
      device: { status: "active" },
    });
    expect((await voucherOf()).blockedAt).toBeNull();
    expect((await c.request("DELETE", path)).status).toBe(204);
    // The sessions stay, unlinked from the forgotten device.
    expect(await t.db.wifiSession.count({ where: { deviceId: null } })).toBe(2);
    const actions = (await t.db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(["device.block", "device.unblock", "device.delete"]);
    expect(JSON.stringify(await t.db.auditLog.findMany())).not.toContain("AA:BB");
  });
});

describe("a voucher two blocked devices used", () => {
  test("stays blocked until neither device is", async () => {
    const w = await world();
    const c = await owner();
    const second = await t.db.device.create({ data: { macAddress: "AA:BB:CC:00:01:02" } });
    await t.db.wifiSession.create({
      data: {
        venueId: w.theirs.id,
        deviceId: second.id,
        macAddress: second.macAddress,
        status: "disconnected",
      },
    });
    await t.db.voucherDevice.create({ data: { voucherId: w.voucher.id, deviceId: second.id } });
    const status = (id: string, value: "active" | "blocked") =>
      c.request("PUT", `/api/devices/${id}/status`, { status: value });
    const blockedAt = async () =>
      (await t.db.voucher.findUniqueOrThrow({ where: { id: w.voucher.id } })).blockedAt;

    expect((await status(w.phone.id, "blocked")).status).toBe(200);
    expect((await status(second.id, "blocked")).status).toBe(200);
    expect((await status(w.phone.id, "active")).status).toBe(200);
    expect(await blockedAt()).not.toBeNull();
    expect((await status(second.id, "active")).status).toBe(200);
    expect(await blockedAt()).toBeNull();
  });
});

describe("blocking is a business's own", () => {
  test("an operator blocks a device seen at their venue, for the whole business", async () => {
    const w = await world();
    await businessMember(t.db, {
      email: "musa@example.com",
      name: "Musa",
      role: "venue_operator",
      venueIds: [w.mine.id],
    });
    const musa = browser(api);
    await signInWithCode(api, musa, "musa@example.com");
    const blocked = await musa.request("PUT", `/api/devices/${w.phone.id}/status`, {
      status: "blocked",
    });
    expect(blocked.body).toMatchObject({ device: { status: "blocked" } });
    // Seen at their venue, blocked at the other venue of the business too.
    expect(
      (await t.db.wifiSession.findUniqueOrThrow({ where: { id: w.atTheirs.id } })).status,
    ).toBe("terminated");
    // A device never seen at their venues is not theirs to block, and removing is not theirs.
    expect(
      (await musa.request("PUT", `/api/devices/${w.only.id}/status`, { status: "blocked" })).status,
    ).toBe(404);
    expect((await musa.request("DELETE", `/api/devices/${w.phone.id}`)).status).toBe(403);
  });

  test("a device one business blocks stays online at another's", async () => {
    const w = await world();
    const elsewhere = await t.db.business.create({
      data: { name: "Elsewhere", region: "Arusha", area: "Njiro" },
    });
    const far = await t.db.venue.create({
      data: { businessId: elsewhere.id, name: "Far", region: "Arusha", area: "Njiro" },
    });
    const there = await t.db.wifiSession.create({
      data: { venueId: far.id, deviceId: w.phone.id, macAddress: "AA:BB", status: "connected" },
    });

    const c = await owner();
    const blocked = await c.request("PUT", `/api/devices/${w.phone.id}/status`, {
      status: "blocked",
    });
    expect(blocked.body).toMatchObject({ device: { status: "blocked" } });
    // Its session at this business ended; the one at the other business goes on.
    expect(
      (await t.db.wifiSession.findUniqueOrThrow({ where: { id: w.atTheirs.id } })).status,
    ).toBe("terminated");
    expect((await t.db.wifiSession.findUniqueOrThrow({ where: { id: there.id } })).status).toBe(
      "connected",
    );
    expect(await t.db.deviceBlock.findMany({ select: { businessId: true } })).toEqual([
      { businessId: w.theirs.businessId },
    ]);
  });

  test("removing a device forgets it for this business alone: another's block and history stay", async () => {
    const w = await world();
    const elsewhere = await t.db.business.create({
      data: { name: "Elsewhere", region: "Arusha", area: "Njiro" },
    });
    const far = await t.db.venue.create({
      data: { businessId: elsewhere.id, name: "Far", region: "Arusha", area: "Njiro" },
    });
    const there = await t.db.wifiSession.create({
      data: { venueId: far.id, deviceId: w.phone.id, macAddress: "AA:BB", status: "disconnected" },
    });
    const card = await t.db.voucher.create({
      data: {
        venueId: far.id,
        code: "200000000001",
        status: "active",
        durationMinutes: 60,
        priceTsh: "1000",
      },
    });
    await t.db.voucherDevice.create({ data: { voucherId: card.id, deviceId: w.phone.id } });
    await t.db.deviceBlock.create({ data: { businessId: elsewhere.id, deviceId: w.phone.id } });

    const c = await owner();
    const lifted = spyOn(api.app.get(RouterSync), "setDeviceBlocked").mockResolvedValue();
    expect((await c.request("DELETE", `/api/devices/${w.phone.id}`)).status).toBe(204);
    // Gone from this business: its sessions here are unlinked, and its list no longer has it.
    expect(
      (await t.db.wifiSession.findUniqueOrThrow({ where: { id: w.atTheirs.id } })).deviceId,
    ).toBeNull();
    const ids = ((await c.request("GET", "/api/devices")).body as { devices: { id: string }[] })
      .devices;
    expect(ids.map((d) => d.id)).not.toContain(w.phone.id);
    // The other business still has it, blocked, with its session and its voucher's place.
    expect(await t.db.deviceBlock.count({ where: { businessId: elsewhere.id } })).toBe(1);
    expect((await t.db.wifiSession.findUniqueOrThrow({ where: { id: there.id } })).deviceId).toBe(
      w.phone.id,
    );
    expect(await t.db.voucherDevice.count({ where: { voucherId: card.id } })).toBe(1);

    // Its block here is lifted on this business's routers; it had none here, so nothing was sent.
    expect(lifted).not.toHaveBeenCalled();

    // Once no business has it, the device itself goes.
    await t.db.wifiSession.delete({ where: { id: there.id } });
    await t.db.voucherDevice.deleteMany({});
    await t.db.deviceBlock.deleteMany({});
    await t.db.wifiSession.create({
      data: {
        venueId: w.mine.id,
        deviceId: w.phone.id,
        macAddress: "AA:BB",
        status: "disconnected",
      },
    });
    await t.db.deviceBlock.create({
      data: { businessId: w.mine.businessId, deviceId: w.phone.id },
    });
    expect((await c.request("DELETE", `/api/devices/${w.phone.id}`)).status).toBe(204);
    expect(await t.db.device.count({ where: { id: w.phone.id } })).toBe(0);
    // Removing a blocked device lifts its block on the business's routers.
    expect(lifted).toHaveBeenCalledWith(w.mine.businessId, w.phone.macAddress, false);
    lifted.mockRestore();
  });
});

describe("releasing a voucher", () => {
  test("whoever is at the counter frees a voucher in use: its devices and sessions go, its time runs on", async () => {
    const w = await world();
    const { voucher } = w;
    const c = await owner();
    // A device locked out by wrong PINs, and the voucher's own count of them.
    await t.db.pinAttempt.create({
      data: { voucherId: voucher.id, deviceId: w.only.id, wrongTries: 6, lockedAt: new Date() },
    });
    await t.db.voucher.update({
      where: { id: voucher.id },
      data: { wrongPins: 15, wrongPinsSince: new Date(), pinWaitUntil: new Date(Date.now() + 9e5) },
    });

    const released = await c.request("POST", `/api/vouchers/${voucher.id}/release`);
    expect(released.status).toBe(200);
    expect(released.body).toMatchObject({ voucher: { status: "active" } });
    expect(await t.db.voucherDevice.count({ where: { voucherId: voucher.id } })).toBe(0);
    expect(await t.db.pinAttempt.count({ where: { voucherId: voucher.id } })).toBe(0);
    expect(await t.db.voucher.findUniqueOrThrow({ where: { id: voucher.id } })).toMatchObject({
      pinHmac: null,
      wrongPins: 0,
      wrongPinsSince: null,
      pinWaitUntil: null,
    });
    expect(
      await t.db.wifiSession.findUniqueOrThrow({ where: { id: w.atTheirs.id } }),
    ).toMatchObject({ status: "terminated", terminationReason: "voucher_released" });
    const audit = await t.db.auditLog.findFirstOrThrow({ where: { action: "voucher.release" } });
    expect(audit.venueId).toBe(w.theirs.id);

    // A voucher not in use has nothing to free.
    await t.db.voucher.update({ where: { id: voucher.id }, data: { status: "unused" } });
    expect((await c.request("POST", `/api/vouchers/${voucher.id}/release`)).status).toBe(409);
  });
});

describe("sessions", () => {
  test("a manager lists and reads only their venues' sessions, with totals over them", async () => {
    const w = await world();
    const list = (await w.own.client.request("GET", "/api/sessions")).body as {
      sessions: Body[];
      stats: Body;
    };
    expect(list.sessions.map((s) => s.id)).toEqual([w.atMine.id]);
    expect(list.stats).toEqual({
      total: 1,
      connected: 0,
      uploadBytes: 0,
      downloadBytes: 1_073_741_824,
    });
    expect(list.sessions[0]).toMatchObject({ venueName: "Home", deviceId: w.phone.id });
    expect((await w.own.client.request("GET", `/api/sessions/${w.atTheirs.id}`)).status).toBe(404);

    const c = await owner();
    const connected = (await c.request("GET", "/api/sessions?status=connected")).body as {
      sessions: Body[];
      stats: Body;
    };
    expect(connected.sessions).toHaveLength(1);
    expect(connected.sessions[0]).toMatchObject({ voucherCode: expect.stringMatching(/^LIVE-/) });
    const byDevice = (await c.request("GET", `/api/sessions?deviceId=${w.phone.id}`)).body as {
      stats: Body;
    };
    expect(byDevice.stats).toMatchObject({ total: 2, downloadBytes: 5 * 1_073_741_824 });
  });

  test("ending soonest first: by when the voucher ends, those without an end last, one page", async () => {
    const w = await world();
    const c = await owner();
    const live = async (code: string, endsInMinutes: number | null) => {
      const voucher = await t.db.voucher.create({
        data: {
          venueId: w.mine.id,
          code,
          status: "active",
          durationMinutes: 60,
          priceTsh: "1000",
          expiresAt: endsInMinutes === null ? null : new Date(Date.now() + endsInMinutes * 60_000),
        },
      });
      return t.db.wifiSession.create({
        data: {
          venueId: w.mine.id,
          deviceId: w.only.id,
          macAddress: `AA:BB:CC:11:00:${code.slice(-2)}`,
          status: "connected",
          voucherId: voucher.id,
        },
      });
    };
    const later = await live("100000000040", 40);
    const soon = await live("100000000005", 5);
    const page = (await c.request("GET", "/api/sessions?status=connected&order=ending&limit=2"))
      .body as { sessions: { id: string; voucherExpiresAt: string | null }[]; nextBefore: unknown };
    expect(page.sessions.map((s) => s.id)).toEqual([soon.id, later.id]);
    expect(page.sessions[0]?.voucherExpiresAt).toEqual(expect.any(String));
    expect(page.nextBefore).toBeNull();
    const all = (await c.request("GET", "/api/sessions?status=connected&order=ending")).body as {
      sessions: { id: string }[];
    };
    // The world's live session holds a voucher not yet started: no end, so last.
    expect(all.sessions.map((s) => s.id)).toEqual([soon.id, later.id, w.atTheirs.id]);
    // A code read off its card in groups finds its session.
    const byCode = (
      await c.request("GET", `/api/sessions?search=${encodeURIComponent("0000 0005")}`)
    ).body as { sessions: { id: string }[] };
    expect(byCode.sessions.map((s) => s.id)).toEqual([soon.id]);
  });

  test("terminating ends a connected session once, within the manager's venues", async () => {
    const w = await world();
    const theirs = await w.own.client.request("POST", `/api/sessions/${w.atTheirs.id}/terminate`);
    expect(theirs.status).toBe(404);

    const live = await t.db.wifiSession.create({
      data: {
        venueId: w.mine.id,
        deviceId: w.phone.id,
        macAddress: "AA:BB:CC:00:00:99",
        status: "connected",
        startedAt: new Date(Date.now() - 90_000),
      },
    });
    const ended = await w.own.client.request("POST", `/api/sessions/${live.id}/terminate`);
    expect(ended.status).toBe(200);
    expect(ended.body).toMatchObject({
      session: { status: "terminated", terminationReason: "staff_disconnect" },
    });
    const seconds = (ended.body as { session: { durationSeconds: number } }).session
      .durationSeconds;
    expect(seconds).toBeGreaterThanOrEqual(89);
    const again = await w.own.client.request("POST", `/api/sessions/${live.id}/terminate`);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "SESSION_NOT_ACTIVE" });
    expect((await t.db.auditLog.findMany()).map((a) => a.action)).toEqual(["session.terminate"]);
  });

  test("ending a session takes its device off the voucher, so the router can't sign it back in", async () => {
    const w = await world();
    const c = await owner();
    expect((await c.request("POST", `/api/sessions/${w.atTheirs.id}/terminate`)).status).toBe(200);
    expect(
      await t.db.voucherDevice.count({ where: { voucherId: w.voucher.id, deviceId: w.phone.id } }),
    ).toBe(0);
    // The voucher stays: it is still in use, for the device to sign in to again at the portal.
    expect((await t.db.voucher.findUniqueOrThrow({ where: { id: w.voucher.id } })).status).toBe(
      "active",
    );
  });
});
