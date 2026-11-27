import { describe, expect, test } from "bun:test";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  ACCT_STATUS,
  ATTR,
  CODE,
  decode,
  int,
  MalformedPacket,
  mikrotik,
  password,
  reply,
  signedBy,
  text,
  u32,
} from "./codec.js";

const SECRET = Buffer.from("router-secret");

/** A router's request, built as RFC 2865 and 2866 say, independently of the codec under test. */
function routerRequest(
  code: number,
  attributes: [number, Buffer][],
  opts: { password?: string; messageAuthenticator?: boolean; secret?: Buffer } = {},
): Buffer {
  const secret = opts.secret ?? SECRET;
  const auth = code === CODE.accountingRequest ? Buffer.alloc(16) : randomBytes(16);
  const all = [...attributes];
  if (opts.password !== undefined) {
    const plain = Buffer.alloc(Math.ceil(Buffer.byteLength(opts.password) / 16) * 16);
    plain.write(opts.password);
    const hidden = Buffer.alloc(plain.length);
    let prev = auth;
    for (let i = 0; i < plain.length; i += 16) {
      const pad = createHash("md5").update(secret).update(prev).digest();
      for (let j = 0; j < 16; j++) hidden[i + j] = (plain[i + j] ?? 0) ^ (pad[j] ?? 0);
      prev = hidden.subarray(i, i + 16);
    }
    all.push([ATTR.userPassword, hidden]);
  }
  if (opts.messageAuthenticator !== false) all.push([ATTR.messageAuthenticator, Buffer.alloc(16)]);
  const body = Buffer.concat(
    all.map(([t, v]) => Buffer.concat([Buffer.from([t, v.length + 2]), v])),
  );
  const pkt = Buffer.concat([Buffer.from([code, 7, 0, 0]), auth, body]);
  pkt.writeUInt16BE(pkt.length, 2);
  if (opts.messageAuthenticator !== false) {
    createHmac("md5", secret)
      .update(pkt)
      .digest()
      .copy(pkt, pkt.length - 16);
  }
  if (code === CODE.accountingRequest) {
    createHash("md5").update(pkt).update(secret).digest().copy(pkt, 4);
  }
  return pkt;
}

const login = (secret = SECRET) =>
  routerRequest(
    CODE.accessRequest,
    [
      [ATTR.userName, Buffer.from("482716936518")],
      [ATTR.callingStationId, Buffer.from("52:54:00:4A:00:10")],
    ],
    { password: "482716936518", secret },
  );

describe("requests", () => {
  test("an Access-Request is read, and its PAP password recovered", () => {
    const buf = login();
    const p = decode(buf);
    expect(p.code).toBe(CODE.accessRequest);
    expect(p.identifier).toBe(7);
    expect(text(p, ATTR.userName)).toBe("482716936518");
    expect(text(p, ATTR.callingStationId)).toBe("52:54:00:4A:00:10");
    expect(signedBy(buf, p, SECRET)).toBe(true);
    expect(password(p, SECRET)).toBe("482716936518");
  });

  test("a password over 16 bytes spans blocks", () => {
    const buf = routerRequest(CODE.accessRequest, [], { password: "twenty-character-pw!" });
    expect(password(decode(buf), SECRET)).toBe("twenty-character-pw!");
  });

  test("another secret, a changed byte, or no Message-Authenticator is refused", () => {
    expect(signedBy(login(), decode(login()), Buffer.from("other"))).toBe(false);
    const tampered = login();
    tampered[tampered.length - 20] ^= 1;
    expect(signedBy(tampered, decode(tampered), SECRET)).toBe(false);
    const bare = routerRequest(CODE.accessRequest, [[ATTR.userName, Buffer.from("x")]], {
      messageAuthenticator: false,
    });
    expect(signedBy(bare, decode(bare), SECRET)).toBe(false);
  });

  test("accounting is checked by its Request Authenticator", () => {
    const buf = routerRequest(CODE.accountingRequest, [
      [ATTR.acctStatusType, u32(ACCT_STATUS.start)],
      [ATTR.acctSessionId, Buffer.from("80000018")],
      [ATTR.class, Buffer.from("voucher-id")],
    ]);
    const p = decode(buf);
    expect(int(p, ATTR.acctStatusType)).toBe(ACCT_STATUS.start);
    expect(text(p, ATTR.acctSessionId)).toBe("80000018");
    expect(signedBy(buf, p, SECRET)).toBe(true);
    expect(signedBy(buf, p, Buffer.from("other"))).toBe(false);
  });

  test("broken framing is refused, never read past", () => {
    expect(() => decode(Buffer.alloc(10))).toThrow(MalformedPacket);
    const buf = login();
    buf.writeUInt16BE(buf.length + 40, 2);
    expect(() => decode(buf)).toThrow(MalformedPacket);
    const bad = login();
    bad[21] = 1; // the first attribute claims a length of 1
    expect(() => decode(bad)).toThrow(MalformedPacket);
  });
});

describe("replies", () => {
  test("a reply carries the Response Authenticator and a Message-Authenticator a router checks", () => {
    const request = decode(login());
    const out = reply(
      CODE.accessAccept,
      request,
      [[ATTR.sessionTimeout, u32(600)], mikrotik(8, Buffer.from("1M/2M"))],
      SECRET,
    );
    expect(out[0]).toBe(CODE.accessAccept);
    expect(out[1]).toBe(request.identifier);
    expect(out.readUInt16BE(2)).toBe(out.length);

    // As a router checks it: MD5(code+id+length+request authenticator+attributes+secret).
    const check = Buffer.from(out);
    request.authenticator.copy(check, 4);
    expect(createHash("md5").update(check).update(SECRET).digest("hex")).toBe(
      out.subarray(4, 20).toString("hex"),
    );

    // The Message-Authenticator is the HMAC over the reply with the request's authenticator, zeroed.
    const at = 20; // the codec puts it first
    expect(out[at]).toBe(ATTR.messageAuthenticator);
    const zeroed = Buffer.from(check);
    zeroed.fill(0, at + 2, at + 18);
    expect(createHmac("md5", SECRET).update(zeroed).digest("hex")).toBe(
      out.subarray(at + 2, at + 18).toString("hex"),
    );

    const back = decode(out);
    expect(int(back, ATTR.sessionTimeout)).toBe(600);
    const vsa = back.attributes.find(([t]) => t === ATTR.vendorSpecific)?.[1];
    expect(vsa?.readUInt32BE(0)).toBe(14988);
    expect(vsa?.subarray(6).toString()).toBe("1M/2M");
  });
});
