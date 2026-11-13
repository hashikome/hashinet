import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { MembershipRole } from "../../src/generated/prisma/enums.js";

/** Invented people, businesses and venues for the integration tests (ADR-0011's model). */

export interface Person {
  /** The user's id. */
  id: string;
  membershipId: string;
  email: string;
}

async function user(db: PrismaClient, given: string, name: string) {
  // Stored lower-case, as acceptance stores it (and the database requires).
  const email = given.trim().toLowerCase();
  return (
    (await db.user.findUnique({ where: { email } })) ??
    (await db.user.create({ data: { id: Bun.randomUUIDv7(), email, name, emailVerified: true } }))
  );
}

/** A person on HashiNet's own team. */
export async function platformMember(
  db: PrismaClient,
  input: { email: string; name: string; role?: "admin" | "manager" | "operator" },
): Promise<Person> {
  const u = await user(db, input.email, input.name);
  const m = await db.membership.create({
    data: { userId: u.id, scope: "platform", role: input.role ?? "admin" },
  });
  return { id: u.id, membershipId: m.id, email: input.email };
}

/** The business most tests work in, created on first use. */
export async function testBusinessId(db: PrismaClient, name = "Test Business"): Promise<string> {
  const found = await db.business.findFirst({ where: { name } });
  if (found) return found.id;
  return (await db.business.create({ data: { name, region: "Dar es Salaam", area: "Test" } })).id;
}

/** A person in a business, with venues for a venue manager or venue operator. */
export async function businessMember(
  db: PrismaClient,
  input: {
    email: string;
    name: string;
    role: Extract<
      MembershipRole,
      "owner" | "business_manager" | "venue_manager" | "venue_operator"
    >;
    businessId?: string;
    venueIds?: string[];
  },
): Promise<Person> {
  const u = await user(db, input.email, input.name);
  const businessId = input.businessId ?? (await testBusinessId(db));
  const m = await db.membership.create({
    data: {
      userId: u.id,
      scope: "business",
      businessId,
      role: input.role,
      venues: { create: (input.venueIds ?? []).map((venueId) => ({ venueId })) },
    },
  });
  return { id: u.id, membershipId: m.id, email: input.email };
}

/** Gives a venue manager or operator another venue. */
export async function assignVenue(
  db: PrismaClient,
  person: Person,
  venueId: string,
): Promise<void> {
  await db.membershipVenue.create({ data: { membershipId: person.membershipId, venueId } });
}

/** The business's owner (found, or created), with their sign-in protected, so its venues serve
 * guests (ADR-0011, 9). */
export async function protectedOwner(db: PrismaClient, businessId?: string): Promise<void> {
  const business = businessId ?? (await testBusinessId(db));
  const found = await db.membership.findFirst({
    where: { businessId: business, role: "owner", status: "active" },
  });
  const userId =
    found?.userId ??
    (
      await businessMember(db, {
        email: "owner@example.com",
        name: "Owner",
        role: "owner",
        businessId: business,
      })
    ).id;
  await db.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
}

/** A venue whose setup is scheduled, so a router may be added to it (ADR-0013, 1). */
export async function scheduledSetup(db: PrismaClient, venueId: string): Promise<void> {
  await db.venueOnboarding.upsert({
    where: { venueId },
    create: { venueId, setupDate: new Date() },
    update: { setupDate: new Date() },
  });
}
