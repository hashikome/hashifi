# ADR-0002: Bun workspaces, NestJS, Prisma and PostgreSQL

Status: accepted, 28 October 2026; widened the same day with email delivery and the queue.

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
- **Biome** formats and lints (code and configuration; Markdown is not reformatted).
- **Resend** delivers email, replacing the purchased code's SMTP mailer.
- **BullMQ on Redis** when work needs a queue, as in Pigfarm: PostgreSQL stays authoritative and
  the queue dispatches. A better tool for a specific job may be chosen with its reason recorded.
- Versions start on the newest stable releases that work together and are pinned exactly.
  At adoption that is Bun 1.4.4, NestJS 12, Next.js 16.4 and TypeScript 7.0 (including the
  web: Next.js 16.4 loads TypeScript 7), newer than the siblings' Bun 1.3.14 and NestJS 11.
  NestJS 12 was checked on Bun 1.4.4, and the purchased tests pass on it. A registry's
  `latest` tag is not proof of stability: Prisma's pointed at a release candidate, so 7.10.1.

## Rationale

One stack across products shares conventions, templates and platform services. The port
rewrites every query anyway, so moving the ORM costs little extra.
