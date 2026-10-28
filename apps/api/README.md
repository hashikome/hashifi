# @hashifi/api

The HashiFi API: venues, routers, packages, vouchers, sessions, analytics and the captive
portal, plus the MikroTik provisioning that makes them real on a router.

> **Status:** this is the purchased Express, Drizzle and MySQL backend, being ported to NestJS
> on Bun with Prisma and PostgreSQL by the
> [adoption plan](../../docs/exec-plans/active/adopt-purchased-billing-system.md). Until M3,
> running it locally needs MySQL 8 (`DATABASE_URL` in `.env`).

## Commands

From the repository root (`bun run verify` runs everything CI runs), or here:

| Command | What it does |
| --- | --- |
| `bun run dev` | Watch mode on `src/server.ts` (port 8080) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | `bun test`: the `*.test.ts` files beside the code |
| `bun run db:migrate` | The only way to apply a migration |
| `bun run seed` | Seed invented admin users |

Copy `.env.example` to `.env` and fill it in. `ENCRYPTION_KEY` is required: it encrypts router
API passwords at rest, and changing it makes stored credentials unreadable.

## Layout

```
src/
  server.ts              Express app, auth endpoints, /ws/live, background jobs
  routes/                one file per resource; also captive-portal
  services/
    mikrotik.ts          RouterOS API calls (hotspot users, live sessions)
    router-provision/    everything that configures a router
    router-sync.ts       pushes vouchers to a venue's routers
    reconcile-daemon.ts  retries anything the router never confirmed
    expiry-daemon.ts     expires vouchers and sessions on schedule
  db/                    Drizzle schema and migration runner (replaced by Prisma in M3)
mikrotik-files/          login.html, alogin.html and status.html uploaded to routers
mikrotik-knowledge-files/ router onboarding procedure and the hotspot reference
```

The tests pin the code where expensive bugs have lived: the generated bootstrap script (every
statement at most 512 characters and self-contained), hotspot interface resolution, per-board
command differences and the capability latch. Read the repository's
[AGENTS.md](../../AGENTS.md) before changing `services/`.
