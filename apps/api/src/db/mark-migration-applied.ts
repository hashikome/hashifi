/**
 * Mark a migration as applied WITHOUT running its SQL.
 *
 * For migrations that were applied by hand (piped straight into the `mysql` client) before
 * they had a journal entry. Their DDL is already on disk in the database, so letting
 * `db:migrate` run them would fail on "Duplicate column name". This records them in
 * `__drizzle_migrations` so the migrator skips them and moves on to genuinely new ones.
 *
 *   bun run db:migrate:mark 0009_router_capabilities 0010_provisioning_state
 *
 * Only ever use this when you have verified the schema change is already present in the
 * target database. For anything not yet applied, use `bun run db:migrate`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

type JournalEntry = { idx: number; when: number; tag: string; breakpoints: boolean };

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Set it in backend/.env");
  process.exit(1);
}

const tags = process.argv.slice(2);
if (tags.length === 0) {
  console.error("Usage: bun run db:migrate:mark <tag> [<tag>...]");
  console.error("Example: bun run db:migrate:mark 0011_router_ssid");
  process.exit(1);
}

async function main() {
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };

  // Resolve every tag before touching the database so a typo can't leave a half-done baseline.
  const targets = tags.map((tag) => {
    const entry = journal.entries.find((e) => e.tag === tag);
    if (!entry) {
      throw new Error(
        `No journal entry tagged "${tag}". Known tags: ${journal.entries.map((e) => e.tag).join(", ")}`,
      );
    }
    const sql = fs.readFileSync(path.join(migrationsFolder, `${tag}.sql`), "utf8");
    return { tag, when: entry.when, hash: crypto.createHash("sha256").update(sql).digest("hex") };
  });

  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    await connection.query(
      "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id serial primary key, hash text not null, created_at bigint)",
    );

    // Ascending `when`, because the migrator compares against the newest row only.
    for (const target of [...targets].sort((a, b) => a.when - b.when)) {
      const [rows] = await connection.query(
        "SELECT id FROM __drizzle_migrations WHERE hash = ? LIMIT 1",
        [target.hash],
      );
      if (Array.isArray(rows) && rows.length > 0) {
        console.log(`already recorded — ${target.tag}`);
        continue;
      }
      await connection.query(
        "INSERT INTO __drizzle_migrations (`hash`, `created_at`) VALUES (?, ?)",
        [target.hash, target.when],
      );
      console.log(`marked applied  — ${target.tag}`);
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
