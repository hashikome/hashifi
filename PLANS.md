# Execution plans

An execution plan (ExecPlan) is a self-contained, living document for a substantial
feature, migration or cross-cutting change. A contributor with only the working tree and
the plan file must be able to continue the work.

Use an ExecPlan when work:

- spans several modules, or the API and the web;
- changes architecture, security, reliability or a data contract;
- needs research, a prototype or a staged migration;
- will continue across several sessions.

Small, local changes do not need one.

## Storage

Plans live in `docs/exec-plans/active/` under a short kebab-case name for the outcome.
Start from [docs/exec-plans/TEMPLATE.md](docs/exec-plans/TEMPLATE.md). When a plan
completes, its lasting content is folded into the design documents and ADRs, its outcome
into CHANGELOG.md, and the plan is removed
([docs/exec-plans/README.md](docs/exec-plans/README.md#when-a-plan-completes)).

HashiFi appears in the shared Hashikome workspace as one row that points here; the
workspace holds no copy of this product's plans. Where each kind of document goes:

- a problem or idea not yet ready to implement, and accepted technical debt:
  `docs/backlog/`; a plan starts once its item is ready, and the item links to the plan;
- designs and architecture: `docs/design-docs/`;
- long-term decisions that shouldn't change without re-evaluating the architecture (ADRs:
  what was decided, why, and what would have to be re-evaluated to change it):
  `docs/engineering-decisions/`;
- bulky, short-lived context while work is active: git-ignored `ref/`.

## Required properties

Every ExecPlan:

- is self-contained and defines non-obvious terms;
- states the outcome a user or operator will see;
- names files and modules by repository path;
- stays current as work proceeds;
- gives concrete verification commands and what they should show;
- records decisions, discoveries and deferred work;
- separates local implementation, verification, publication, deployment and live
  acceptance;
- can be resumed after a context reset, and still makes sense once `ref/` is deleted.

## Required sections

Purpose / Big Picture · Progress (timestamped checkboxes) · Surprises & Discoveries ·
Decision Log · Outcomes & Retrospective · Context And Orientation · Plan Of Work · Concrete
Steps · Validation And Acceptance · Idempotence And Recovery · Artifacts And Notes ·
Interfaces And Dependencies. The template shows each one.

## Verification

Use the repository's commands rather than restating them:

```bash
bun run verify
```
