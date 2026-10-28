# @hashifi/web

The HashiFi admin interface: venues and routers, packages and vouchers, live sessions,
payments, revenue and analytics, the team, and the captive-portal branding editor. All data
comes from `@hashifi/api`; the API's JSON contract is `@hashifi/types`.

## Commands

From the repository root (`bun run verify` runs everything CI runs), or here:

| Command | What it does |
| --- | --- |
| `bun run dev` | Development server on port 4000 |
| `bun run build` | Production build, including the type check |
| `bun run typecheck` | `tsc --noEmit` |

Copy `.env.example` to `.env.local`. Port 4000 matches the API's default `FRONTEND_ORIGIN`
for CORS.

## Conventions

- **The API decides; the web presents** ([ADR-0003](../../docs/engineering-decisions/0003-api-owns-logic-web-presents.md)).
  Response shapes come from `@hashifi/types`, never hand-written copies.
- **Money never has decimals:** `TSH {Math.floor(amount).toLocaleString()}`. Data usage keeps
  one: `{n.toFixed(1)} GB`.
- **Dates only through `formatDate`** in `lib/utils.ts`.
- **Every button that hits the network or navigates shows a loader and disables.**
- **A failed load is not an empty state:** render `<ErrorState onRetry=… />` before the
  "nothing here yet" branch.
- **`ConfirmModal` for destructive actions**, never `window.confirm()`.
- **Mobile money copy never names a provider.**
- **Never pre-fill a credential field.**
- `components/ui/` holds the shadcn primitives; check there before building one.
