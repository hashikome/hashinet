import { describe, expect, test } from "bun:test";
import { useTestDatabase } from "./harness.js";
import { testBusinessId } from "./people.js";

const t = useTestDatabase();

/** The error a query fails with, or null. Prisma queries are lazy thenables, so await them. */
async function failure(query: PromiseLike<unknown>): Promise<string | null> {
  try {
    await query;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function venueAndPackage() {
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
  return { venue, pkg };
}

describe("the schema on PostgreSQL 18", () => {
  test("ids are UUIDv7 from the database, timestamps are UTC instants", async () => {
    const { venue } = await venueAndPackage();
    expect(venue.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(Math.abs(venue.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  test("voucher codes must be upper-case, as RouterOS compares them case-sensitively", async () => {
    const { venue, pkg } = await venueAndPackage();
    const data = { venueId: venue.id, packageId: pkg.id, priceTsh: "1000" };
    await t.db.voucher.create({ data: { ...data, code: "WIFI-8K2F" } });
    const lower = await failure(t.db.voucher.create({ data: { ...data, code: "wifi-9abc" } }));
    expect(lower).toMatch(/vouchers_code_upper/);
  });

  test("codes are unique", async () => {
    const { venue, pkg } = await venueAndPackage();
    const data = { venueId: venue.id, packageId: pkg.id, priceTsh: "1000", code: "WIFI-DUPE" };
    await t.db.voucher.create({ data });
    expect(await failure(t.db.voucher.create({ data }))).toMatch(/Unique constraint/i);
  });

  test("sign-in emails must be lower-case", async () => {
    await t.db.user.create({
      data: { id: Bun.randomUUIDv7(), email: "admin@example.com", name: "Admin" },
    });
    const mixed = await failure(
      t.db.user.create({
        data: { id: Bun.randomUUIDv7(), email: "Manager@Example.com", name: "Manager" },
      }),
    );
    expect(mixed).toMatch(/users_email_lower/);
  });

  test("a membership goes with its user, and one person has one per scope", async () => {
    const id = Bun.randomUUIDv7();
    await t.db.user.create({ data: { id, email: "member@example.com", name: "Member" } });
    await t.db.membership.create({ data: { userId: id, scope: "platform", role: "admin" } });
    await expect(
      (async () =>
        await t.db.membership.create({
          data: { userId: id, scope: "platform", role: "manager" },
        }))(),
    ).rejects.toThrow();
    await t.db.user.delete({ where: { id } });
    expect(await t.db.membership.count({ where: { userId: id } })).toBe(0);
  });

  test("a role belongs to its own scope", async () => {
    const id = Bun.randomUUIDv7();
    await t.db.user.create({ data: { id, email: "scoped@example.com", name: "Scoped" } });
    await expect(
      (async () =>
        await t.db.membership.create({ data: { userId: id, scope: "platform", role: "owner" } }))(),
    ).rejects.toThrow(/memberships_scope_role/);
  });

  test("money keeps its exact decimal value", async () => {
    const { pkg } = await venueAndPackage();
    const read = await t.db.package.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(read.priceTsh.toFixed(2)).toBe("1000.00");
  });

  test("a venue offers a package once", async () => {
    const { venue, pkg } = await venueAndPackage();
    await t.db.venuePackage.create({ data: { venueId: venue.id, packageId: pkg.id } });
    const twice = await failure(
      t.db.venuePackage.create({ data: { venueId: venue.id, packageId: pkg.id } }),
    );
    expect(twice).toMatch(/Unique constraint/i);
  });
});
