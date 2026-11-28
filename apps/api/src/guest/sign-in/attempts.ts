import type { PrismaClient } from "../../core/database/client.js";

/** The client or a transaction: a limit counted inside one commits with it. */
type Db = Pick<PrismaClient, "rateLimit" | "$executeRaw">;

/** When `key`'s window ends, if it has used up `max` failures in it; null when it hasn't. */
async function limitedUntil(
  db: Db,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<Date | null> {
  const row = await db.rateLimit.findUnique({ where: { key } });
  if (!row) return null;
  const ends = Number(row.lastRequest) + windowSeconds * 1000;
  return ends > Date.now() && row.count >= max ? new Date(ends) : null;
}

/** Whether `key` has used up `max` failures in the last `windowSeconds`. */
export async function isLimited(
  db: Db,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  return (await limitedUntil(db, key, max, windowSeconds)) !== null;
}

/** Counts one failure against `key`, starting a new window once the last has passed. */
export async function countFailure(db: Db, key: string, windowSeconds: number): Promise<void> {
  const now = BigInt(Date.now());
  const cutoff = now - BigInt(windowSeconds * 1000);
  await db.$executeRaw`
    INSERT INTO rate_limits (id, key, count, last_request)
    VALUES (uuidv7(), ${key}, 1, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.last_request < ${cutoff} THEN 1 ELSE rate_limits.count + 1 END,
      last_request = CASE WHEN rate_limits.last_request < ${cutoff}
        THEN ${now} ELSE rate_limits.last_request END`;
}
