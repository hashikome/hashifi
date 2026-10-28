# ADR-0005: Sign-in comes from the shared Hashikome identity service

Status: accepted, 28 October 2026.

## Context

ntumie. and Pigfarm each implement passwordless email-code sign-in on Better Auth. The
purchased system has a third implementation (one-time codes by SMTP, server-side sessions).
Hashikome's accepted direction is a shared identity service that owns credentials, the
person's identity, sessions, MFA and recovery, while each product keeps its own
authorization (ntumie.'s `docs/design-docs/identity-sso.md`).

## Options considered

- Port the purchased sign-in to NestJS: a third copy of the same logic.
- Adopt Better Auth in HashiFi as the siblings did: still a third copy.
- Consume the shared identity service, built once from what ntumie. and Pigfarm already do.

## Decision

HashiFi does not implement authentication. Admins and managers sign in through the shared
identity service; HashiFi owns what is specific to it: roles (admin, manager), venue scoping,
the team, and the audit trail. Guests do not have accounts: a voucher is their access.

The service is planned and built as cross-product work in the Hashikome workspace, not in
this repository. HashiFi's port leaves sign-in to it; until it is available, any interim
sign-in is recorded as debt with its removal condition.
