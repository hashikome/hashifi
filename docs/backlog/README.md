# Backlog

Problems and ideas not yet ready to implement, and accepted technical debt. An item
records the problem, the outcome that would make the work worthwhile, its constraints and
dependencies, and the gate that promotes it into an ExecPlan.

A backlog item is not an execution plan. When the work is approved and shaped, create an
ExecPlan in `../exec-plans/active/` and link it from the item.

## Item lifecycle

```text
backlog item
  -> shaping and research with the owner
  -> an ExecPlan in ../exec-plans/active/ when it is ready to build
  -> built: its lasting content folded into ../design-docs/ (and an ADR where a decision
     shapes a large part of the product); the item and the plan removed
```

Status values: `candidate` (recorded, not yet looked at), `shaping` (being worked out with
the owner), `blocked`, `ready` (needs only its ExecPlan). The backlog holds only what is
truly planned.

## Current items

- [mobile-money-payments.md](mobile-money-payments.md) (ready, planned as M6): selling packages
  on the portal through Snippe, with a `customers` table: the default way in, in the first release.
- [technical-debt.md](technical-debt.md): accepted compromises and their follow-up.
