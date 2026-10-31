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
| `POST /api/guest/payments` | Buying on the portal | Every check before a prompt; limits per number, device and address |
| `POST /api/guest/payments/status` | The paying session's receipt | Needs the session's secret; without it a payment does not exist |
| `POST /webhooks/snippe`, `/webhooks/briq` | Provider reports | Signature over the exact bytes; each event once; bodies never logged |
| `GET /api/guest/brand/:venueId/:file` | A venue's logo before login | Only names the API makes; re-encoded images, `nosniff`, no listing |
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
customers' data never enters the
repository, `ref/` or logs.

## Credentials

Secrets never enter the repository, `ref/` or logs. The application gets its configuration in
two ways and needs nothing else to start:

- **Docker secrets** for values that should not sit even in an env file (database URLs,
  signing and encryption keys, provider keys, error-reporting DSNs): external to the stack,
  mounted at `/run/secrets/<name>` and passed as `<NAME>_FILE`. A set `<NAME>_FILE` wins; if it
  cannot be read or is empty, the API fails at startup, not at first use. The stack receives each
  secret's versioned name (`<NAME>_SECRET=hashifi_<name>_YYYYMMDD_vN`), never its value.
- **Environment variables** from an env file for everything else, including local development.

There is one template, `.env.example` at the repository root, listing each key; the web, its own
app, keeps `apps/web/.env.example`. It is never named for an environment, as env files are used
wherever the code runs: copy it, fill in the values that fit that environment, and keep the copy
out of the repository.

Each product stands alone: a credential shared between products still reaches this one as its own
Docker secret, and the application never reads another product's configuration. Where an operator
keeps these values is their own concern, so no document, script or application code names a
password manager or a path on someone's machine. Whatever holds them, the service ends up with an
env file whose values fit its environment. The running application never receives migrator
or administrator database credentials; migrations get their own `DATABASE_URL_FILE`.

To move a value to a Docker secret, first release an image that reads `<NAME>_FILE`, then change the
stack. The other way round, the image ignores the file and the feature stops without an error.

Router API passwords and tunnel private keys are encrypted at rest with AES-256-GCM
(`SecretBox`) under `ENCRYPTION_KEY`, which the API requires at start; a tampered value fails
to decrypt. They are never returned to clients.

## Telemetry

Logs and Sentry receive only allowlisted wide-event fields, and every string is redacted of
voucher codes, credentials, connection-string passwords, emails, MAC addresses and phone
numbers (`src/observability/redact.ts`). Sentry collects no request data: every
`dataCollection` category is off, because Sentry 11 collects them by default.
