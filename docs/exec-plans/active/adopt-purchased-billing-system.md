# Adopt the purchased billing system as HashiFi

This ExecPlan is a living document. Maintain it according to `PLANS.md`. Keep `Progress`,
`Surprises & Discoveries`, `Decision Log` and `Outcomes & Retrospective` current as work
proceeds.

## Purpose / Big Picture

Turn the purchased WiFi billing system into HashiFi on the Hashikome stack, deployed through
the shared platform. When done, an admin onboards a reset MikroTik through the generated
bootstrap script and automated setup, generates vouchers for a package, and a phone on that
router's WiFi reaches the HashiFi portal, redeems a voucher and browses until the voucher
expires. The API runs as NestJS on Bun with Prisma and the shared PostgreSQL 18, the portal
and admin are presented by `apps/web`, and releases go GitHub CI → GHCR → Dokploy.

## Progress

- [x] (2026-10-28) Purchased archives inspected; checksums recorded; third parties' data
  found in `database-backups/` and `uploads/` and excluded.
- [x] (2026-10-28) Baseline as received: backend typecheck clean and 170/170 tests pass on
  Bun 1.4.4 (with a placeholder `DATABASE_URL`); frontend typecheck has one known error
  (`components/chart-area-interactive.tsx`, a Recharts overload).
- [x] (2026-10-28) NestJS 12.3.2 smoke-tested on Bun 1.4.4: dependency injection, decorators
  and routing work.
- [x] (2026-10-28) Imported as received (`45ebd53`); repository scaffolded from the
  Hashikome template; FSL-1.1-ALv2; packages renamed `@hashifi/api` and `@hashifi/web`; pnpm
  and npm files removed.
- [x] (2026-10-28) M1 Toolchain and name. One root `bun.lock` (Bun 1.4.4 isolated installs);
  every dependency on its newest stable release, pinned; Biome replaces Prettier and ESLint;
  `@hashifi/types` carries the API's JSON contract; unused code removed (the v0 starter
  dashboard and its components, 36 unused UI and hook files, 30 unused dependencies, Vercel
  Analytics, `next-maps`, `dotenv`, `tsx`); TypeScript 7 in both apps with type errors failing
  the build; no `any` or `!` in kept code; HashiFi naming throughout; `ENCRYPTION_KEY` required.
  `bun run verify` passes: 170/170 tests, both typechecks, lint, format, web build.
- [ ] M2 Router lab on CHR.
  - [x] (2026-10-29) Lab: `bun run lab` boots RouterOS 7.25 CHR in QEMU and runs onboarding
    through the real code (serial-console bootstrap, `setupRouter`, `probeVerify`). A
    factory-fresh router onboards in one pass (14 changes applied and verified); a second run
    applies 0; verify passes with the two expected warnings. Two provisioning defects fixed.
    Provisioning reaches persistence only through `RouterStore`, and credentials carry their
    own port (the management target). Runbook: `docs/runbooks/router-lab.md`.
  - [x] (2026-10-29) Management tunnel proved in the lab and recorded as
    [ADR-0006](../../engineering-decisions/0006-router-management-tunnel.md): the bootstrap
    brings up a router-initiated WireGuard tunnel and restricts the API to the platform's
    tunnel address; setup and verify pass over the tunnel alone; the router re-establishes it
    after a hub restart; switching the portal between an address and a host name re-provisions
    cleanly. The production endpoint is shared-platform work (ADR-0006, What remains open).
  - [x] (2026-10-29) Management and portal endpoints split (`resolveBackendEndpoints`):
    `ROUTER_MANAGEMENT_URL` (replacing `BACKEND_LAN_URL`) is where routers reach the API;
    `PORTAL_ORIGIN` is where guests' browsers load the portal. A host-name portal goes in the
    walled garden as `dst-host`, and the address-only forward rule then does not apply. Both
    modes onboard a fresh CHR and verify clean; with `https://handbook.hashikome.com` RouterOS
    resolved both Cloudflare addresses into pass-through rules.
  - [ ] A guest client on the hotspot segment: DHCP, portal redirect, voucher login.
  - [ ] `sharp` under Bun (`routeros` is proved by the lab; it hangs on a closed connection,
    which `connectToRouter`'s timeout covers).
- [ ] M3 Prisma schema on PostgreSQL.
- [ ] M4 NestJS API.
- [ ] M5 Captive portal in the web, and the security pass.
- [ ] M6 Release pipeline and deployment.
- [ ] M7 Live acceptance on a physical router.

## Surprises & Discoveries

- Observation: the backend assumes it shares a LAN with the routers. It connects to the
  plaintext RouterOS API on port 8728 at the router's address and finds its own address by
  matching the router's subnet (`resolveBackendUrl`, `BACKEND_LAN_URL`).
  Evidence: `apps/api/src/services/router-provision/context.ts`, `mikrotik.ts`.
- Observation: the walled garden admits the backend by IP address
  (`/ip/hotspot/walled-garden/ip dst-address=<backend IP>`), which breaks behind Cloudflare,
  whose addresses change.
  Evidence: `apps/api/src/services/router-provision/steps.ts` (`walledGarden`),
  `verify.ts` (`walledGardenCheck`).
- Observation: security defects in the code as received (fixed in M4 and M5, each with a
  regression test):
  1. The portal's auto-reconnect returns a voucher code (the hotspot username and password)
     to anyone supplying an active device's MAC in the query string, inside a form that
     posts itself to an unvalidated `link-login` URL; a `javascript:` URL there runs script.
     Evidence: `apps/api/src/routes/captive-portal.ts:120`, `renderAutoReconnect`.
  2. Query values are placed in inline scripts with HTML escaping only (`esc`), which does
     not escape backslashes or newlines. Not exploitable as found, but the wrong encoding.
     Evidence: `captive-portal.ts:1149`.
  3. `GET /api/routers/provisioning-backlog` requires sign-in but no role or venue scope,
     so a manager sees every venue's routers. Other read routes may share this.
     Evidence: `apps/api/src/routes/routers.ts:130`.
  4. Router passwords are encrypted with AES-256-CBC (unauthenticated) and a published
     fallback key when `ENCRYPTION_KEY` is unset.
     Evidence: `apps/api/src/utils/encrypt.ts:3`.
- Observation: typing the web exposed defects that `any` hid: `lib/types.ts` no longer matches
  the API (stale voucher statuses and removed portal fields); the voucher print page crashed
  when portal settings were missing (now falls back to the defaults); the voucher preview's
  props were declared as strings but received numbers and `undefined`; managers whose role
  loaded after mount never got their single venue preselected on voucher creation (now
  re-runs when the role arrives). An automatic lint fix would have turned a provisioning
  report's `ok: false` into an absent field (caught by the typecheck and fixed).
  Evidence: M1 commit; [ADR-0004](../../engineering-decisions/0004-types-without-any-or-undefined.md).
- Observation: the package create and edit pages enforce business rules (minimum price 1,000
  TSH; throttled speeds below the package speed) in the web.
  Evidence: `apps/web/app/admin/packages/create/page.tsx`, `[id]/edit/page.tsx`.
- Observation: Biome's "safe" fixes rewrote the router portal pages' inline scripts (ES5
  `function` to arrow functions). The router only stores and serves these pages; the guest's
  browser runs them, and every browser since about 2016 runs arrow functions, so only very old
  Android WebViews (4.4 and earlier) would fail. The seller wrote them as ES5 on purpose, so
  they are restored as received apart from the brand name and excluded from Biome; M5 decides
  the oldest supported browser when the portal moves to the web.
  Evidence: `git diff 45ebd53 -- apps/api/mikrotik-files`.
- Observation: a browser smoke test of the built web against a stub API (signed-in manager,
  one venue, no portal settings) rendered printing, voucher creation, the venue map, packages,
  routers and the dashboard without script errors, and each page fetched once (routers also
  polls every 10 s, as designed). Not yet exercised against the real API.
- Observation: on CHR 7.25 a no-defaults reset keeps a DHCP client on ether1. The bootstrap's
  guards matched its lease as "the LAN address and default route already exist", so the static
  ones were never added, and the lease dies once ether1 is bridged. The bootstrap now removes a
  DHCP client from bridged interfaces and counts only static entries.
  Evidence: router lab, 2026-10-29; `bootstrap.test.ts`.
- Observation: on CHR 7.25 a running hotspot keeps its dynamic firewall rules first whatever
  static rules do, re-inserting them above its disabled "place hotspot rules here" rule each time
  it starts; on a fresh board they also appear a moment after the server is created. Placing our
  accepts first therefore failed the read-back, and moving them above the dynamic rules is
  ignored. The firewall steps now wait for the hotspot's rules and place ours above the
  placeholder. The hAP lite (the seller's measurement) let a static rule sit above the dynamic
  ones; both cases are accepted.
  Evidence: router lab, 2026-10-29; `steps.test.ts`.
- Observation: the purchased code used one backend address for two roles: management (API
  connections, the router's input accept rule, readiness ping, portal-file download) and the
  guest-facing portal (login redirect, walled garden, forward accept). The IP binding
  (`ip-binding-backend`) bypasses the hotspot for the management address, which only matters if
  the API sits on the guest network; it is kept for now and reviewed with the tunnel.
- Observation: a walled-garden `dst-host` entry is accepted but flagged invalid while its name
  does not resolve; resolved, RouterOS keeps one pass-through rule pair per address.
- Observation: CHR 7.25 rejects `rate-limit` on a hotspot user; the self-test measures it and
  vouchers fall back to per-package profiles, as designed.
- Observation: Bun 1.4 workspaces install in isolated mode (`node_modules/.bun/`, symlinked per
  app); the purchased `turbopack.root` pin stopped Next.js resolving itself and was removed.
  Next.js finds the root `bun.lock`.
- Observation: the root Django `.gitignore` hid `apps/web/lib/` from the first import commit;
  the commit was amended before publication to include it.
  Evidence: `git check-ignore` against the old `.gitignore` (`lib/`).
- Observation: the vendor READMEs refer to `../CLAUDE.md`, `../AGENT.md`,
  `../ARCHITECTURE.md` and `../TEST.md`, which were not delivered. Their rules that matter
  are restated in AGENTS.md (time zone, phone formats, copy, provisioning).

## Decision Log

- Decision: build from the purchased system; keep its multi-venue model.
  Rationale: [ADR-0001](../../engineering-decisions/0001-adopt-purchased-billing-system.md).
  Date/Author: 2026-10-28 / Paul, Claude
- Decision: Bun, NestJS, Prisma, PostgreSQL 18, Next.js, Biome; newest stable versions pinned.
  Rationale: [ADR-0002](../../engineering-decisions/0002-toolchain.md).
  Date/Author: 2026-10-28 / Paul, Claude
- Decision: the API owns logic and workflows; the portal moves to the web.
  Rationale: [ADR-0003](../../engineering-decisions/0003-api-owns-logic-web-presents.md).
  Date/Author: 2026-10-28 / Paul, Claude
- Decision: vouchers first; Snippe mobile-money payments deferred.
  Rationale: vouchers prove the router path without a payment provider.
  Date/Author: 2026-10-28 / Paul
- Decision: develop against MikroTik CHR (Cloud Hosted Router, free licence, 1 Mbps);
  buy one physical board (an ARM model with built-in WiFi, not a `smips` board) before M7.
  Rationale: a hotspot must sit on the guests' network, so production needs hardware at
  each venue, but everything except a phone joining real WiFi can be proved on CHR.
  Date/Author: 2026-10-28 / Paul, Claude
- Decision: the repository stays private until M5's security fixes land.
  Rationale: the findings above describe exploitable defects; the code is published once
  they are fixed. The purchased code is HashiFi's to change or delete without the seller.
  Date/Author: 2026-10-28 / Paul
- Decision: email through Resend; BullMQ on Redis where a queue is needed, or a better tool
  with its reason recorded.
  Rationale: [ADR-0002](../../engineering-decisions/0002-toolchain.md), as the other products.
  Date/Author: 2026-10-28 / Paul
- Decision: wide-event logging with LogTape and Sentry, as in Pigfarm and ntumie., built in M4.
  Rationale: [ADR-0002](../../engineering-decisions/0002-toolchain.md); the router provisioning
  code's own `RouterLogger` transcript becomes the provisioning job's wide event.
  Date/Author: 2026-10-29 / Paul
- Decision: no `any` or `undefined` in types; absence is `null`.
  Rationale: [ADR-0004](../../engineering-decisions/0004-types-without-any-or-undefined.md).
  Date/Author: 2026-10-28 / Paul
- Decision: no HashiFi sign-in implementation; admins sign in through the shared Hashikome
  identity service, planned as cross-product workspace work. The plan is drafted before M4,
  which depends on it; M2 and M3 do not.
  Rationale: [ADR-0005](../../engineering-decisions/0005-shared-identity.md); a third copy of
  ntumie. and Pigfarm's sign-in is the duplication the service removes.
  Date/Author: 2026-10-28 / Paul
- Decision: lint findings in code M3 and M4 replace (Express routes, middleware, `server.ts`,
  the Drizzle layer) are warnings until those milestones remove the code, rather than typed
  now and deleted after. The router portal pages (`apps/api/mikrotik-files/`) are uploaded to
  routers as received; Biome does not touch them.
  Rationale: kept code (`services/`, `utils/`, the web) is fixed; the rest is rewritten.
  Date/Author: 2026-10-28 / Claude
- Decision: FSL-1.1-ALv2, Shikome Technology Limited as licensor.
  Rationale: public source without permitting a competing commercial service.
  Date/Author: 2026-10-28 / Paul

## Outcomes & Retrospective

Not started beyond the import and scaffold.

## Context And Orientation

- `apps/api` (as received): Express 5, Drizzle on MySQL, `ws`, `routeros` (RouterOS API
  client), `sharp` (portal images), `nodemailer` (admin sign-in codes). Entry
  `src/server.ts`; one file per resource in `src/routes/`; `src/services/` holds
  `router-provision/` (bootstrap script, capability probe, per-board dialect, setup steps,
  readiness and verification), `mikrotik.ts`, `router-sync.ts`, `reconcile-daemon.ts`,
  `expiry-daemon.ts` and `live-monitor.ts`. Tests sit beside the code as `*.test.ts`.
  `mikrotik-files/` are the pages uploaded to routers; `mikrotik-knowledge-files/` is the
  seller's router onboarding procedure and reference, worth keeping as runbooks.
- `apps/web` (as received): Next.js 16 admin with shadcn components; `lib/types.ts` mirrors
  the API's responses.
- **CHR**: MikroTik's RouterOS as a virtual machine image, used here as the router lab.
- **Walled garden**: hosts a hotspot lets unauthenticated guests reach (the portal and API).

## Plan Of Work

### M1 Toolchain and name

Done (see Progress). One root `bun.lock`; Biome replaces Prettier; root scripts from the template made real.
Dependencies moved to the newest stable releases and pinned (check `npm view <pkg>
dist-tags`: Prisma's `latest` is a release candidate at the time of writing, so 7.10.1).
Every "WiFi Billing" and `wifi_billing`/`wifibilling` name becomes HashiFi (UI strings,
cookie and database names, demo addresses, router pages). In the web: remove
`@vercel/analytics`, replace the `next-maps` GitHub dependency, fix the Recharts error and
drop `typescript.ignoreBuildErrors`. `bun run verify` passes, with the 170 purchased tests.

### M2 Router lab on CHR

Run CHR locally; apply the bootstrap script and the automated setup to it. Decide, with
evidence, and record as an ADR:

- how the cloud API reaches routers behind NAT (WireGuard opened by the router, the API on
  the encrypted API port through it);
- how the walled garden admits the portal and API by name rather than a changing IP;
- that `routeros` and `sharp` work under Bun.

A script brings the lab up so the provisioning steps and readiness checks can be run
against it repeatably.

### M3 Prisma schema on PostgreSQL

Port `apps/api/src/db/schema.ts` to `prisma/schema.prisma`: `uuid` keys, `jsonb`,
`timestamptz`. Watch the MySQL behaviours the code may rely on:

- case-insensitive comparison: voucher codes, emails and phone numbers are normalised on
  write, or compared case-insensitively;
- `CONVERT_TZ`/`DATE_FORMAT` in `routes/analytics.ts` (27 and 15 uses) and
  `onDuplicateKeyUpdate` (4 uses) become PostgreSQL equivalents;
- the UTC-on-disk, Dar es Salaam-calendar rule.
- `apps/api/src/db/schema.ts` is the source for `@hashifi/types`' record types: keep them
  identical as the Prisma models are written.

A fresh migration history starts at the Prisma baseline; Drizzle and `drizzle/` are removed.
The seed uses invented data.

### M4 NestJS API

Prerequisite: the shared identity service plan, drafted in the Hashikome workspace (ADR-0005).

One NestJS module per resource (venues, routers, packages, vouchers, customers, sessions,
analytics, revenue, portal settings, team, audit, auth). Provisioning, router sync and the
jobs become providers, with their tests carried over unchanged. Every query is scoped by
role and venue (finding 3). Router secrets use AES-256-GCM with a required key (finding 4). Configuration reads each secret through one helper that prefers `<NAME>_FILE` (a Docker
secret) over the plain variable, as ntumie.'s `apps/api/src/config/secret.ts` does, and
validates everything at startup ([SECURITY.md](../../SECURITY.md#credentials)).
Totals and derived figures the admin pages compute today move into the responses, and the API
enforces every rule the web pre-checks (the package price and throttle rules). The NestJS DTOs
implement `@hashifi/types`, which grows to the whole contract, and `apps/web/lib/types.ts` (the
stale hand-written copy) is deleted; raw `fetch` moves into one client module. `RosRow`
(`Record<string, string | undefined>`) becomes a `null`-returning accessor at the RouterOS
boundary (ADR-0004). Email moves to Resend. Sign-in is not ported: it comes from the shared
identity service (ADR-0005); the vendor's OTP login, sessions and mailer templates for account
events are removed with the Express app. The lint override in `biome.json` is removed. Observability (ADR-0002): LogTape and Sentry
initialised from an entrypoint before the app, one wide event per HTTP request and per job
(provisioning, router sync, expiry, reconciliation), redacting voucher codes, credentials,
phone numbers and MACs; the vendor's `console.log` calls go. Snippe
routes and the webhook are left out (backlog). The vendor's onboarding knowledge files move
to `docs/runbooks/`.

### M5 Captive portal in the web, and the security pass

The portal pages move to `apps/web`; the API exposes the portal workflows. `link-login` is
accepted only as an `http(s)` URL whose host is a registered router or hotspot gateway;
`mac` and `ip` are validated; no voucher code is returned for reconnection, which uses the
router's own mechanism (MAC cookie) or a short-lived token tied to the router's request
(findings 1 and 2). Values in scripts are JSON-encoded. A review of every public endpoint
follows, with findings fixed or recorded.

### M6 Release pipeline and deployment

Dockerfiles, `verify` and `release` workflows copied from ntumie. and adapted; images in
GHCR; the stack's sensitive values as external Docker secrets, the rest in a private env
file, with an optional 1Password `op run` adapter that the application does not depend on; a database and role on the shared PostgreSQL through the infra repository; Dokploy
deployment; Uptime Kuma monitors. The production domain is chosen here.

### M7 Live acceptance on a physical router

A physical MikroTik at Paul's home onboarded through the admin; a phone redeems a voucher,
browses, reconnects, and is cut off at expiry.

## Concrete Steps

From the repository root, once M1 lands:

```bash
bun install
bun run verify
```

Expected result: every check passes, including the 170 purchased tests.

## Validation And Acceptance

- `bun run verify` passes at the end of every milestone.
- M2: the bootstrap script and automated setup turn a fresh CHR into a passing readiness
  checklist, from the API, through the chosen tunnel.
- M5: regression tests show the auto-reconnect never returns a voucher code, an
  unregistered or non-http `link-login` is refused, and a manager cannot read another
  venue's routers.
- M7: the outcome in Purpose, on a physical router and a real phone.

## Idempotence And Recovery

The router setup is designed to be re-run safely (tagged configuration). CHR can be reset
by recreating the VM. Nothing is deployed before M6, so schema changes before then start
from a fresh database.

## Artifacts And Notes

- Archives: `../workspace/inbox/hashifi/` (local, not in Git). sha256:
  backend `ba99c1e6addfe7e25ade005ace0d6923415711e95f004394d1eecfc634414a2e`, frontend
  `35d85a47dfea041e9fcc30d596c097f308660212035bf0fb6232dac23cab45f5`. The backend archive's
  `database-backups/` and `uploads/` hold third parties' personal data: delete them from the
  archive copy once the structure-only dump is no longer needed for M3.

## Interfaces And Dependencies

- Shared platform: PostgreSQL 18, GHCR, Dokploy, Uptime Kuma (infra repository).
- MikroTik RouterOS 7 with the hotspot package; CHR for development.
- Snippe (later): `docs/backlog/mobile-money-payments.md`.
