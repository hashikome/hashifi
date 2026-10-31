# Documentation

The map of repository knowledge. Start with [AGENTS.md](../AGENTS.md), then
[PRODUCT.md](../PRODUCT.md) (requirements), [ARCHITECTURE.md](../ARCHITECTURE.md) (system
authority) and, for interface work, [DESIGN.md](../DESIGN.md) (visual system and tokens).
The user and developer guide is [README.md](../README.md).

Once HashiFi has a chapter in the [Hashikome handbook](https://handbook.hashikome.com),
it is the reading path for newcomers. This repository stays the authority: the handbook
explains and links here.

## Documentation spaces

| Space | Use it for |
| --- | --- |
| [backlog/](backlog/README.md) | What is truly planned but not yet ready to implement, ideas, and accepted technical debt |
| [design-docs/](design-docs/README.md) | Detailed extensions of ARCHITECTURE.md: how each part of the system works |
| [runbooks/deploy.md](runbooks/deploy.md) | How a release reaches production |
| [engineering-decisions/](engineering-decisions/README.md) | Long-term decisions (ADRs): what was decided, why, and what would have to be re-evaluated to change it |
| [exec-plans/](exec-plans/README.md) | Temporary implementation plans for work being built (format: [PLANS.md](../PLANS.md)); removed once folded into the docs |
| [runbooks/](runbooks/README.md) | Repeatable procedures: local development, verification, release, operations |

## Top-level policies

- [CORE_BELIEFS.md](CORE_BELIEFS.md): engineering principles.
- [SECURITY.md](SECURITY.md): access, personal data and credentials.
- [RELIABILITY.md](RELIABILITY.md): data integrity, jobs and releases.

## Reading status and history

Current documents describe behaviour as it is and label what is planned. Resolve a
contradiction against the code and the latest accepted decision, and update every
affected document together. Dates and before/after accounts belong in
[CHANGELOG.md](../CHANGELOG.md) and git history; completed plans are not kept.
