# ADR-0001: Build from a purchased hotspot billing system

Status: accepted, 28 October 2026.

## Context

HashiFi needed working MikroTik hotspot provisioning, vouchers, a captive portal, sessions
and an admin interface. Discovering MikroTik's board and RouterOS differences from scratch
is slow and expensive, and the owner chose not to do that discovery work.

## Options considered

- Build from the empty Django skeleton: full control, but the router knowledge would have
  to be rediscovered.
- Buy a developed system for this market and adapt it.

## Decision

HashiFi is built from a purchased WiFi billing system (Express, Drizzle, MySQL backend and
Next.js admin), owned outright by Shikome Technology Limited and relicensed under
FSL-1.1-ALv2. It was imported as received in commit `45ebd53` and is ported to the
Hashikome stack ([ADR-0002](0002-toolchain.md)). Its multi-venue business model is kept.

The most valuable parts are kept and wrapped rather than rewritten: router provisioning
(bootstrap script, capability probing, the per-board dialect, readiness checks), router
sync, and the expiry and reconciliation jobs, with their tests as the regression guard.

## What must hold

- The seller's database dumps and uploads (third parties' personal data) never enter the
  repository.
- Vendor behaviour is not trusted for security: the port reviews the portal and every
  endpoint ([SECURITY.md](../SECURITY.md)).
