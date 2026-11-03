# ADR-0007: Sign-in with Better Auth, inside HashiFi

Status: accepted, 29 October 2026; roles moved to ADR-0011 on 3 November 2026. Replaces ADR-0005
(sign-in from a shared Hashikome identity service), now removed; that choice is listed below.

## Context

Only people with a membership sign in to HashiFi: Hashikome's platform staff and the people of each
business ([ADR-0011](0011-platform-and-business-scopes.md)). Guests never
have accounts; a voucher is their access. The earlier system signed staff in with an email
and a 6-digit code (hashed, 10 minutes, 5 attempts) and a hashed server-side session cookie:
sound, but about 300 lines of custom code with gaps (no rate limit on requesting a code, a
"not found" answer that reveals which emails are staff, no second factor). ntumie. and Pigfarm
already sign people in with Better Auth's email codes.

## Options considered

- **Port the earlier sign-in.** Custom security code to maintain, with its gaps to close.
- **A shared Hashikome identity service** (the replaced ADR-0005): one login across products.
  Its benefit is for people who use several products, which HashiFi's managers do not; its cost
  is a new service to build, secure, back up and run, in front of every product's sign-in, with
  single sign-on across separate domains (ntumie.link, hashikome.com). It would have blocked M4
  on work larger than HashiFi's own sign-in.
- **Better Auth in HashiFi**, as in ntumie. and Pigfarm.

## Decision

- **Better Auth runs in `apps/api`** with email one-time codes, never links, delivered through
  Resend. No self-registration: a person is invited from a Team page, and only invited people can
  sign in. No passwords.
- **An authenticator app (TOTP)**, with recovery codes: who must enroll one is set by role in
  ADR-0011.
- **Authentication and authorization stay separate tables.** Better Auth's `users`, `sessions`,
  `accounts` and `verifications` hold the identity, sessions and codes; memberships hold what
  HashiFi decides: role, scope and venues (ADR-0011), keyed by the user's id. HashiFi code reads
  authorization from memberships, never from Better Auth's tables, and does not use Better Auth's
  organization plugin.
- The earlier gaps are closed with Better Auth's own controls: rate limits on requesting and
  verifying codes, the same answer whether or not an email is staff, revocable sessions.
- Versions: the newest stable Better Auth, pinned (1.7.14 at this decision).

## What must hold

The separation is what keeps a shared identity service possible: if a concrete cross-product
need appears (one person using several products, or a company console), Better Auth's part
moves to the service and memberships stay. Revisit this record then, not before.
