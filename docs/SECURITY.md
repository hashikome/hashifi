# Security

## Access and authorization

Admins and managers sign in with their email and a one-time code, through Better Auth
([ADR-0007](engineering-decisions/0007-sign-in-with-better-auth.md)); admins must also use an
authenticator app, and once anyone has one it is asked for at every sign-in (no trusted
devices). There is no sign-up: `bun run staff:add` and the Team page add people. A code goes
only to active staff and every caller gets the same answer; codes are stored under an HMAC,
allow five attempts and last ten minutes; requests are limited per client address (resolved
through `TRUSTED_PROXIES`) and to five codes per person per fifteen minutes. Every route
requires an active staff session unless it is declared public, and status is checked on each
request, so a suspension takes effect at once. Only the Better Auth routes HashiFi uses are
reachable. The API enforces every
permission: admins manage everything; managers act only on their own venues, and every query
a manager can reach is scoped to those venues. Hiding a control in the web is never the
check.

## Captive portal

The portal is public and reachable before guests authenticate, so it is the most exposed
surface:

- Voucher codes are eight characters from a cryptographic generator (about 39.6 bits), never
  `Math.random`, and never travel in a URL query: printing is by batch or voucher id, QR codes
  and the router's redirects use fragments, which reach no server or log.
- A voucher code is the hotspot username and password. It goes from the portal to the API and
  from the API to the router, never over the WiFi in clear, and no API response carries it
  ([ADR-0008](engineering-decisions/0008-captive-portal.md)).
- Only the API signs a device in. The router accepts no login over the network, so nothing can
  guess at it, and setup fails if an http login method is enabled.
- Everything the router passes to the portal is untrusted, since it travels through the guest's
  browser. The router must be registered, `mac` and `ip` must match strict formats and the router
  itself must see that device. A MAC address decides nothing it would matter to forge.
- Failed codes are limited per client address and per device, and only a good code reaches a
  router, so the public route cannot be used to drive router connections.

### Public endpoints

Reviewed 30 October 2026. Everything else requires a staff session.

| Endpoint | Why public | What protects it |
| --- | --- | --- |
| `GET /api/health`, `/api/health/ready` | The platform's checks | Says nothing but up or down |
| `/api/auth/*` (the routes HashiFi uses) | Signing in | ADR-0007: rate limits, one answer, the rest refused |
| `POST /api/guest/context` | The portal page | Registered router; read-only wording and prices |
| `POST /api/guest/redeem` | Taking a voucher into use | Attempt limits, a lock on the voucher, its venue, blocked devices, the router seeing the device |
| `POST /api/guest/session` | The router's status pages | Time and data only, never a code; any origin, no cookies |
| `GET /portal/hotspot-files/:routerId/:name` | Routers pull them while provisioned | Named files only; the portal's address and router id, no secret |
| `/ws/live` | Not public: listed because guards do not cover it | Its upgrade signs in as a route would, and checks the origin |

What remains open is in ADR-0008.

## Boundary validation

Every request body, query and external callback is validated at the API boundary before it
reaches domain logic. Webhooks are verified by signature. Router credentials and tunnel keys are stored sealed and never returned; the bootstrap script
is the one response carrying a router's API password, uncached. Testing a connection never
reuses a stored password: a saved router is probed at its stored address only. The live socket (`/ws/live`) signs its upgrade in like any route and refuses other origins;
managers receive only their venues' updates. A write carrying a session cookie
is refused unless it comes from the web's own origin, since a cross-site form post needs no
CORS preflight. Errors say what went wrong for the caller, never why internally: an
unexpected failure is a plain 500, reported to Sentry.

## Personal data

HashiFi holds staff emails; for guest devices, the MAC address, device name and type, and
sessions; and from M6, a paying customer's mobile number and payments. Managers see devices and customers only at their venues. External telemetry
never carries personal data unredacted. Development and tests use invented data; real
customers' data, including that delivered with the purchased system, never enters the
repository, `ref/` or logs.

## Credentials

Secrets never enter the repository, `ref/` or logs. They reach the application in one of
two ways, and the application works with either and depends on no password manager:

- **Docker secrets** for values that should not sit even in an env file (database URLs,
  signing and encryption keys, provider keys): mounted by the stack at `/run/secrets/<name>`
  and passed as `<NAME>_FILE`. A set `<NAME>_FILE` wins; if it cannot be read, the API fails
  at startup.
- **Environment variables** from a private env file for everything else, and for local
  development (each app's `.env.example` lists its keys).

A password manager such as 1Password is an optional adapter around the process
(`op run --env-file=... -- <command>` filling the same variables or secret files); no script
or application code calls it. The running application never receives migrator or
administrator database credentials; migrations get their own `DATABASE_URL_FILE`.

Router API passwords and tunnel private keys are encrypted at rest with AES-256-GCM
(`SecretBox`) under `ENCRYPTION_KEY`, which the API requires at start; a tampered value fails
to decrypt. They are never returned to clients.

## Telemetry

Logs and Sentry receive only allowlisted wide-event fields, and every string is redacted of
voucher codes, credentials, connection-string passwords, emails, MAC addresses and phone
numbers (`src/observability/redact.ts`). Sentry collects no request data: every
`dataCollection` category is off, because Sentry 11 collects them by default.
