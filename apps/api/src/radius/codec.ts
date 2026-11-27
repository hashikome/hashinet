import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * RADIUS packets (RFC 2865 and 2866), as much as HashiNet's routers use: an Access-Request with a PAP
 * password or a MAC login, Accounting-Requests, and the replies to both. Every reply carries a
 * Message-Authenticator (RFC 3579), which RouterOS requires by default.
 */
export const CODE = {
  accessRequest: 1,
  accessAccept: 2,
  accessReject: 3,
  accountingRequest: 4,
  accountingResponse: 5,
} as const;

export const ATTR = {
  userName: 1,
  userPassword: 2,
  nasIpAddress: 4,
  framedIpAddress: 8,
  replyMessage: 18,
  class: 25,
  vendorSpecific: 26,
  sessionTimeout: 27,
  calledStationId: 30,
  callingStationId: 31,
  nasIdentifier: 32,
  acctStatusType: 40,
  acctInputOctets: 42,
  acctOutputOctets: 43,
  acctSessionId: 44,
  acctSessionTime: 46,
  acctTerminateCause: 49,
  acctInputGigawords: 52,
  acctOutputGigawords: 53,
  messageAuthenticator: 80,
  acctInterimInterval: 85,
} as const;

/** MikroTik's vendor id and the attribute that sets a session's speed, "rx/tx". */
export const MIKROTIK = { vendor: 14988, rateLimit: 8 } as const;

export const ACCT_STATUS = { start: 1, stop: 2, interim: 3, on: 7, off: 8 } as const;

export interface Packet {
  code: number;
  identifier: number;
  /** The 16-byte authenticator as sent. */
  authenticator: Buffer;
  attributes: [type: number, value: Buffer][];
}

export class MalformedPacket extends Error {}

/** A packet as received, its framing checked; its signature is checked separately. */
export function decode(buf: Buffer): Packet {
  if (buf.length < 20) throw new MalformedPacket("shorter than a header");
  const length = buf.readUInt16BE(2);
  if (length < 20 || length > buf.length || length > 4096) throw new MalformedPacket("bad length");
  const attributes: Packet["attributes"] = [];
  for (let i = 20; i < length; ) {
    const type = buf[i];
    const len = buf[i + 1];
    if (type === undefined || len === undefined || len < 2 || i + len > length) {
      throw new MalformedPacket("bad attribute");
    }
    attributes.push([type, buf.subarray(i + 2, i + len)]);
    i += len;
  }
  return {
    code: buf[0] ?? 0,
    identifier: buf[1] ?? 0,
    authenticator: buf.subarray(4, 20),
    attributes,
  };
}

/** The first value of an attribute, or null. */
export function attr(packet: Packet, type: number): Buffer | null {
  return packet.attributes.find(([t]) => t === type)?.[1] ?? null;
}

export function text(packet: Packet, type: number): string | null {
  return attr(packet, type)?.toString("utf8") ?? null;
}

export function int(packet: Packet, type: number): number | null {
  const value = attr(packet, type);
  return value && value.length === 4 ? value.readUInt32BE(0) : null;
}

const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/**
 * Whether a request was signed with `secret`: an Access-Request by its Message-Authenticator, which
 * is required; an Accounting-Request by its Request Authenticator (RFC 2866, 3), and by its
 * Message-Authenticator when it has one.
 */
export function signedBy(buf: Buffer, packet: Packet, secret: Buffer): boolean {
  const length = buf.readUInt16BE(2);
  const raw = Buffer.from(buf.subarray(0, length));
  if (packet.code === CODE.accountingRequest) {
    const sent = Buffer.from(raw.subarray(4, 20));
    raw.fill(0, 4, 20);
    const expected = createHash("md5").update(raw).update(secret).digest();
    if (!same(expected, sent)) return false;
    // The Message-Authenticator, if present, is computed with the zeroed Request Authenticator.
    return messageAuthenticatorHolds(raw, secret, false);
  }
  if (packet.code !== CODE.accessRequest) return false;
  return messageAuthenticatorHolds(raw, secret, true);
}

/** Checks the Message-Authenticator in `raw` (a copy, changed here); `required` when it must be there. */
function messageAuthenticatorHolds(raw: Buffer, secret: Buffer, required: boolean): boolean {
  for (let i = 20; i < raw.length; ) {
    const type = raw[i] ?? 0;
    const len = raw[i + 1] ?? 0;
    if (type === ATTR.messageAuthenticator) {
      if (len !== 18) return false;
      const sent = Buffer.from(raw.subarray(i + 2, i + 18));
      raw.fill(0, i + 2, i + 18);
      return same(createHmac("md5", secret).update(raw).digest(), sent);
    }
    i += len;
  }
  return !required;
}

/** A PAP User-Password, decrypted (RFC 2865, 5.2); null when there is none. */
export function password(packet: Packet, secret: Buffer): string | null {
  const hidden = attr(packet, ATTR.userPassword);
  if (!hidden || hidden.length === 0 || hidden.length % 16 !== 0 || hidden.length > 128)
    return null;
  const plain = Buffer.alloc(hidden.length);
  let previous = packet.authenticator;
  for (let i = 0; i < hidden.length; i += 16) {
    const pad = createHash("md5").update(secret).update(previous).digest();
    for (let j = 0; j < 16; j++) plain[i + j] = (hidden[i + j] ?? 0) ^ (pad[j] ?? 0);
    previous = hidden.subarray(i, i + 16);
  }
  const end = plain.indexOf(0);
  return plain.subarray(0, end === -1 ? plain.length : end).toString("utf8");
}

export const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};

/** A MikroTik vendor-specific attribute. */
export function mikrotik(type: number, value: Buffer): [number, Buffer] {
  return [
    ATTR.vendorSpecific,
    Buffer.concat([u32(MIKROTIK.vendor), Buffer.from([type, value.length + 2]), value]),
  ];
}

/**
 * A reply to `request` with `attributes`: a Message-Authenticator first computed over the reply with
 * the request's authenticator, then the Response Authenticator (RFC 2865, 3).
 */
export function reply(
  code: number,
  request: Packet,
  attributes: [number, Buffer][],
  secret: Buffer,
): Buffer {
  const all: [number, Buffer][] = [[ATTR.messageAuthenticator, Buffer.alloc(16)], ...attributes];
  const body = Buffer.concat(
    all.map(([type, value]) => {
      if (value.length > 253) throw new Error(`attribute ${type} is too long`);
      return Buffer.concat([Buffer.from([type, value.length + 2]), value]);
    }),
  );
  const packet = Buffer.concat([
    Buffer.from([code, request.identifier, 0, 0]),
    request.authenticator,
    body,
  ]);
  packet.writeUInt16BE(packet.length, 2);
  createHmac("md5", secret).update(packet).digest().copy(packet, 22);
  createHash("md5").update(packet).update(secret).digest().copy(packet, 4);
  return packet;
}
