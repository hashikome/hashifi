# Technical debt

Accepted compromises: what was accepted, why, and what would retire it.

| Item | Why accepted | Retired by |
| --- | --- | --- |
| Biome override in `biome.json` downgrades the type and correctness rules to warnings for `apps/api/src/{routes,middleware,db}/`, `server.ts` and `drizzle.config.ts` | That code is replaced wholesale; typing it first would be discarded work | The adoption plan's M3 (Drizzle layer) and M4 (Express app) deleting it; then remove the override |
| `apps/web/lib/types.ts` is a hand-written, partly stale copy of API shapes (`Venue`, `Router`, `WifiUser`, `ActiveSession`) | The real contract is defined with the NestJS DTOs | M4: `@hashifi/types` covers every response; the file is deleted |
| Each admin page calls `fetch` with its own URL fallback | Replaced with the contract | M4: one API client module |
| Router API passwords use AES-256-CBC | Nothing is stored yet; the key is now required | M4: AES-256-GCM |
| Local development of `apps/api` needs MySQL 8 | The schema is still Drizzle on MySQL | M3: Prisma on the `compose.yml` PostgreSQL |
