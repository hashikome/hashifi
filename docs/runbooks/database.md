# Database

PostgreSQL 18, through Prisma 7. The schema is `apps/api/prisma/schema.prisma`; migrations
are `apps/api/prisma/migrations/`. Locally, `compose.yml` runs PostgreSQL on `127.0.0.1:5437`
with three databases: `hashifi` (development), `hashifi_test` (integration tests) and
`hashifi_sim` (the router sim).

## Local setup

```bash
bun run infra:up      # PostgreSQL, waiting until healthy
bun run db:deploy     # apply every migration
bun run db:seed       # invented data: admin@example.com, a venue, packages; safe to repeat
```

`apps/api/.env` holds `DATABASE_URL` and `ENCRYPTION_KEY` (see `.env.example`). Prisma does not
read `.env` itself; `prisma.config.ts` loads it, and set variables win.

## Changing the schema

1. Edit `schema.prisma`.
2. `bun run db:migrate -- --name <what-changed>` creates the migration and applies it to the
   development database. For a constraint Prisma cannot express (a `CHECK`), use
   `-- --create-only`, add the SQL to the generated file, then run `bun run db:migrate` again.
3. Commit the schema and the migration together. Never edit a migration once it has been
   applied anywhere shared; write a new one.

Pre-deployment, a destructive change is fine locally: `bun run --filter @hashifi/api db:reset`
drops and re-creates the development database.

## Tests

`bun run test:integration` migrates `hashifi_test` with the real migrations and empties it
before each test (`apps/api/test/integration/harness.ts`). Create the database once:
`docker exec hashifi-postgres createdb -U hashifi hashifi_test`.

## Rules the schema enforces

- Sign-in identity is Better Auth's (`users`, `sessions`, `accounts`, `verifications`,
  `two_factors`, `rate_limits`); what a person may do is `staff`, sharing the user's id
  (ADR-0007). Guest devices are `devices`, one per MAC address, not people.
- Voucher codes and prefixes are upper-case and emails lower-case (`CHECK` constraints):
  RouterOS compares hotspot usernames case-sensitively, so input is normalised before lookup.
- Instants are `timestamptz` in UTC; business days are computed in `Africa/Dar_es_Salaam`
  (`src/analytics/business-day.ts`), never with a fixed offset.
- Money is `DECIMAL` in TSH and leaves the API as an exact decimal string.
