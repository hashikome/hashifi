# @hashifi/api

The HashiFi API: venues, routers, packages, vouchers, sessions, analytics and the captive
portal, plus the MikroTik provisioning that makes them real on a router.

NestJS on Bun with Prisma and PostgreSQL 18; the
[adoption plan](../../docs/exec-plans/active/adopt-purchased-billing-system.md) tracks the port.

## Commands

From the repository root (`bun run verify` runs everything CI runs), or here:

| Command | What it does |
| --- | --- |
| `bun run dev` | Watch mode on `src/entrypoint.ts` (port 8080) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | The `*.test.ts` files beside the code |
| `bun run test:integration` | Over HTTP against PostgreSQL (`test/integration/`) |
| `bun run db:migrate` | Creates and applies a migration |
| `bun run db:seed` | Seeds invented staff, a venue and packages |
| `bun run staff:add` | Adds a person who can sign in; the first admin is made this way |

Copy `.env.example` to `.env` and set `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`.
`ENCRYPTION_KEY` seals router credentials at rest: changing it makes them unreadable.

## Layout

```
src/
  entrypoint.ts, main.ts   telemetry, then the Nest application and its middleware
  auth/                    Better Auth, the staff guard, venue scope
  venues/ routers/ packages/ vouchers/ sessions/ devices/
  analytics/ portal/ team/ audit/
  live/                    the /ws/live hub
  http/                    error shape, wide events, origin check, validation
  services/
    mikrotik.ts            RouterOS API calls (hotspot users, live sessions)
    router-provision/      everything that configures a router
    router-sync.ts         pushes vouchers to a venue's routers
    live-monitor.ts        polls routers for live clients and applies throttling
mikrotik-files/            login.html, alogin.html and status.html uploaded to routers
```

Router procedures are in [docs/runbooks](../../docs/runbooks/README.md).

The tests pin the code where expensive bugs have lived: the generated bootstrap script (every
statement at most 512 characters and self-contained), hotspot interface resolution, per-board
command differences and the capability latch. Read the repository's
[AGENTS.md](../../AGENTS.md) before changing `services/`.
