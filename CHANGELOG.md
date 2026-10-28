# Changelog

## Unreleased

- HashiFi is built from a purchased hotspot billing system, imported as received under
  `apps/api` and `apps/web` without the seller's database dumps and uploads
  ([ADR-0001](docs/engineering-decisions/0001-adopt-purchased-billing-system.md)).
- Repository structure from the Hashikome product template: product, architecture and
  design documents, decisions, ExecPlans, runbooks and policies. The empty Django skeleton
  is removed; the network architecture reference moved to `docs/design-docs/`.
- Licensed under FSL-1.1-ALv2 (Shikome Technology Limited).
- Bun manages packages: pnpm and npm files removed; packages renamed `@hashifi/api` and
  `@hashifi/web`.
- Toolchain (adoption plan M1): one root `bun.lock` with every dependency on its newest stable
  release, pinned (Bun 1.4.4, Next.js 16.4.3, React 19.3.1, TypeScript 7.0.2); Biome formats and
  lints; `bun run verify` runs format, lint, typecheck, the 170 tests and the web build. Type
  errors now fail the web build.
- `@hashifi/types` carries the API's JSON contract for packages, vouchers and portal settings;
  no `any`, `undefined` fields or non-null assertions in the web or the kept API services
  ([ADR-0004](docs/engineering-decisions/0004-types-without-any-or-undefined.md)).
- Fixed: printing vouchers without saved portal settings crashed; a manager whose role loaded
  late lost the preselected venue on voucher creation; the voucher preview showed the price with
  decimals.
- Removed what HashiFi does not use: the starter dashboard and its sample data, unused UI
  components and assets, 30 unused dependencies, Vercel Analytics.
- Named HashiFi throughout (interface, emails, router pages, cookie and storage keys); demo
  accounts use `example.com`. The API refuses to start without `ENCRYPTION_KEY`.
- Decided: email through Resend, BullMQ on Redis for queues, and sign-in from the shared
  Hashikome identity service ([ADR-0005](docs/engineering-decisions/0005-shared-identity.md)).
