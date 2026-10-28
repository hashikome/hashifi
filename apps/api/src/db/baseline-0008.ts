import path from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

const connection = await mysql.createConnection(process.env.DATABASE_URL!);

const migrations = readMigrationFiles({ migrationsFolder });
const m0008 = migrations.find((m) => m.hash && migrations.indexOf(m) === 8);

if (!m0008) {
  console.error("Could not find migration at index 8");
  process.exit(1);
}

const [existing] = await connection.query(
  "SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1",
  [m0008.hash],
);

if (Array.isArray(existing) && existing.length > 0) {
  console.log("0008 already marked as applied — nothing to do.");
} else {
  await connection.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [
    m0008.hash,
    m0008.folderMillis,
  ]);
  console.log("Marked 0008_audit_logs as applied.");
}

await connection.end();
