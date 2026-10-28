import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema.js";

// MySQL is pinned to UTC (below) so stored timestamps are unambiguous. But app code
// that computes calendar boundaries with local Date methods (setHours(0,0,0,0),
// new Date(y, m, 1), getMonth(), etc — see routes/revenue.ts, routes/analytics.ts)
// needs "local" to mean the business's timezone, not the host machine's. Pinning TZ
// here (imported before any route module) makes that resolve to Tanzania correctly
// regardless of what timezone the server/container itself runs in.
process.env.TZ = process.env.TZ || "Africa/Dar_es_Salaam";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  timezone: "+00:00", // mysql2 native Date parsing (unused by Drizzle, which reads raw strings)
});

// Drizzle reads TIMESTAMP/DATETIME columns as raw strings and assumes they are UTC
// (it appends "+0000" itself). That's only true if the MySQL session's time_zone is
// actually UTC — the pool's `timezone` option above does NOT set that server-side.
// Without this, NOW()/CURRENT_TIMESTAMP use the server's SYSTEM timezone (e.g. EAT,
// +3) and get double-shifted when converted to local time on the frontend.
pool.on("connection", (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

export const db = drizzle({ client: pool, schema, mode: "default" });

export type DbClient = typeof db;
