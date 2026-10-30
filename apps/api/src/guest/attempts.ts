import type { PrismaClient } from "../database/client.js";

/** Whether `key` has used up `max` failures in the last `windowSeconds`. */
export async function isLimited(
  db: PrismaClient,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  const row = await db.rateLimit.findUnique({ where: { key } });
  if (!row) return false;
  const expired = Date.now() - Number(row.lastRequest) >= windowSeconds * 1000;
  return !expired && row.count >= max;
}

/** Counts one failure against `key`, starting a new window once the last has passed. */
export async function countFailure(
  db: PrismaClient,
  key: string,
  windowSeconds: number,
): Promise<void> {
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
