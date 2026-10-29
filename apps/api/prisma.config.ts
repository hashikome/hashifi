import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";
import { readSecret } from "./src/config/secret.js";

// Prisma 7 does not read .env, and Bun does not load it when running Prisma's binary. Local
// development keeps its values in apps/api/.env; containers have none and use their secrets.
// Variables already set win over the file.
if (existsSync(".env")) process.loadEnvFile(".env");

const LOCAL_DATABASE_URL = "postgresql://hashifi:hashifi@127.0.0.1:5437/hashifi";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "bun prisma/seed.ts",
  },
  datasource: {
    // The same _FILE-first contract as the API runtime (docs/SECURITY.md, Credentials). Without
    // one, the local compose.yml database, so `prisma generate` works on a fresh clone and in CI
    // (it never connects); migrations against anything else must set DATABASE_URL(_FILE).
    url: readSecret("DATABASE_URL") ?? LOCAL_DATABASE_URL,
  },
});
