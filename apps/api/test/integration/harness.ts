import { afterAll, beforeAll, beforeEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { createPrismaClient, type PrismaClient } from "../../src/database/client.js";

/**
 * Integration tests run against `hashifi_test` (the compose.yml PostgreSQL), migrated once per
 * run with the real migrations, and emptied before each test. Run with `bun run test:integration`.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://hashifi:hashifi@127.0.0.1:5437/hashifi_test";

let migrated = false;

function migrate(): void {
  if (migrated) return;
  const result = spawnSync("bun", ["--bun", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${result.stdout}\n${result.stderr}`);
  }
  migrated = true;
}

/** A Prisma client on an empty, migrated test database for every test in the file. */
export function useTestDatabase(): { readonly db: PrismaClient } {
  const holder: { db: PrismaClient | null } = { db: null };
  beforeAll(() => {
    migrate();
    holder.db = createPrismaClient(TEST_DATABASE_URL);
  });
  beforeEach(async () => {
    const db = holder.db;
    if (!db) throw new Error("test database not ready");
    const tables = await db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length > 0) {
      const list = tables.map((t) => `"${t.tablename}"`).join(", ");
      await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    }
  });
  afterAll(async () => {
    await holder.db?.$disconnect();
  });
  return {
    get db(): PrismaClient {
      if (!holder.db) throw new Error("test database not ready");
      return holder.db;
    },
  };
}
