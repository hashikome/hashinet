// Local development data, all invented: the prototype's personas (prototypes/hearth-design) with
// example.com addresses, so the screens can be checked against it. Safe to run again.
// Run with `bun run db:seed`. Production starts from `bun run platform:bootstrap` instead.
import type { BusinessRole, Region } from "@hashinet/types";
import { loadConfig } from "../src/config/config.js";
import { createPrismaClient } from "../src/database/client.js";
import { beginOnboarding } from "../src/onboarding/begin.js";
import { bootstrapPlatform, DEFAULT_PACKAGES } from "../src/platform/bootstrap.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("The seed is for local development only.");
}

const db = createPrismaClient(loadConfig().databaseUrl);

await bootstrapPlatform(db, { email: "paul@example.com", name: "Paul John" });

async function person(email: string, name: string) {
  return (
    (await db.user.findUnique({ where: { email } })) ??
    (await db.user.create({ data: { id: Bun.randomUUIDv7(), email, name, emailVerified: true } }))
  );
}

async function platformMember(email: string, name: string, role: "manager" | "operator") {
  const user = await person(email, name);
  const existing = await db.membership.findFirst({ where: { userId: user.id, scope: "platform" } });
  if (!existing) await db.membership.create({ data: { userId: user.id, scope: "platform", role } });
}

interface SeedVenue {
  name: string;
  region: Region;
  area: string;
}

/**
 * A business with its venues, its own copy of the default packages sold at every venue, and its
 * owner. Found by name, so a second run adds nothing.
 */
async function business(
  name: string,
  region: Region,
  area: string,
  venues: SeedVenue[],
  owner: [email: string, name: string],
) {
  const found = await db.business.findFirst({ where: { name }, include: { venues: true } });
  if (found) return found;
  const created = await db.business.create({
    data: { name, region, area, venues: { create: venues } },
    include: { venues: true },
  });
  // Every venue starts at its package, as one created in the app does.
  for (const v of created.venues) await beginOnboarding(db, v.id);
  for (const p of DEFAULT_PACKAGES) {
    await db.package.create({
      data: {
        businessId: created.id,
        name: p.name,
        durationMinutes: p.durationMinutes,
        deviceLimit: p.deviceLimit,
        priceTsh: p.priceTsh,
        downloadSpeedMbps: 10,
        venues: { create: created.venues.map((v) => ({ venueId: v.id })) },
      },
    });
  }
  const user = await person(...owner);
  await db.membership.create({
    data: { userId: user.id, scope: "business", businessId: created.id, role: "owner" },
  });
  return created;
}

async function businessMember(
  businessId: string,
  email: string,
  name: string,
  role: Exclude<BusinessRole, "owner">,
  venueIds: string[] = [],
) {
  const user = await person(email, name);
  const existing = await db.membership.findFirst({ where: { userId: user.id, businessId } });
  if (existing) return;
  await db.membership.create({
    data: {
      userId: user.id,
      scope: "business",
      businessId,
      role,
      venues: { create: venueIds.map((venueId) => ({ venueId })) },
    },
  });
}

await platformMember("asha@example.com", "Asha Komba", "manager");
await platformMember("hamisi@example.com", "Hamisi Juma", "operator");

const neema = await business(
  "Neema Hospitality",
  "Mwanza",
  "Isamilo",
  [
    { name: "Mama Neema Lodge", region: "Mwanza", area: "Isamilo" },
    { name: "Kijiwe Café", region: "Mwanza", area: "Kirumba" },
    { name: "Rock City Hostel", region: "Mwanza", area: "Capri Point" },
  ],
  ["neema@example.com", "Neema Mushi"],
);
const lodge = neema.venues.find((v) => v.name === "Mama Neema Lodge");
const cafe = neema.venues.find((v) => v.name === "Kijiwe Café");
if (!lodge || !cafe) throw new Error("Neema Hospitality's venues are missing.");
await businessMember(neema.id, "grace@example.com", "Grace Wambura", "business_manager");
await businessMember(neema.id, "daudi@example.com", "Daudi Masanja", "venue_manager", [lodge.id]);
await businessMember(neema.id, "musa@example.com", "Musa Lyimo", "venue_operator", [cafe.id]);

await business(
  "Juma's home",
  "Dar es Salaam",
  "Mbweni",
  [{ name: "Juma's home", region: "Dar es Salaam", area: "Mbweni" }],
  ["juma@example.com", "Juma Said"],
);
await business(
  "Bahari Beach Bar",
  "Dar es Salaam",
  "Mjimwema, Kigamboni",
  [{ name: "Bahari Beach Bar", region: "Dar es Salaam", area: "Mjimwema, Kigamboni" }],
  ["baraka@example.com", "Baraka Mollel"],
);

const counts = {
  businesses: await db.business.count(),
  venues: await db.venue.count(),
  memberships: await db.membership.count(),
  packages: await db.package.count(),
};
console.log(`Seeded: ${JSON.stringify(counts)}`);
await db.$disconnect();
