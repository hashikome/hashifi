import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../../drizzle");
const journalPath = path.join(migrationsFolder, "meta/_journal.json");

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

/**
 * Register hand-written .sql files that aren't in meta/_journal.json yet.
 *
 * drizzle's migrator only reads the journal, so a .sql file dropped into drizzle/ by hand is
 * invisible to it — `db:migrate` reports success while doing nothing. Migrations in this project
 * are usually hand-written rather than produced by `drizzle-kit generate`, so the journal is
 * synced from the folder on every run instead.
 *
 * `when` is assigned as (newest existing + 1 day) rather than from file mtime: the migrator
 * treats it as a monotonic ordering key against the newest applied row, and mtimes are reset by
 * a fresh git clone. Numeric filename prefix decides the order.
 *
 * `idx` comes from that same prefix, not from the entry count — `drizzle-kit generate` names the
 * next snapshot from the newest entry's `idx`, so a count-derived value would collide with an
 * existing snapshot after the history was squashed to a single high-numbered baseline.
 */
function syncJournalWithFolder(): string[] {
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    version: string;
    dialect: string;
    entries: JournalEntry[];
  };
  const journalled = new Set(journal.entries.map((entry) => entry.tag));

  const unjournalled = fs
    .readdirSync(migrationsFolder)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .map((file) => file.replace(/\.sql$/, ""))
    .filter((tag) => !journalled.has(tag))
    .sort((a, b) => Number(a.slice(0, 4)) - Number(b.slice(0, 4)));

  if (unjournalled.length === 0) return [];

  const DAY_MS = 86_400_000;
  let when = journal.entries.reduce((max, entry) => Math.max(max, entry.when), 0);

  for (const tag of unjournalled) {
    when += DAY_MS;
    journal.entries.push({
      idx: Number(tag.slice(0, 4)),
      version: "5",
      when,
      tag,
      breakpoints: true,
    });
  }

  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return unjournalled;
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Set it in backend/.env");
  process.exit(1);
}

async function tableExists(connection: mysql.Connection, tableName: string): Promise<boolean> {
  const [rows] = await connection.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [tableName],
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** If schema was created via db:push, mark initial migration as applied without re-running DDL. */
async function baselineExistingSchema(connection: mysql.Connection) {
  const migrations = readMigrationFiles({ migrationsFolder });
  if (migrations.length === 0) return;

  // A brand-new database has no history table yet — nothing to baseline, and querying it would
  // throw. The migrator creates it itself on the run that follows.
  if (!(await tableExists(connection, "__drizzle_migrations"))) return;

  const [applied] = await connection.query("SELECT COUNT(*) AS count FROM __drizzle_migrations");
  const appliedCount = Number((applied as mysql.RowDataPacket[])[0]?.count ?? 0);
  if (appliedCount > 0) return;

  const hasCoreTables =
    (await tableExists(connection, "admin_users")) &&
    (await tableExists(connection, "portal_settings"));
  if (!hasCoreTables) return;

  const initial = migrations[0];
  console.log(
    "Detected existing schema without migration history — baselining",
    `${initial.hash.slice(0, 12)}...`,
  );

  await connection.query("INSERT INTO __drizzle_migrations (`hash`, `created_at`) VALUES (?, ?)", [
    initial.hash,
    initial.folderMillis,
  ]);
}

async function main() {
  const registered = syncJournalWithFolder();
  if (registered.length > 0) {
    console.log(
      `Registered ${registered.length} unjournalled migration(s): ${registered.join(", ")}`,
    );
    console.log("meta/_journal.json was updated — commit it.");
  }

  const pool = mysql.createPool(process.env.DATABASE_URL!);
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    try {
      await baselineExistingSchema(connection);
    } finally {
      // Must close on the failure path too, or an open socket keeps the event loop alive and the
      // process hangs instead of reporting the error and exiting.
      await connection.end();
    }

    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    console.log("Migrations applied successfully.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown migration error";
    console.error("Migration failed:", message);
    if (error instanceof Error && "cause" in error && error.cause instanceof Error) {
      console.error("Cause:", error.cause.message);
    }
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
