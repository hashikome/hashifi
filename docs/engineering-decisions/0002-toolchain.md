# ADR-0002: Bun workspaces, NestJS, Prisma and PostgreSQL

Status: accepted, 28 October 2026.

## Context

The purchased system runs Express on Node with Drizzle and MySQL, managed with pnpm. The
other Hashikome TypeScript products (ntumie., Pigfarm) run NestJS on the Bun runtime with
Prisma and PostgreSQL, and the shared platform provides PostgreSQL 18.

## Options considered

- Keep Express, Drizzle and MySQL: least porting, but a dedicated MySQL instance would need
  a reason the platform does not have, and the stack would differ from every sibling.
- Keep Express and Drizzle on PostgreSQL: smaller change, still a different stack.
- NestJS on Bun, Prisma and PostgreSQL, as the other products.

## Decision

- **Bun** manages packages, workspaces, scripts and tests, and runs the API. One committed
  `bun.lock`; no pnpm or npm.
- **`apps/api`**: NestJS on Bun. **`apps/web`**: Next.js.
- **Prisma** with the shared platform's **PostgreSQL 18**.
- **Biome** formats and lints.
- Versions start on the newest stable releases that work together and are pinned exactly.
  At adoption that is Bun 1.4.4 and NestJS 12, newer than the siblings' Bun 1.3.14 and
  NestJS 11; NestJS 12 was checked on Bun 1.4.4, and the purchased tests pass on it.

## Rationale

One stack across products shares conventions, templates and platform services. The port
rewrites every query anyway, so moving the ORM costs little extra.
