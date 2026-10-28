# Core beliefs

## Repository knowledge

- The repository is the source of truth for implementation decisions.
- `AGENTS.md` and `ARCHITECTURE.md` are maps; detail lives in focused documents next to
  the concern.
- Substantial work is recorded in versioned ExecPlans ([PLANS.md](../PLANS.md)).

## Architecture

- Stay lean: no new service without a measured need. Shared platform services by purpose
  are the default; a dedicated instance needs a concrete, recorded reason.
- The API owns rules and derived state; clients are replaceable delivery surfaces.
- Nothing reports success before the system that does the work confirms it.

## Delivery

- Small, verifiable steps; every step ends with `bun run verify` passing.
- Releases go through the GitHub pipeline only: CI builds immutable images and Dokploy
  deploys them.
- Renames and contract changes cut over cleanly; no compatibility shims for retired names.
- Record accepted compromises in [backlog/technical-debt.md](backlog/technical-debt.md).

## Product safety

- Access is granted by the router and reported only once the router confirms it.
- A voucher code is a credential.
- Guests' personal data is minimal: an optional phone number and the device details the
  router reports.
