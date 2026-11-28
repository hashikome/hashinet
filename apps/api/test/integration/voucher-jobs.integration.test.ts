import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { AuditLog } from "../../src/core/audit/audit-log.js";
import { SecretBox } from "../../src/core/crypto/secret-box.js";
import { RouterAccess } from "../../src/network/mikrotik/router-credentials.js";
import { RouterSync } from "../../src/network/monitor/router-sync.js";
import { VoucherExpiry } from "../../src/sales/vouchers/voucher-expiry.js";
import { useTestDatabase } from "./harness.js";
import { testBusinessId } from "./people.js";

const t = useTestDatabase();

function services() {
  const access = new RouterAccess(new SecretBox(randomBytes(32)), 8728, 5);
  const audit = new AuditLog(t.db);
  const sync = new RouterSync(t.db, access, audit);
  return { expiry: new VoucherExpiry(t.db, sync) };
}

const HOUR = 3_600_000;

/** A venue with no routers, so the jobs exercise the database and never contact a router. */
async function venueWithVouchers(
  vouchers: {
    code: string;
    status: "unused" | "pending_activation" | "active";
    expiresIn: number;
  }[],
) {
  const venue = await t.db.venue.create({
    data: {
      businessId: await testBusinessId(t.db),
      name: "Home",
      region: "Dar es Salaam",
      area: "Dar es Salaam",
    },
  });
  const pkg = await t.db.package.create({
    data: {
      businessId: await testBusinessId(t.db),
      name: "Hour",
      durationMinutes: 60,
      downloadSpeedMbps: 10,
      priceTsh: "1000",
    },
  });
  for (const v of vouchers) {
    await t.db.voucher.create({
      data: {
        code: v.code,
        status: v.status,
        venueId: venue.id,
        packageId: pkg.id,
        priceTsh: "1000",
        expiresAt: new Date(Date.now() + v.expiresIn),
        activatedAt: v.status === "unused" ? null : new Date(Date.now() - HOUR),
      },
    });
  }
  return { venue, pkg };
}

const statusOf = async (code: string) =>
  (await t.db.voucher.findUniqueOrThrow({ where: { code } })).status;

describe("voucher expiry", () => {
  test("active runs out to used; unused lapses to expired; live vouchers are untouched", async () => {
    await venueWithVouchers([
      { code: "WIFI-ACTIVE", status: "active", expiresIn: -60_000 },
      { code: "WIFI-UNUSED", status: "unused", expiresIn: -60_000 },
      { code: "WIFI-LIVE", status: "active", expiresIn: HOUR },
    ]);
    const result = await services().expiry.runOnce();
    expect(result.vouchers).toBe(2);
    expect(await statusOf("WIFI-ACTIVE")).toBe("used");
    expect(await statusOf("WIFI-UNUSED")).toBe("expired");
    expect(await statusOf("WIFI-LIVE")).toBe("active");
  });

  test("an expired pending_activation voucher ends as expired, not stuck (fixed bug)", async () => {
    await venueWithVouchers([
      { code: "WIFI-PENDING", status: "pending_activation", expiresIn: -60_000 },
    ]);
    await services().expiry.runOnce();
    expect(await statusOf("WIFI-PENDING")).toBe("expired");
  });

  test("closes the sessions an expired voucher holds", async () => {
    const { venue } = await venueWithVouchers([
      { code: "WIFI-SESSION", status: "active", expiresIn: -60_000 },
    ]);
    const voucher = await t.db.voucher.findUniqueOrThrow({ where: { code: "WIFI-SESSION" } });
    const session = await t.db.wifiSession.create({
      data: { voucherId: voucher.id, venueId: venue.id, macAddress: "52:54:00:4A:00:10" },
    });
    await services().expiry.runOnce();
    const closed = await t.db.wifiSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(closed.status).toBe("expired");
    expect(closed.endedAt).not.toBeNull();
  });

  test("keeps an expired voucher's switch PIN, for an outage's time given back to revive it with", async () => {
    await venueWithVouchers([{ code: "WIFI-PIN", status: "active", expiresIn: -60_000 }]);
    await t.db.voucher.update({ where: { code: "WIFI-PIN" }, data: { pinHmac: "a".repeat(64) } });
    await services().expiry.runOnce();
    expect((await t.db.voucher.findUniqueOrThrow({ where: { code: "WIFI-PIN" } })).pinHmac).toBe(
      "a".repeat(64),
    );
  });
});

describe("a router that stays unreachable", () => {
  test("is audited once for the run of failures, and counts each one", async () => {
    // Nothing listens on port 1 here: every sync fails, after the one-second connect timeout.
    const access = new RouterAccess(new SecretBox(randomBytes(32)), 1, 1);
    const sync = new RouterSync(t.db, access, new AuditLog(t.db));
    const { venue } = await venueWithVouchers([
      { code: "300000000001", status: "unused", expiresIn: HOUR },
    ]);
    const router = await t.db.router.create({
      data: {
        venueId: venue.id,
        name: "Lobby",
        ipAddress: "127.0.0.1",
        apiUsername: "hashinet",
        apiPasswordEncrypted: access.sealPassword("secret"),
      },
    });

    for (let i = 0; i < 3; i++) await sync.syncBlocks(router.id);

    expect(
      await t.db.auditLog.count({ where: { action: "router.sync_failed", targetId: router.id } }),
    ).toBe(1);
    expect((await t.db.router.findUniqueOrThrow({ where: { id: router.id } })).failedSyncs).toBe(3);
  }, 15_000);
});
