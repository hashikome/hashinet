import { describe, expect, test } from "bun:test";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { SecretBox } from "../../src/crypto/secret-box.js";
import { ATTR, CODE, decode, int, text, u32 } from "../../src/radius/codec.js";
import { RadiusService } from "../../src/radius/radius.service.js";
import { recordClients } from "../../src/services/live-monitor.js";
import { useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";
import { testBusinessId } from "./people.js";

const TUNNEL_SECRET = "t".repeat(40);
const t = useTestDatabase();
const api = useApi({ TUNNEL_SYNC_SECRET: TUNNEL_SECRET });

const PEER = "10.88.0.7";
const SECRET = Buffer.from("router-radius-secret");
const MAC = "52:54:00:4A:00:10";
const OTHER = "52:54:00:4A:00:11";
const CODE_ = "482716936518";

async function seed(deviceLimit = 1) {
  const venue = await t.db.venue.create({
    data: {
      businessId: await testBusinessId(t.db),
      name: "Mama Neema Lodge",
      region: "Mwanza",
      area: "Isamilo",
    },
  });
  const router = await t.db.router.create({
    data: {
      venueId: venue.id,
      name: "Lobby",
      ipAddress: "192.168.88.2",
      tunnelAddress: PEER,
      radiusSecretEncrypted: new SecretBox(Buffer.from("ab".repeat(32), "hex")).seal(
        SECRET.toString(),
      ),
    },
  });
  const pkg = await t.db.package.create({
    data: {
      businessId: venue.businessId,
      name: "Day",
      durationMinutes: 1440,
      downloadSpeedMbps: 10,
      uploadSpeedMbps: 4,
      priceTsh: 2000,
      deviceLimit,
    },
  });
  const voucher = await t.db.voucher.create({
    data: {
      venueId: venue.id,
      packageId: pkg.id,
      code: CODE_,
      durationMinutes: 1440,
      priceTsh: 2000,
      status: "active",
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const device = await t.db.device.create({ data: { macAddress: MAC } });
  await t.db.voucherDevice.create({ data: { voucherId: voucher.id, deviceId: device.id } });
  return { venue, router, voucher, device };
}

/** A request as the router sends it, signed with `secret`. */
function request(
  code: number,
  attributes: [number, Buffer][],
  opts: { password?: string; secret?: Buffer } = {},
): Buffer {
  const secret = opts.secret ?? SECRET;
  const auth = code === CODE.accountingRequest ? Buffer.alloc(16) : randomBytes(16);
  const all = [...attributes];
  if (opts.password !== undefined) {
    const plain = Buffer.alloc(16);
    plain.write(opts.password);
    const pad = createHash("md5").update(secret).update(auth).digest();
    all.push([ATTR.userPassword, Buffer.from(plain.map((b, i) => b ^ (pad[i] ?? 0)))]);
  }
  all.push([ATTR.messageAuthenticator, Buffer.alloc(16)]);
  const body = Buffer.concat(
    all.map(([ty, v]) => Buffer.concat([Buffer.from([ty, v.length + 2]), v])),
  );
  const pkt = Buffer.concat([Buffer.from([code, 9, 0, 0]), auth, body]);
  pkt.writeUInt16BE(pkt.length, 2);
  createHmac("md5", secret)
    .update(pkt)
    .digest()
    .copy(pkt, pkt.length - 16);
  if (code === CODE.accountingRequest)
    createHash("md5").update(pkt).update(secret).digest().copy(pkt, 4);
  return pkt;
}

async function relay(packet: Buffer, peer = PEER, bearer = TUNNEL_SECRET) {
  const r = await fetch(`${api.url}/api/internal/radius`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ peer, packet: packet.toString("base64") }),
  });
  if (r.status !== 200) return { status: r.status, reply: null };
  const body = (await r.json()) as { reply: string | null };
  return {
    status: r.status,
    reply: body.reply === null ? null : decode(Buffer.from(body.reply, "base64")),
  };
}

const signIn = (mac = MAC) =>
  request(
    CODE.accessRequest,
    [
      [ATTR.userName, Buffer.from(CODE_)],
      [ATTR.callingStationId, Buffer.from(mac)],
    ],
    { password: CODE_ },
  );

const macLogin = (mac = MAC) =>
  request(CODE.accessRequest, [
    [ATTR.userName, Buffer.from(mac)],
    [ATTR.callingStationId, Buffer.from(mac)],
  ]);

const acct = (
  status: number,
  session: string,
  voucherId: string,
  mac = MAC,
  extra: [number, Buffer][] = [],
) =>
  request(CODE.accountingRequest, [
    [ATTR.acctStatusType, u32(status)],
    [ATTR.acctSessionId, Buffer.from(session)],
    [ATTR.callingStationId, Buffer.from(mac)],
    [ATTR.class, Buffer.from(voucherId)],
    [ATTR.framedIpAddress, Buffer.from([10, 5, 50, 253])],
    ...extra,
  ]);

describe("RADIUS from the routers (ADR-0015)", () => {
  test("only the tunnel service, and only a known router's signed packet, gets an answer", async () => {
    await seed();
    expect((await relay(signIn(), PEER, "x".repeat(40))).status).toBe(401);
    expect((await relay(signIn(), "10.88.0.99")).reply).toBeNull();
    const forged = request(
      CODE.accessRequest,
      [
        [ATTR.userName, Buffer.from(CODE_)],
        [ATTR.callingStationId, Buffer.from(MAC)],
      ],
      { password: CODE_, secret: Buffer.from("guessed") },
    );
    expect((await relay(forged)).reply).toBeNull();
  });

  test("a code gets in only through the API's admission, once, with time left and speed", async () => {
    const { router, voucher, device } = await seed();
    expect((await relay(signIn())).reply?.code).toBe(CODE.accessReject);

    await t.db.radiusAdmission.create({
      data: {
        voucherId: voucher.id,
        routerId: router.id,
        deviceId: device.id,
        macAddress: MAC,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const ok = (await relay(signIn())).reply;
    expect(ok?.code).toBe(CODE.accessAccept);
    const left = ok ? (int(ok, ATTR.sessionTimeout) ?? 0) : 0;
    expect(left).toBeGreaterThan(3500);
    expect(left).toBeLessThanOrEqual(3600);
    expect(ok ? text(ok, ATTR.class) : null).toBe(voucher.id);
    const vsa = ok?.attributes.find(([ty]) => ty === ATTR.vendorSpecific)?.[1];
    expect(vsa?.subarray(6).toString()).toBe("4M/10M");
    // The admission is used up.
    expect(await t.db.radiusAdmission.count()).toBe(0);
    expect((await relay(signIn())).reply?.code).toBe(CODE.accessReject);
  });

  test("a device comes back by its address while its place is free or its own, never another's", async () => {
    const { voucher, router } = await seed();
    expect((await relay(macLogin())).reply?.code).toBe(CODE.accessAccept);
    // Someone else holds the only place.
    await t.db.wifiSession.create({
      data: {
        voucherId: voucher.id,
        routerId: router.id,
        venueId: router.venueId,
        macAddress: OTHER,
        status: "connected",
      },
    });
    expect((await relay(macLogin())).reply?.code).toBe(CODE.accessReject);
    // An unknown device is sent to the portal.
    expect((await relay(macLogin("AA:BB:CC:DD:EE:FF"))).reply?.code).toBe(CODE.accessReject);
  });

  test("a device holding its place comes back by its address while wrong PINs lock others out", async () => {
    const { voucher, router, device } = await seed();
    await t.db.wifiSession.create({
      data: {
        voucherId: voucher.id,
        routerId: router.id,
        venueId: router.venueId,
        deviceId: device.id,
        macAddress: MAC,
        status: "connected",
      },
    });
    const guesser = await t.db.device.create({ data: { macAddress: OTHER } });
    await t.db.pinAttempt.create({
      data: { voucherId: voucher.id, deviceId: guesser.id, wrongTries: 6, lockedAt: new Date() },
    });
    // Even the holder's own lock, were it to have one, stops only a move.
    await t.db.pinAttempt.create({
      data: { voucherId: voucher.id, deviceId: device.id, wrongTries: 6, lockedAt: new Date() },
    });
    expect((await relay(macLogin())).reply?.code).toBe(CODE.accessAccept);
  });

  test("a repeat of a request still being decided gets the same answer", async () => {
    const { router, voucher, device } = await seed();
    await t.db.radiusAdmission.create({
      data: {
        voucherId: voucher.id,
        routerId: router.id,
        deviceId: device.id,
        macAddress: MAC,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const packet = signIn();
    const radius = api.app.get(RadiusService);
    const [first, repeat] = await Promise.all([
      radius.handle(PEER, packet),
      radius.handle(PEER, packet),
    ]);
    expect(first === null ? null : decode(first).code).toBe(CODE.accessAccept);
    expect(repeat === null ? null : decode(repeat).code).toBe(CODE.accessAccept);
  });

  test("accounting opens, counts and ends a session, once per session id", async () => {
    const { voucher } = await seed();
    const START = 1,
      INTERIM = 3,
      STOP = 2;
    expect((await relay(acct(START, "80000018", voucher.id))).reply?.code).toBe(
      CODE.accountingResponse,
    );
    await relay(acct(START, "80000018", voucher.id)); // a repeat changes nothing
    const open = await t.db.wifiSession.findMany();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      voucherId: voucher.id,
      macAddress: MAC,
      ipAddress: "10.5.50.253",
      status: "connected",
    });

    await relay(
      acct(INTERIM, "80000018", voucher.id, MAC, [
        [ATTR.acctInputOctets, u32(1000)],
        [ATTR.acctOutputOctets, u32(5000)],
        [ATTR.acctOutputGigawords, u32(1)],
        [ATTR.acctSessionTime, u32(60)],
      ]),
    );
    const [counted] = await t.db.wifiSession.findMany();
    expect(counted).toMatchObject({
      uploadBytes: 1000n,
      downloadBytes: 5000n + 2n ** 32n,
      durationSeconds: 60,
    });
    await relay(acct(STOP, "80000018", voucher.id, MAC, [[ATTR.acctTerminateCause, u32(5)]]));
    const [ended] = await t.db.wifiSession.findMany();
    expect(ended).toMatchObject({ status: "expired", terminationReason: "session_timeout" });
    expect(ended?.endedAt).not.toBeNull();
  });

  test("a Stop for a session HashiNet ended keeps why it ended, and counts its bytes", async () => {
    const { voucher } = await seed();
    await relay(acct(1, "80000019", voucher.id));
    // As the portal's sign-in does when the switch PIN moves the voucher to another device.
    await t.db.wifiSession.updateMany({
      data: { status: "terminated", terminationReason: "moved_to_another_device" },
    });
    await relay(
      acct(2, "80000019", voucher.id, MAC, [
        [ATTR.acctTerminateCause, u32(6)],
        [ATTR.acctOutputOctets, u32(14001)],
      ]),
    );
    const [moved] = await t.db.wifiSession.findMany();
    expect(moved).toMatchObject({
      status: "terminated",
      terminationReason: "moved_to_another_device",
      downloadBytes: 14001n,
    });
  });
});

describe("the live monitor and accounting", () => {
  test("a session whose Start came after the router's list was read is not closed as gone", async () => {
    const { router, voucher } = await seed();
    const readAt = new Date(Date.now() - 1000);
    const late = await t.db.wifiSession.create({
      data: {
        voucherId: voucher.id,
        routerId: router.id,
        venueId: router.venueId,
        macAddress: OTHER,
        status: "connected",
        startedAt: new Date(),
      },
    });
    const left = await t.db.wifiSession.create({
      data: {
        voucherId: voucher.id,
        routerId: router.id,
        venueId: router.venueId,
        macAddress: MAC,
        status: "connected",
        startedAt: new Date(Date.now() - 60_000),
      },
    });
    await recordClients(t.db, router.id, [], readAt);
    expect((await t.db.wifiSession.findUniqueOrThrow({ where: { id: late.id } })).status).toBe(
      "connected",
    );
    expect((await t.db.wifiSession.findUniqueOrThrow({ where: { id: left.id } })).status).toBe(
      "disconnected",
    );
  });
});
