# Security

## Access and authorization

Admins and managers sign in with their email and a one-time code. The API enforces every
permission: admins manage everything; managers act only on their own venues, and every query
a manager can reach is scoped to those venues. Hiding a control in the web is never the
check.

## Captive portal

The portal is public and reachable before guests authenticate, so it is the most exposed
surface:

- A voucher code is the hotspot username and password. The API returns it only to a client
  that has just supplied it; reconnection never reveals it.
- Values the router passes to the portal (`mac`, `ip`, `link-login`, `link-orig`, CHAP
  values) are untrusted. `link-login` is accepted only as an `http(s)` URL whose host is a
  registered router or hotspot gateway; `mac` and `ip` must match strict formats.
- Values embedded in scripts are JSON-encoded, never HTML-escaped.

## Boundary validation

Every request body, query and external callback is validated at the API boundary before it
reaches domain logic. Webhooks are verified by signature.

## Personal data

HashiFi holds admins' emails, and for guests an optional phone number, device MAC and
details, and session records. Managers see guests only at their venues. External telemetry
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
