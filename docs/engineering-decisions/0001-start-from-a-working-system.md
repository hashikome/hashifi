# ADR-0001: Start from a working hotspot system

Status: accepted, 28 October 2026.

## Context

HashiFi needed working MikroTik hotspot provisioning, vouchers, a captive portal, sessions
and an admin interface. Discovering MikroTik's board and RouterOS differences from scratch
is slow and expensive.

## Decision

HashiFi starts from a working WiFi billing system (commit `45ebd53`: Express, Drizzle, MySQL
backend and Next.js admin), owned outright by Shikome Technology Limited and licensed under
FSL-1.1-ALv2, and moves it onto the Hashikome stack ([ADR-0002](0002-toolchain.md)). Its
multi-venue model is kept.

The most valuable parts are kept rather than rewritten: router provisioning (bootstrap
script, capability probing, the per-board dialect, readiness checks), router sync, and the
expiry and reconciliation jobs, with their tests as the regression guard. Everything else is
replaced whenever there is a better way.

## What must hold

- Real people's data never enters the repository.
- Inherited behaviour is not trusted for security: the portal and every endpoint are reviewed
  ([SECURITY.md](../SECURITY.md)).
