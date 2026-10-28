# WiFi Billing System — Admin UI

Next.js admin dashboard for a prepaid WiFi hotspot business in Tanzania: packages and vouchers,
venues and routers, live sessions, payments and revenue, and the captive-portal branding editor.

All data comes from the Express API in the separate backend repo — there is no mock data and no
local database.

## Requirements

- **Node** — developed on v24 (Next 16 + React 19) — and **pnpm**
- The **backend running on `http://localhost:8080`** (most pages are empty without it)

## Getting started

```bash
pnpm install
cp .env.example .env.local
pnpm dev                  # http://localhost:4000
```

Port 4000 is deliberate — the backend's default `FRONTEND_ORIGIN` expects it for CORS.

## Environment

```
NEXT_PUBLIC_API_URL=http://localhost:8080     # the Express API
NEXT_PUBLIC_PORTAL_URL=http://localhost:4000  # captive portal base, used in voucher QR codes
```

Never hardcode either — always
`process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server on port 4000 |
| `pnpm build` / `pnpm start` | Production build and serve |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |

### ⚠️ `next build` does not typecheck

`next.config.mjs` sets `typescript.ignoreBuildErrors: true`, so a build prints
"Compiled successfully" even when types are broken. Run it separately:

```bash
pnpm exec tsc --noEmit
```

One pre-existing error is expected and unrelated: a Recharts overload in
`components/chart-area-interactive.tsx`. Also note `tsc` reads `.next/types/`, so it can report
stale errors about deleted routes until the next build regenerates them.

TypeScript is pinned to **6.0.3** — Next 16 can't load the TS 7 native-port API.

## Layout

```
app/
  admin/                 the dashboard — venues, routers, packages, vouchers,
                         payments, revenue, analytics, sessions, users, team,
                         portal, settings
  dashboard/             the manager-facing view
components/
  ui/                    Shadcn primitives — check here before building anything
  router-*.tsx           router onboarding: bootstrap script, connection test,
                         provision dialog, readiness checklist
  error-state.tsx        ErrorState + EmptyState
  table-action-buttons   TableEditButton / TableDeleteButton / TableNavButton
  confirm-modal.tsx      the only way to confirm a destructive action
lib/
  types.ts               must mirror the API's responses
  utils.ts               formatDate and friends
  auth-context.tsx       session + role (admin | manager)
```

## Conventions

`../AGENT.md` is the authority and is worth reading in full before touching UI. The rules that
come up most:

- **Money never has decimals**: `TSH {Math.floor(amount).toLocaleString()}`. Data usage keeps one:
  `{n.toFixed(1)} GB`
- **Dates only through `formatDate`** from `lib/utils.ts` — never `toLocaleDateString()`, never a
  manual `timeZone` option
- **Every button that hits the network or navigates shows a loader and disables.** If the success
  path navigates away, leave it loading — only reset on error, or it flashes enabled before the
  route changes
- **Admin forms use `useUnsavedChanges`** plus `<UnsavedChangesDialog />`
- **A failed load is not an empty state.** Record it and render `<ErrorState onRetry=… />` *before*
  the "nothing here yet" branch — otherwise the UI claims there is no data when the request simply
  failed
- **`ConfirmModal` for destructive actions** — never `window.confirm()`
- **Mobile money copy never names a provider** (no M-Pesa / Tigo Pesa / Airtel Money) — use
  "mobile number" and "mobile money"
- **Never pre-fill a credential field**, and never use example passwords

## Related docs

- `../AGENT.md` — UI/UX conventions (read this first)
- `../CLAUDE.md` — cross-cutting rules: timezones, Tanzanian phone formats, provisioning
- `../ARCHITECTURE.md` — system overview
- `../TEST.md` — test plan
