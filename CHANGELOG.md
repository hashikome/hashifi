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
