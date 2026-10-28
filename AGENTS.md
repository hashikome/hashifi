# HashiFi

Time-bound, device-limited WiFi access sold as vouchers through a captive portal, for a home
and for venues with their own MikroTik routers. A cloud backend configures the routers,
issues vouchers and tracks sessions. Public repository (FSL-1.1-ALv2); production domain not
yet chosen.

This repository is the source of truth for the HashiFi product and engineering decisions.
External documents are references only. Keep this file short: it is a map, not a manual.

## Current state

`apps/api` (Express, Drizzle, MySQL) and `apps/web` (Next.js) are a purchased system imported
as received in commit `45ebd53`. They are being ported to the stack below by
[docs/exec-plans/active/adopt-purchased-billing-system.md](docs/exec-plans/active/adopt-purchased-billing-system.md):
read it before changing anything under `apps/`. Until its toolchain milestone lands, the root
commands below are the target, not yet working, and the vendor READMEs in `apps/*/README.md`
describe the code as received.

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

- `bun install`; `bun run dev` starts the API and web against local infrastructure
  (`bun run infra:up`).
- `bun run verify`: formatting, lint, typecheck, tests and builds. It must pass before a
  commit.
- `bun run db:migrate` is the only way to apply a migration.

## Toolchain

- Bun for package installation, workspaces, scripts, tests and CI (`bun ci`). Commit
  `bun.lock`; never add npm, Yarn or pnpm lockfiles.
- Pin exact dependency versions, starting on the newest stable releases that work together.
- NestJS runs on the Bun runtime. Prefer Bun-native APIs when they meet the contract.
- Prisma through package scripts backed by `bunx --bun prisma`. The web never imports Prisma
  Client or generated Prisma types.
- Before editing Next.js code, read the version-matched guide under
  `apps/web/node_modules/next/dist/docs/`; framework APIs change between releases.
- Biome formats and lints (`bun run check`).
- Conventional Commits: `feat(api): ...`, `fix(web): ...`, `docs: ...`, `chore: ...`.

## Pre-deployment compatibility

Until the owner changes this policy, the repository is one unreleased release unit. Do not
preserve compatibility for superseded routes, shapes, schemas or docs: update every producer
and consumer together and remove the replaced implementation. This does not relax data
safety: never rewrite an applied shared migration or discard user data without explicit
approval.

## Rules that are easy to break

- **The API owns business logic and workflows; the web presents**
  ([ADR-0003](docs/engineering-decisions/0003-api-owns-logic-web-presents.md)). That includes
  the captive portal: the API decides, the web renders. Totals, statuses and durations come
  from the API. Authorization is enforced by the API, never inferred from what the UI shows.
- **Nothing reports success before the router confirms it.** A paid voucher or an `active`
  row is not a device online. Vouchers go `unused → pending_activation → active` only after
  the router reads the user back; any new path that grants access follows the same rule.
- **Never assume what a MikroTik supports: probe, then branch.** Board and RouterOS
  differences belong only in the provisioning dialect
  (`apps/api/src/services/router-provision/dialect.ts` until the port moves it).
- **A voucher code is a credential** (it is the hotspot username and password). Never return
  it in a response keyed only by a MAC address, and never use a URL from a request (such as
  `link-login`) without validating it against a registered router.
- **Time:** stored in UTC; business days are calculated in `Africa/Dar_es_Salaam`.
- **Copy:** mobile money is "mobile money" and "mobile number"; never name a provider.
- **Personal data:** the purchased system's original archive contained third parties' data
  (database dumps, uploads). It stays out of the repository, `ref/` and logs. Development uses
  seeded, invented data only.
- **Secrets**: Docker secrets (`<NAME>_FILE`) for sensitive values, an env file for the rest
  (`.env.example` lists each key); the application never depends on a password manager
  ([docs/SECURITY.md](docs/SECURITY.md#credentials)).
- `ref/` is for disposable, git-ignored references and handoffs
  ([docs/runbooks/reference-context.md](docs/runbooks/reference-context.md)); never secrets,
  personal data or the only copy of a decision.
