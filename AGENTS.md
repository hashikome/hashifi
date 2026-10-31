# HashiFi

Time-bound, device-limited WiFi access sold as vouchers through a captive portal, for a home
and for venues with their own MikroTik routers. A cloud backend configures the routers,
issues vouchers and tracks sessions. Private until HashiFi is ready to deploy, then public
(FSL-1.1-ALv2); production domain not yet chosen.

This repository is the source of truth for the HashiFi product and engineering decisions.
External documents are references only. Keep this file short: it is a map, not a manual.

## Current state

The [build plan](docs/exec-plans/active/build-hashifi.md) tracks the work: read
it before changing anything under `apps/`. M1 to M5 are done. HashiFi launches on printed vouchers; M6
(mobile money and SMS) is built and held until its providers' credentials exist: `apps/api` is NestJS on Bun with Prisma on PostgreSQL 18, and `apps/web` runs on it
through `lib/api.ts` and `@hashifi/types`, including the captive portal and purchases.

## Map

- [PRODUCT.md](PRODUCT.md): requirements (the PRD). [ARCHITECTURE.md](ARCHITECTURE.md): system
  authority. [DESIGN.md](DESIGN.md): visual system and tokens. [PLANS.md](PLANS.md): ExecPlans.
- [docs/README.md](docs/README.md): design documents, engineering decisions, ExecPlans,
  runbooks, and the security and reliability policies.
- [README.md](README.md) is the user and developer guide.

## Working rhythm

1. **Brief before implementing.** State what is about to change and why, in a sentence or
   two or in the ExecPlan, before touching files.
2. For substantial work, read `PLANS.md` and create or update an ExecPlan in
   `docs/exec-plans/active/`.
3. **Implement the complete milestone**, not fragments, then run `bun run verify`.
4. **Record settled decisions** as an ADR in `docs/engineering-decisions/`.
5. For completed work, update `CHANGELOG.md` before preparing commits.

## Commands

- `bun install` (generates Prisma Client); `bun run infra:up` starts PostgreSQL 18 on
  `127.0.0.1:5437`; `bun run db:deploy` and `bun run db:seed` prepare it; `bun run dev`.
- `bun run verify`: formatting, lint, typecheck, unit tests and builds. It must pass before a
  commit. `bun run test:integration` runs the database tests against `hashifi_test`.
- Schema changes: edit `apps/api/prisma/schema.prisma`, then `bun run db:migrate` (creates and
  applies a migration); never edit an applied migration. See `docs/runbooks/database.md`.
- `bun run router-sim ...` runs a virtual MikroTik (`docs/runbooks/router-sim.md`).

## Toolchain

- Bun for package installation, workspaces, scripts, tests and CI (`bun ci`). Commit
  `bun.lock`; never add npm, Yarn or pnpm lockfiles.
- Pin exact dependency versions, starting on the newest stable releases that work together.
- NestJS runs on the Bun runtime. Prefer Bun-native APIs when they meet the contract.
- Prisma through package scripts backed by `bunx --bun prisma`. The web never imports Prisma
  Client or generated Prisma types.
- Before editing Next.js code, read the version-matched guide under
  `apps/web/node_modules/next/dist/docs/`; framework APIs change between releases.
- Biome formats and lints code and configuration (`bun run check`); it does not reformat
  Markdown.
- Observability: LogTape and Sentry, one wide event per request and per job, PII-minimized
  (ADR-0002); no `console.log` in application code once M4 lands.
- Email through Resend. Queues, where needed, are BullMQ on Redis with PostgreSQL
  authoritative.
- Sign-in is Better Auth inside HashiFi, with email codes
  ([ADR-0007](docs/engineering-decisions/0007-sign-in-with-better-auth.md)); admins must use an
  authenticator app. Its tables hold identity and sessions; `staff` holds role, status and venue
  scope. Read authorization only from `staff`.
- Conventional Commits: `feat(api): ...`, `fix(web): ...`, `docs: ...`, `chore: ...`.

## Pre-deployment compatibility

Until the owner changes this policy, the repository is one unreleased release unit. Do not
preserve compatibility for superseded routes, shapes, schemas or docs: update every producer
and consumer together and remove the replaced implementation. Nothing inherited is binding: when
there is a better way, drop whatever stands in the way, whether a package, a module, a model or
a business workflow. This does not relax data safety: never rewrite an applied shared migration
or discard user data without explicit approval.

## Rules that are easy to break

- **The API owns business logic and workflows; the web presents**
  ([ADR-0003](docs/engineering-decisions/0003-api-owns-logic-web-presents.md)). That includes
  the captive portal: the API decides, the web renders. Totals, statuses and durations come
  from the API. Authorization is enforced by the API, never inferred from what the UI shows.
- **No `any`, no `undefined`, no `!`** ([ADR-0004](docs/engineering-decisions/0004-types-without-any-or-undefined.md)).
  Absence is `null`; unknown shapes are `unknown` and narrowed. The web reads API responses
  through `@hashifi/types`.
- **Nothing reports success before the router confirms it.** A paid voucher or an `active`
  row is not a device online. Vouchers go `unused → pending_activation → active` only after
  the router reads the user back; any new path that grants access follows the same rule.
- **Never assume what a MikroTik supports: probe, then branch.** Board and RouterOS
  differences belong only in the provisioning dialect
  (`apps/api/src/services/router-provision/dialect.ts` until the port moves it).
- **A voucher code is a credential** (it is the hotspot username and password). It goes only to
  the session that paid, proved by a secret, or to staff; never to a page the router serves. Only the API signs a device in
  ([ADR-0008](docs/engineering-decisions/0008-captive-portal.md)): the router accepts no login
  from the network, so never enable an http login method.
- **Time:** stored in UTC; business days are calculated in `Africa/Dar_es_Salaam`.
- **Copy:** mobile money is "mobile money" and "mobile number"; never name a provider.
- **Personal data:** real people's data stays out of the repository, `ref/` and logs.
  Development uses seeded, invented data only.
- **Secrets**: Docker secrets (`<NAME>_FILE`) for sensitive values, an env file for the rest
  (each app's `.env.example` lists its keys); the application starts from these alone, in its own scope
  ([docs/SECURITY.md](docs/SECURITY.md#credentials)).
- `ref/` is for disposable, git-ignored references and handoffs
  ([docs/runbooks/reference-context.md](docs/runbooks/reference-context.md)); never secrets,
  personal data or the only copy of a decision.
