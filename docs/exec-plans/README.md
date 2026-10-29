# Execution plans

Substantial work is recorded in versioned ExecPlans (format: [PLANS.md](../../PLANS.md)). A
plan is a temporary implementation document, not an archive.

- `active/`: work planned for implementation with its details, or in progress, updated at
  every meaningful stopping point.
- [TEMPLATE.md](TEMPLATE.md): the starting point for a new plan.
- Work not yet shaped enough to implement lives in [../backlog/](../backlog/README.md); a
  plan starts here once its item is ready.

## When a plan completes

1. Fold what lasts into the documents it changes: the design document it extends
   ([../design-docs/](../design-docs/README.md)), an ADR for a decision that shapes a large
   part of the product ([../engineering-decisions/](../engineering-decisions/README.md),
   replacing the record it supersedes), ARCHITECTURE.md, PRODUCT.md, DESIGN.md, tests or
   tooling.
2. Summarise the outcome in [CHANGELOG.md](../../CHANGELOG.md).
3. Remove the plan and its backlog item, and anything of it in `ref/`. Git keeps the
   history.

A plan must make sense with `ref/` empty while it runs.

| Plan | Status |
| --- | --- |
| [active/adopt-purchased-billing-system.md](active/adopt-purchased-billing-system.md) | M1 toolchain and name done; next: M2 router sim on CHR |
