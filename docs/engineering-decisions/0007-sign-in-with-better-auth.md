# ADR-0007: Sign-in with Better Auth, inside HashiFi

Status: accepted, 29 October 2026. Replaces ADR-0005 (sign-in from a shared Hashikome identity
service), now removed; that choice is listed below.

## Context

Only staff sign in to HashiFi: admins and venue managers, a handful of people. Guests never
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
  Resend. No self-registration: an admin adds a person from the Team page, and only they can
  sign in. No passwords.
- **Admins must enroll an authenticator app (TOTP)**, with recovery codes, before reaching
  anything: an admin sees every venue and can reconfigure every router. Managers may enroll
  one; once enrolled it is required. Decided by the owner, 29 October 2026.
- **Authentication and authorization stay separate tables.** Better Auth's `users`, `sessions`,
  `accounts` and `verifications` hold the identity, sessions and codes; `staff` (renamed from
  the earlier `admin_users`) holds what HashiFi decides: role (admin or manager), status and
  venue scope, keyed by the same id. HashiFi code reads authorization from `staff`, never from
  Better Auth's tables. There are no organizations: staff belong to HashiFi itself.
- The earlier gaps are closed with Better Auth's own controls: rate limits on requesting and
  verifying codes, the same answer whether or not an email is staff, revocable sessions.
- Versions: the newest stable Better Auth, pinned (1.7.14 at this decision).

## What must hold

The separation is what keeps a shared identity service possible: if a concrete cross-product
need appears (one person using several products, or a company console), Better Auth's part
moves to the service and `staff` stays. Revisit this record then, not before.
