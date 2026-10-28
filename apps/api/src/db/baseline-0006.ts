/**
 * One-shot script: marks migration 0006 as applied (the column already exists
 * from a prior db:push) so that db:migrate can proceed to run 0007.
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { readMigrationFiles } from "drizzle-orm/migrator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

const connection = await mysql.createConnection(process.env.DATABASE_URL!);

const migrations = readMigrationFiles({ migrationsFolder });
const m0006 = migrations.find((m) => m.hash && migrations.indexOf(m) === 6);

if (!m0006) {
  console.error("Could not find migration at index 6");
  process.exit(1);
}

const [existing] = await connection.query(
  "SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1",
  [m0006.hash],
);

if (Array.isArray(existing) && existing.length > 0) {
  console.log("0006 already marked as applied — nothing to do.");
} else {
  await connection.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [
    m0006.hash,
    m0006.folderMillis,
  ]);
  console.log("Marked 0006_router_hotspot_ip as applied.");
}

await connection.end();
