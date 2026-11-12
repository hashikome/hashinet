import type { PrismaClient } from "../database/client.js";

/** The packages every new business starts with (ADR-0011, 10), in the order they are shown. */
export const DEFAULT_PACKAGES = [
  { name: "1 hour", durationMinutes: 60, deviceLimit: 1, priceTsh: "500" },
  { name: "1 day", durationMinutes: 1440, deviceLimit: 1, priceTsh: "1500" },
  { name: "1 week", durationMinutes: 10080, deviceLimit: 2, priceTsh: "7000" },
] as const;

export interface PlatformAdmin {
  email: string;
  name: string;
}

export interface BootstrapResult {
  admin: "created" | "exists";
  defaultPackages: "created" | "exist";
}

/**
 * What a fresh database needs before anyone can be invited: the platform's admin and the
 * default packages. Safe to repeat: an existing admin or set of defaults is left alone. Nothing
 * else is created; businesses, venues and people come only from invitations (ADR-0011).
 * The admin protects their sign-in from Account and security at first sign-in.
 */
export async function bootstrapPlatform(
  db: PrismaClient,
  input: PlatformAdmin,
): Promise<BootstrapResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email is required.");
  if (name === "") throw new Error("A name is required.");

  return db.$transaction(async (tx) => {
    const existing = await tx.membership.findFirst({
      where: { scope: "platform", role: "admin", status: "active" },
    });
    let admin: BootstrapResult["admin"] = "exists";
    if (existing === null) {
      const user =
        (await tx.user.findUnique({ where: { email } })) ??
        (await tx.user.create({
          data: { id: Bun.randomUUIDv7(), email, name, emailVerified: true },
        }));
      await tx.membership.create({
        data: { userId: user.id, scope: "platform", role: "admin" },
      });
      admin = "created";
    }

    let defaultPackages: BootstrapResult["defaultPackages"] = "exist";
    if ((await tx.platformDefaultPackage.count()) === 0) {
      await tx.platformDefaultPackage.createMany({
        data: DEFAULT_PACKAGES.map((p, position) => ({ ...p, position })),
      });
      defaultPackages = "created";
    }
    return { admin, defaultPackages };
  });
}
