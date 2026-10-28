# Reference context (`ref/`)

`ref/` is a disposable, local scratch area, ignored by git except for its README
([ref/README.md](../../ref/README.md)), the same in every Hashikome product.

- Never store secrets, credentials, personal data, production data or the only copy of a
  decision there.
- Promote durable findings into `docs/`, code comments, tests, tooling or the active
  ExecPlan, then delete the temporary material.
- Notes handed off between sibling projects land in the receiving repository's `ref/` and
  are promoted or deleted there.
- At the end of an ExecPlan, re-read each file, promote what lasts and delete the rest. An
  empty `ref/` is the healthy state.
