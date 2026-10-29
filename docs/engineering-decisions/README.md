# Engineering decisions

Settled decisions and their rationale (architecture decision records). They are binding:
do not reverse one without a new record that states the new evidence, the trade-off and
the reason.

A record holds the decision, why it was made and what must hold. How a feature works
belongs in a [design document](../design-docs/README.md); the work belongs in an
[ExecPlan](../exec-plans/README.md).

Statuses: `accepted` or `rejected`. Only the current decision is kept: when a decision
changes, the latest record states what holds now and lists the replaced choice under its
options considered, and the old record is removed (git keeps its history). A record may be
widened in place when the decision grows without changing direction; its status line says
when. Number records sequentially as `NNNN-short-slug.md`; numbers are never reused, so
links stay valid.

| Record | Decision | Status |
| --- | --- | --- |
| [0001](0001-adopt-purchased-billing-system.md) | Build from a purchased hotspot billing system | accepted |
| [0002](0002-toolchain.md) | Bun workspaces, NestJS, Prisma and PostgreSQL | accepted |
| [0003](0003-api-owns-logic-web-presents.md) | The API owns business logic and workflows; the web presents | accepted |
| [0004](0004-types-without-any-or-undefined.md) | Types without `any` or `undefined` | accepted |
| [0006](0006-router-management-tunnel.md) | Routers are managed through a tunnel they open to the platform | accepted |
| [0007](0007-sign-in-with-better-auth.md) | Sign-in with Better Auth, inside HashiFi (replaces 0005) | accepted |
