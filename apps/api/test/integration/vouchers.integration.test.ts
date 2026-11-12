import { describe, expect, test } from "bun:test";
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

const DAY = { name: "Day", durationMinutes: 1440, downloadSpeedMbps: 10, priceTsh: 2000 };

async function setting(operatorId: string | null) {
  const venue = await t.db.venue.create({
    data: {
      businessId: await testBusinessId(t.db),
      name: "Home",
      region: "Dar es Salaam",
      area: "Dar es Salaam",
    },
  });
  if (operatorId)
    await t.db.membershipVenue.create({ data: { membershipId: operatorId, venueId: venue.id } });
  const pkg = await t.db.package.create({
    data: { businessId: await testBusinessId(t.db), ...DAY, dataLimitGb: 5 },
  });
  return { venue, pkg };
}

interface Detail {
  batch: { id: string; prefix: string; quantity: number; counts: Record<string, number> };
  vouchers: {
    id: string;
    code: string;
    status: string;
    durationMinutes: number;
    priceTsh: string;
    dataLimitGb: number;
    downloadSpeedMbps: number;
    uploadSpeedMbps: number;
    packageName: string;
    venueName: string;
  }[];
}

describe("vouchers", () => {
  test("a manager makes a batch for their venue: secure codes, the package's terms", async () => {
    const own = await manager("own@example.com");
    const { venue, pkg } = await setting(own.id);
    const created = await own.client.request("POST", "/api/vouchers/batches", {
      venueId: venue.id,
      packageId: pkg.id,
      quantity: 25,
      expiryDays: 30,
    });
    expect(created.status).toBe(201);
    const detail = created.body as Detail;
    expect(detail.batch).toMatchObject({ quantity: 25, counts: { unused: 25 } });
    expect(detail.vouchers).toHaveLength(25);
    expect(new Set(detail.vouchers.map((v) => v.code)).size).toBe(25);
    for (const voucher of detail.vouchers) {
      expect(voucher.code).toMatch(/^\d{12}$/); // ADR-0008: no prefix
      expect(voucher).toMatchObject({
        status: "unused",
        durationMinutes: 1440,
        priceTsh: "2000.00",
        dataLimitGb: 5,
        downloadSpeedMbps: 10,
        uploadSpeedMbps: 10,
        packageName: "Day",
        venueName: "Home",
      });
    }
    const stored = await t.db.voucher.findFirstOrThrow();
    const days = ((stored.expiresAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect((await t.db.auditLog.findFirstOrThrow()).action).toBe("voucher.print");

    const again = await own.client.request("GET", `/api/vouchers/batches/${detail.batch.id}`);
    expect((again.body as Detail).vouchers.map((v) => v.code).sort()).toEqual(
      detail.vouchers.map((v) => v.code).sort(),
    );
  });

  test("only a package on sale at the venue, and only in the manager's venues", async () => {
    const own = await manager("own@example.com");
    const { venue, pkg } = await setting(own.id);
    const other = await t.db.venue.create({
      data: {
        businessId: await testBusinessId(t.db),
        name: "Other",
        region: "Dar es Salaam",
        area: "Arusha",
      },
    });
    const week = await t.db.package.create({
      data: { businessId: await testBusinessId(t.db), ...DAY, name: "Week" },
    });
    const retired = await t.db.package.create({
      data: { businessId: await testBusinessId(t.db), ...DAY, name: "Old", isActive: false },
    });
    await t.db.venuePackage.create({ data: { venueId: venue.id, packageId: week.id } });

    const batch = (packageId: string, venueId = venue.id) =>
      own.client.request("POST", "/api/vouchers/batches", { venueId, packageId, quantity: 1 });
    for (const packageId of [pkg.id, retired.id]) {
      const refused = await batch(packageId);
      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({
        details: { packageId: "is not on sale at this venue" },
      });
    }
    expect((await batch(week.id)).status).toBe(201);
    expect((await batch(week.id, other.id)).status).toBe(404);
    expect(await t.db.voucher.count()).toBe(1);
  });

  test("a manager lists and opens only their venues' vouchers, a page at a time", async () => {
    const own = await manager("own@example.com");
    const { venue, pkg } = await setting(own.id);
    const c = await owner();
    const other = await t.db.venue.create({
      data: {
        businessId: await testBusinessId(t.db),
        name: "Other",
        region: "Dar es Salaam",
        area: "Arusha",
      },
    });
    const mine = (
      await own.client.request("POST", "/api/vouchers/batches", {
        venueId: venue.id,
        packageId: pkg.id,
        quantity: 5,
      })
    ).body as Detail;
    const theirs = (
      await c.request("POST", "/api/vouchers/batches", {
        venueId: other.id,
        packageId: pkg.id,
        quantity: 3,
      })
    ).body as Detail;

    const first = (await own.client.request("GET", "/api/vouchers?limit=3")).body as {
      vouchers: { venueName: string }[];
      nextBefore: string | null;
    };
    expect(first.vouchers).toHaveLength(3);
    expect(first.nextBefore).not.toBeNull();
    const rest = (
      await own.client.request("GET", `/api/vouchers?limit=3&before=${first.nextBefore}`)
    ).body as { vouchers: unknown[]; nextBefore: string | null };
    expect(rest.vouchers).toHaveLength(2);
    expect(rest.nextBefore).toBeNull();
    expect(first.vouchers.every((v) => v.venueName === "Home")).toBe(true);

    const batches = (await own.client.request("GET", "/api/vouchers/batches")).body as {
      batches: { id: string }[];
    };
    expect(batches.batches.map((b) => b.id)).toEqual([mine.batch.id]);
    const hidden = await own.client.request("GET", `/api/vouchers/batches/${theirs.batch.id}`);
    expect(hidden.status).toBe(404);
    const all = (await c.request("GET", "/api/vouchers?status=unused")).body as {
      vouchers: unknown[];
    };
    expect(all.vouchers).toHaveLength(8);
  });

  test("revoking stops unused vouchers, keeps their records, and never cuts off a guest", async () => {
    const c = await owner();
    const own = await manager("own@example.com");
    const { venue, pkg } = await setting(own.id);
    const detail = (
      await c.request("POST", "/api/vouchers/batches", {
        venueId: venue.id,
        packageId: pkg.id,
        quantity: 3,
      })
    ).body as Detail;
    const [unused, active, finished] = detail.vouchers;
    if (!unused || !active || !finished) throw new Error("batch too small");
    await t.db.voucher.update({
      where: { id: active.id },
      data: { status: "active", activatedAt: new Date() },
    });
    await t.db.voucher.update({ where: { id: finished.id }, data: { status: "used" } });

    // Venue operators sell; revoking is for managers and the owner.
    await businessMember(t.db, { email: "op@example.com", name: "Op", role: "venue_operator" });
    const op = browser(api);
    await signInWithCode(api, op, "op@example.com");
    const refused = await op.request("POST", "/api/vouchers/revoke", { ids: [unused.id] });
    expect(refused.status).toBe(403);

    const reply = await c.request("POST", "/api/vouchers/revoke", {
      ids: [unused.id, active.id, finished.id],
    });
    expect(reply).toEqual({ status: 200, body: { revoked: 1 } });
    const after = new Map((await t.db.voucher.findMany()).map((v) => [v.id, v]));
    expect(after.size).toBe(3);
    expect(after.get(unused.id)?.status).toBe("revoked");
    expect(after.get(unused.id)?.revokedAt).not.toBeNull();
    expect(after.get(active.id)?.status).toBe("active");
    expect(after.get(finished.id)?.status).toBe("used");
    expect((await t.db.auditLog.findMany()).map((a) => a.action)).toContain("voucher.revoke");
    const again = await c.request("POST", "/api/vouchers/revoke", { ids: [unused.id] });
    expect(again.body).toEqual({ revoked: 0 });
  });

  test("reprinting by id returns only vouchers in the manager's venues", async () => {
    const own = await manager("own@example.com");
    const { venue, pkg } = await setting(own.id);
    const c = await owner();
    const other = await t.db.venue.create({
      data: {
        businessId: await testBusinessId(t.db),
        name: "Other",
        region: "Dar es Salaam",
        area: "Arusha",
      },
    });
    const mine = (
      await own.client.request("POST", "/api/vouchers/batches", {
        venueId: venue.id,
        packageId: pkg.id,
        quantity: 2,
      })
    ).body as Detail;
    const theirs = (
      await c.request("POST", "/api/vouchers/batches", {
        venueId: other.id,
        packageId: pkg.id,
        quantity: 1,
      })
    ).body as Detail;
    const ids = [...mine.vouchers, ...theirs.vouchers].map((v) => v.id);
    const printed = await own.client.request("POST", "/api/vouchers/print", { ids });
    expect(printed.status).toBe(200);
    const vouchers = (printed.body as { vouchers: { id: string; downloadSpeedMbps: number }[] })
      .vouchers;
    expect(vouchers.map((v) => v.id).sort()).toEqual(mine.vouchers.map((v) => v.id).sort());
    expect(vouchers[0]?.downloadSpeedMbps).toBe(10);
  });
});
