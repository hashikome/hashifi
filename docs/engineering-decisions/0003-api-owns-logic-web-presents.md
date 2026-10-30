# ADR-0003: The API owns business logic and workflows; the web presents

Status: accepted, 28 October 2026.

## Context

Hashikome's rule for every product is that the API owns the business logic and workflows
and the web owns the presentation. The earlier system mixes them both ways: the API
renders the whole captive portal as HTML, CSS and JavaScript from template strings, while
the admin pages compute totals and keep a copy of the duration rules.

## Decision

- **The API decides**: authorization and venue scoping, voucher and session lifecycle,
  statuses, durations, totals and every derived figure, and every portal workflow
  (resolving the router context, redeeming a voucher, deciding a reconnect). It returns the
  derived fields clients need.
- **The web presents**: the admin interface and the captive portal pages, formatting, local
  form state and presentation-only validation. It never decides access, computes
  authoritative figures or calls external services directly.
- **The captive portal moves to `apps/web`.** The API exposes portal endpoints; the web
  renders them.

## What must hold

- A hidden button is not a permission check; the API enforces every rule.
- The web never imports Prisma or API internals.
- The API never returns a credential (a voucher code) to a client that has not proved it
  holds it, and never acts on a URL from a request without validating it.
