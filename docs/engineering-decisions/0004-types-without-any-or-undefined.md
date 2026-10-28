# ADR-0004: Types without `any` or `undefined`

Status: accepted, 28 October 2026.

## Context

The purchased code used `any` for API data, caught errors and connections, and optional
(`undefined`) fields for values that are simply absent. Typing it during the toolchain
milestone exposed what that hid: web types that no longer matched the API, a print page that
crashed without portal settings, a preview whose props were declared as strings and received
numbers, and a rewrite that silently dropped `ok` from a provisioning report because it became
`undefined`.

## Decision

- **No `any`**, explicit or implicit. Values of unknown shape are `unknown` and narrowed.
- **Absence is `null`**, in API contracts (`@hashifi/types`), domain types and props. A field
  that can be absent is `T | null` and always present; it is not optional and not `undefined`.
- **No non-null assertions (`!`)**: they assert away an `undefined` the checker found. Guard,
  narrow into a `const`, or use a helper that fails with a clear message.
- Biome enforces `noExplicitAny`, `noImplicitAnyLet` and `noNonNullAssertion` as errors. A
  suppression states its reason in the comment.
- The web consumes the API's JSON through `@hashifi/types`; it does not hand-write copies of
  response shapes.

## What must hold

`undefined` still appears where a platform or library API returns it (`Map.get`, an array
search, a RouterOS row's missing field); it is handled at that boundary and does not travel
further. The only temporary exception is the Biome override for code M3 and M4 replace,
recorded in [technical debt](../backlog/technical-debt.md).
