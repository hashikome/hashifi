# WiFi Billing System — Backend

Express + Drizzle + MySQL API for a prepaid WiFi hotspot business in Tanzania. It sells
time/data vouchers, takes mobile-money payments, and configures the MikroTik routers that
actually let customers online.

The admin UI is a separate repo (Next.js, expected on port 4000).

## Requirements

- **Node** — developed on v24; `@types/node` is on 26.x, so don't go below 22
- **pnpm** — `packageManager` pins 11.0.9 (11.17 works)
- **MySQL 8** reachable via `DATABASE_URL`
- A **MikroTik router** with the RouterOS API enabled, for anything hotspot-related

## Getting started

```bash
pnpm install
cp .env.example .env      # then fill it in — see below
pnpm db:migrate           # builds the whole schema on an empty database
pnpm dev                  # tsx watch, http://localhost:8080
```

`pnpm seed` creates a starting admin user if you need one.

## Environment

Everything lives in `.env`; `.env.example` lists each key. The ones worth explaining:

| Key | Notes |
| --- | --- |
| `DATABASE_URL` | `mysql://user:pass@host:3306/db`. The pool forces `time_zone = '+00:00'`, so every timestamp is true UTC on disk |
| `ENCRYPTION_KEY` | 32-byte hex. Encrypts router API passwords at rest — **changing it makes stored credentials unreadable** |
| `FRONTEND_ORIGIN` | CORS origin for the admin UI, `http://localhost:4000` in dev |
| `APP_URL` | This server's public base URL, used in emails |
| `BACKEND_LAN_URL` | *Optional.* Overrides how routers reach this server. Normally the address is discovered by finding the local interface on the router's subnet — set this only when that discovery can't work |
| `SNIPPE_*` | Payment gateway key and webhook secret |
| `MIKROTIK_API_PORT` / `MIKROTIK_CONNECT_TIMEOUT` | Default `8728` and `10` seconds |

The process pins `TZ=Africa/Dar_es_Salaam` itself (`src/db/index.ts`) so calendar maths lands on
the business's day, not the host's. Don't set `TZ` in `.env`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Watch mode on `src/server.ts` |
| `pnpm build` / `pnpm start` | `tsc -p tsconfig.build.json` to `dist/`, then run it |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | `bun test` — the `*.test.ts` files next to what they cover |
| `pnpm db:migrate` | **The only way to apply a migration** |
| `pnpm db:migrate:mark <tag>` | Record a migration as applied without running its SQL |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm seed` | Seed an admin user |
| `pnpm format` | Prettier |

### Tests

`pnpm test` runs [`bun test`](https://bun.sh/docs/cli/test) — no extra runner, no build step, and it
reads the TypeScript directly. Tests live beside the code as `*.test.ts` and cover the pure
functions where this project's expensive bugs have actually lived:

| File | What it pins |
| --- | --- |
| `router-provision/bootstrap.test.ts` | Generated script shape — **every statement ≤ 512 chars and self-contained**, quoting/escaping, input rejection |
| `router-provision/context.test.ts` | Hotspot interface resolution — the LAN-hijack guard, subnet overlap |
| `router-provision/dialect.test.ts` | Per-stack command differences, and that measured capabilities beat the version guess |
| `router-provision/probe.test.ts` | The one-way capability latch |

Two things to know before adding to them:

- **`tsconfig.json` needs `"bun"` in `types`** for the `bun:test` import. Node is still the runtime;
  nothing outside tests uses Bun.
- **`pnpm build` uses `tsconfig.build.json`**, which excludes `*.test.ts` — tests never reach
  `dist/`. Don't move `noEmit` between the two configs.

## Layout

```
src/
  server.ts              Express app, /api/auth/* endpoints, /ws/live, daemon startup
  routes/                one file per resource; also captive-portal + snippe-webhook
  services/
    mikrotik.ts          RouterOS API calls (hotspot users, live sessions)
    router-provision/    everything that configures a router — see below
    router-sync.ts       pushes vouchers to a venue's routers
    reconcile-daemon.ts  retries anything the router never confirmed
    expiry-daemon.ts     expires vouchers and sessions on schedule
  db/
    schema.ts            Drizzle schema — the source of truth
    migrate.ts           the migration runner
drizzle/                 migrations (see Migrations below)
mikrotik-files/          login.html + alogin.html served to routers
mikrotik-knowledge-files/
  ROUTER_ONBOARDING.md   how to put a router into service — start here
  MIKROTIK_HOTSPOT_SETUP.md  the reference: why each setting exists
```

Mounted paths:

- `/api/*` — twelve resource routers: `packages`, `vouchers`, `venues`, `routers`, `customers`,
  `sessions`, `analytics`, `payments`, `revenue`, `portal`, `team`, `audit`
- `/api/auth/*` — OTP login, `/me`, logout. **Defined inline in `server.ts`**, not in
  `routes/` — there is no `routes/auth.ts` to look for
- `/portal` — the captive portal customers see
- `/webhooks` — payment gateway callbacks
- `/uploads` — portal images written by the branding editor
- `/ws/live` — live session data and the provisioning command log

## Two things that will bite you

**Nothing reports success before the router confirms it.** Money arriving and a database row
saying `active` are not the same as a device getting online. Vouchers go
`unused → pending_activation → active`, and the promotion only happens after
`/ip/hotspot/user/print` reads the user back. Payments track `router_provisioned_at` separately
from `status = "paid"`. If you add a path that grants access, follow the same rule.

**Never assume what a MikroTik supports — probe, then branch.** RouterOS 7 on smips ships no
hotspot package at all; some boards reject `=rate-limit=` on a hotspot user regardless of
version. `src/services/router-provision/dialect.ts` is the only place those differences belong.

Both are spelled out in `../CLAUDE.md`, which is worth reading before changing anything in
`services/`.

## Migrations

`pnpm db:migrate` is the only supported route. Piping a `.sql` file into the `mysql` client
applies the DDL without recording it, which is how this project once ended up with three
migrations the migrator couldn't see.

History was squashed on 2026-08-11: `0012_baseline.sql` creates the whole schema, and
`0000`–`0011` live in `drizzle/archive/` as a record — never replayed. A fresh database needs
only `pnpm db:migrate`.

- Hand-write `drizzle/NNNN_name.sql`, separate statements with `--> statement-breakpoint`,
  then run `pnpm db:migrate`
- **Never edit an applied `.sql`** — edit forward with a new one
- **Never number below `0013`** — the archive reuses the low prefixes
- A database predating the squash needs `pnpm db:migrate:mark 0012_baseline` once

## Onboarding a router

`mikrotik-knowledge-files/ROUTER_ONBOARDING.md` is the procedure: reset → paste the generated
**Bootstrap script** → **Test connection** and save → **Set up router** → check a phone.

Don't follow the manual steps in `MIKROTIK_HOTSPOT_SETUP.md` on a new router. That document is
the reference for *why* each setting exists; applying it by hand produces untagged config the
provisioner can't manage.

## Related docs

- `../CLAUDE.md` — conventions that must be followed (timezones, phone numbers, provisioning)
- `../AGENT.md` — UI/UX conventions (mostly frontend, some shared formatting rules)
- `../ARCHITECTURE.md` — system overview and relation map
- `../TEST.md` — the test plan; **§0 lists what is still untested**
- `DB_SCHEMA.md` — table-by-table summary
