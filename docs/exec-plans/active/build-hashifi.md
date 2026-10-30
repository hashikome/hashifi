# Adopt the earlier billing system as HashiFi

This ExecPlan is a living document. Maintain it according to `PLANS.md`. Keep `Progress`,
`Surprises & Discoveries`, `Decision Log` and `Outcomes & Retrospective` current as work
proceeds.

## Purpose / Big Picture

Build HashiFi on the Hashikome stack, deployed through
the shared platform. When done, an admin onboards a reset MikroTik through the generated
bootstrap script and automated setup, generates vouchers for a package, and a phone on that
router's WiFi reaches the HashiFi portal, redeems a voucher and browses until the voucher
expires. The API runs as NestJS on Bun with Prisma and the shared PostgreSQL 18, the portal
and admin are presented by `apps/web`, and releases go GitHub CI → GHCR → Dokploy.

## Progress

- [x] (2026-10-28) Starting archives inspected; checksums recorded; third parties' data
  found in `database-backups/` and `uploads/` and excluded.
- [x] (2026-10-28) Baseline at the start: backend typecheck clean and 170/170 tests pass on
  Bun 1.4.4 (with a placeholder `DATABASE_URL`); frontend typecheck has one known error
  (`components/chart-area-interactive.tsx`, a Recharts overload).
- [x] (2026-10-28) NestJS 12.3.2 smoke-tested on Bun 1.4.4: dependency injection, decorators
  and routing work.
- [x] (2026-10-28) Starting code in `45ebd53`; repository scaffolded from the
  Hashikome template; FSL-1.1-ALv2; packages renamed `@hashifi/api` and `@hashifi/web`; pnpm
  and npm files removed.
- [x] (2026-10-28) M1 Toolchain and name. One root `bun.lock` (Bun 1.4.4 isolated installs);
  every dependency on its newest stable release, pinned; Biome replaces Prettier and ESLint;
  `@hashifi/types` carries the API's JSON contract; unused code removed (the v0 starter
  dashboard and its components, 36 unused UI and hook files, 30 unused dependencies, Vercel
  Analytics, `next-maps`, `dotenv`, `tsx`); TypeScript 7 in both apps with type errors failing
  the build; no `any` or `!` in kept code; HashiFi naming throughout; `ENCRYPTION_KEY` required.
  `bun run verify` passes: 170/170 tests, both typechecks, lint, format, web build.
- [x] (2026-10-29) M2 Router sim on CHR. Done apart from what needs hardware (M8).
  - [x] (2026-10-29) Router sim: `bun run router-sim` boots RouterOS 7.25 CHR in QEMU and runs onboarding
    through the real code (serial-console bootstrap, `setupRouter`, `probeVerify`). A
    factory-fresh router onboards in one pass (14 changes applied and verified); a second run
    applies 0; verify passes with the two expected warnings. Two provisioning defects fixed.
    Provisioning reaches persistence only through `RouterStore`, and credentials carry their
    own port (the management target). Runbook: `docs/runbooks/router-sim.md`.
  - [x] (2026-10-29) Management tunnel proved in the router sim and recorded as
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
  - [x] (2026-10-29) Guest VM on the hotspot: `guest-test` passes all steps on a fresh router
    with either portal origin: DHCP lease, redirect to the portal, walled garden open to an
    HTTPS portal host and closed to other sites, a voucher from the API's code, internet after
    login, cut off at expiry. A negative control (walled garden disabled) fails the walled-
    garden step, so the check discriminates.
  - [x] (2026-10-29) `sharp` 0.35.5 (libvips 8.18.7) under Bun: `utils/image.test.ts` runs the
    portal-image pipeline (logo crop, background fit, invalid input rejected). `routeros` is
    proved by the router sim; it hangs on a closed connection, which `connectToRouter`'s
    timeout covers.
- [x] (2026-10-29) M3 Prisma on PostgreSQL and the NestJS shell. Acceptance met: the baseline
  migration deploys on an empty PostgreSQL 18; `bun run router-sim setup` provisions a fresh
  CHR through `PrismaRouterStore` with real rows, in LAN and tunnel modes, and the guest test
  passes with a voucher sold by `RouterSync`; the business-day test passes; unit and
  integration tests pass (`bun run test`, `bun run test:integration`).
  - Schema: `apps/api/prisma/schema.prisma` and one baseline migration with CHECKs for
    upper-case codes and lower-case emails. Sign-in tables and PPPoE dropped; tunnel fields
    added; `mpesa` provider renamed `mobile_money`; venue packages keyed by the pair.
  - Shell: `src/entrypoint.ts` (telemetry first), `src/main.ts`, validated `src/config/` with
    `_FILE` secrets, `PrismaService`, `/api/health` and `/api/health/ready` (503 without
    PostgreSQL, recovering with it), background jobs as wide events (`src/jobs/`).
  - Services on Prisma: `RouterAccess`, `SecretBox` (AES-256-GCM), `AuditLog`, `RouterSync`,
    `VoucherExpiry`, `VoucherReconciler`, `LiveMonitor`, `PrismaRouterStore`,
    `TunnelAllocator`; serializers to `@hashifi/types` (`src/serializers/`); business-day
    helpers (`src/analytics/`); an idempotent invented seed.
  - The earlier Express app is removed; M4 ports each route from commit
    (`git show 45ebd53:apps/api/src/routes/<name>.ts`).
- [x] (2026-10-30) M4 NestJS API, with the admin web on it.
  - [x] (2026-10-29) Schema: Better Auth's tables, `staff` sharing the user's id, `devices`
    (`2602b08`); a per-person sign-in code budget table.
  - [x] (2026-10-29) Sign-in (ADR-0007), `src/auth/`: Better Auth 1.7.14 mounted at
    `/api/auth` ahead of Nest's body parser, with only the routes HashiFi uses reachable
    (code request, code sign-in, session, sign-out, authenticator enrollment and checks).
    Email codes keyed by an HMAC, five attempts, ten minutes, sent only to active staff and in
    the background, so a stranger's email gets the same answer in the same time; PostgreSQL
    rate limits per client address plus five codes per person per fifteen minutes. The
    authenticator gate is widened to the email-code sign-in, and no device is trusted to
    skip it. `StaffGuard` is global and default-deny: active staff on every request, admins
    without an authenticator reach only `GET /api/me`. `bun run staff:add` creates the first
    admin; email goes through Resend, or to `data/email/` in development.
    Acceptance: `sign-in.integration.test.ts` over HTTP against PostgreSQL (code to session,
    identical answers for strangers, codes not stored as sent, five wrong codes, address
    and per-person limits, suspension, refused library routes, authenticator enrollment and
    the two-step sign-in, trust-device refused); the trust-device test was seen to fail with
    the protection removed.
  - [x] (2026-10-29) The HTTP foundation and the first scoped module, venues. One error shape,
    `ApiError` (`{ code, message, details }`), from `ErrorEnvelopeFilter`; bodies parsed by
    `parseInput` with field-by-field `VALIDATION_FAILED`; non-UUID ids are not found. One wide
    event per request from Express middleware ahead of everything (route pattern, status,
    `staff.id`, never path values or query strings), so the guard's and sign-in's refusals
    are recorded. Cookie-carrying writes from any origin but the web's get 403
    `ORIGIN_NOT_ALLOWED`. `trust proxy` follows `TRUSTED_PROXIES` for audit addresses.
    `venueScope` limits managers to the venues they operate; outside it is 404. Venues:
    list with router counts, read, and admin-only create, update and delete, each audited; the
    API enforces what the form pre-checks (region, city and country required), refuses control
    characters, lower-cases the contact email, and requires the operator to be an active
    manager. A venue with routers cannot be deleted (409 `VENUE_HAS_ROUTERS`); the earlier
    code cascaded, deleting running routers' records and tunnel keys.
    Acceptance: `venues.integration.test.ts` (401 without a session; 403
    `TWO_FACTOR_ENROLLMENT_REQUIRED` for an unenrolled admin; a manager sees only their
    venues, gets 404 for another's and 403 on writes; validation; the delete rule; a
    foreign-origin form post and an origin-less write refused) and
    `http-events.integration.test.ts` (events for a 401, a sign-in route and a scoped 404,
    with no id or query value in them).
  - [x] (2026-10-30) Routers (`src/routers/`). Managers list and read their venues' routers
    and the provisioning backlog, now scoped to their venues (finding 3); everything else is
    admin-only. `routerRecord` is an allowlist: no credential, key or sealed value leaves, and
    `provisioningCommand` (free RouterOS commands, which may hold credentials) goes only to
    admins. Status, versions and tunnels are never taken from a request. Updates are `PUT`
    (the form sends the whole router; an empty password keeps the stored one), and a router
    cannot change venue. The bootstrap script is generated for a saved router: it creates the
    API password and the tunnel once and stores them sealed, so it is the same script each
    time (`Cache-Control: no-store`). `test-connection` is for unsaved routers only and takes
    every credential, so a stored password is never sent to an address typed into a form; a
    saved router is tested by probing its stored target. An unreachable router is a 502 with
    `ROUTER_<KIND>`. Provisioning takes its endpoints, API port and connect timeout from
    `AppConfig` instead of `process.env`; tunnel settings are in config (ADR-0006).
    Acceptance: `routers.integration.test.ts` (CRUD with no secret in any body; request
    cannot set status or tunnel; a manager's scope and 403 on all eleven write and router
    routes; the scoped backlog; one password across two scripts; a 502 within the connect
    timeout; test-connection needs every credential) and
    `routers-tunnel.integration.test.ts` (one tunnel across two scripts, opened to the
    platform). Router sim after the configuration change: a fresh CHR set up in 17 s in LAN
    mode, the guest test 6/6, and set up and verified over the tunnel.
  - [x] (2026-10-30) Packages (`src/packages/`). One catalogue for all venues: admins
    create, replace (`PUT`) and delete, each audited; managers read only active packages. The
    API enforces the form's rules (whole shillings from TSh 1,000; durations up to a year;
    throttled speeds below the normal ones) and the ones throttling needs (a throttled speed
    needs peak hours or a data threshold, and the reverse; both peak hours or neither, and not
    equal; a threshold below the data limit). A package that unused, pending or active
    vouchers use cannot be deleted (409 `PACKAGE_IN_USE`; the earlier delete left them
    without a package, so routers skipped them); deactivate it instead. What a venue sells is
    one rule (`soldAt`): its assigned active packages, or every active package when none are
    assigned, at `GET /api/venues/:venueId/packages`, scoped like the venue; assignments are
    `PUT` and `DELETE` on `/api/venues/:venueId/packages/:packageId`, idempotent and audited.
    The earlier code had two venue listings with different fallbacks.
    Acceptance: `packages.integration.test.ts` (CRUD and audit; thirteen refused inputs and a
    window across midnight accepted; the in-use delete; a manager's reads and 403s; the sold-at
    rule through assignment, deactivation and removal, and another venue's 404).
  - [x] (2026-10-30) Vouchers (`src/vouchers/`). Batches (`POST /api/vouchers/batches`) are
    made by admins, or by managers for their own venues, only for a package the venue sells
    (`soldAt`); codes are unique, retried on collision, and carry the package's duration, data
    limit and price. The prefix defaults to the portal's and no longer overwrites it (the
    earlier generate set the global portal prefix to each batch's). Routers get the codes in
    the background; a router that misses them gets each at redemption. Revoking
    (`POST /api/vouchers/revoke`, admins) replaces deleting: only unused vouchers, which stop
    working and leave the routers but stay on record, so no paying guest is cut off and no
    sale disappears (the web pre-checked this; the API now decides). Printing is by batch
    (`GET /api/vouchers/batches/:id`) or by voucher ids (`POST /api/vouchers/print`), never by
    code: the earlier print page put codes, the guests' credentials, in the URL. The list is
    scoped and paged (`before`, newest first). The web's voucher pages move to these endpoints
    now, since the shared types changed under them; they typecheck and build but were not
    exercised in a browser.
    Acceptance: `voucher-codes.test.ts` (format, alphabet coverage, collisions replaced, a
    full store fails) and `vouchers.integration.test.ts` (a manager's batch with the package's
    terms; prefix defaulting without touching the portal; packages not on sale and another
    venue refused; scoped, paged listing and batches; revoke only unused, admins only; reprint
    by id within scope).
  - [x] (2026-10-30) Devices and sessions (`src/devices/`, `src/sessions/`, one module).
    `sessionScope` limits a manager to sessions at their venues, and a device belongs to no
    venue, so a manager sees a device only if it had a session there, with usage and online
    state counted from those sessions alone (finding 6). Both lists are paged (`before`) with
    counts or totals over every match. Admins block, unblock and delete devices
    (`PUT /api/devices/:id/status`, `DELETE`), audited without the MAC address; blocking ends
    the device's connected sessions everywhere and kicks their vouchers, and the portal will
    refuse a blocked device (M5: nothing enforced the earlier `blocked` flag). Deleting
    forgets the device and keeps its sessions unlinked. Managers end sessions at their venues
    (`POST /api/sessions/:id/terminate`, 409 once ended); the voucher stays valid, so the
    guest can sign in again. The observed fields the earlier `PATCH /customers/:id` let an
    admin rewrite (MAC, IP, device name) are read-only. The web's Users and Sessions pages
    still call `/api/customers` and `PATCH .../terminate` until the web pass.
    Acceptance: `devices-sessions.integration.test.ts` (one phone at two venues: the manager
    sees 1 GB and offline, the admin 5 GB and online; filters and paging; blocking ends the
    remote session and changes the counts; unblock and delete, audited without the MAC; scoped
    session list and totals; terminate within scope, once).
  - [x] (2026-10-30) Analytics and revenue (`src/analytics/`). Revenue has one definition,
    a SQL CTE (`REVENUE_EVENTS`): paid payments when paid, by provider (a staff-recorded
    payment is cash), and printed vouchers with no paid payment, at their price, once the
    router confirmed them (`active` or `used`). The earlier code repeated the rule in four
    places, counted vouchers that lapsed while pending, and cut months and days by the
    server's clock; every figure now groups by the Africa/Dar_es_Salaam business day or month
    (`businessDaySql`). Daily usage returns every day in the range, so revenue on a day with no
    sessions is no longer dropped. Managers get usage over their venues (package and device-type
    shares included, which the earlier code reported for everyone) and no revenue; the
    monthly trend, top venues and `/api/revenue/*` are admin-only. Money is two-decimal text;
    the transaction list carries the payment's provider reference or the card's batch prefix,
    never a phone number. Shapes are new (`@hashifi/types`); the web's dashboard, analytics
    and revenue pages follow in the web pass.
    Acceptance: `analytics.integration.test.ts` (an October across two venues: four kinds that
    count and four that must not; a card redeemed at 21:30 UTC on 30 September counts in
    October; growth against September; by venue, by package, transactions without phones;
    31 days including empty ones; six months; a manager's scoped usage, null revenue, and 403
    on the six admin reports).
  - [x] (2026-10-30) Portal settings (`src/portal/`). One settings row (`singleton`, CHECK);
    `GET /api/portal` gives any staff member the saved settings or the API's defaults (the
    earlier route answered 404 and each web page carried its own defaults); admins replace
    them with `PUT`, audited, validated field by field (colours as `#RRGGBB`, one-line texts,
    the voucher prefix upper-case). No uploads: the logo is `apps/web/public/logo.svg`, shown
    by the portal previews and printed vouchers, and the upload routes, image processing
    (`sharp`), crop dialog (`react-image-crop`) and the logo, background and letter-mark
    columns are gone (Decision Log). `logo.svg` is a placeholder mark for the owner to replace.
    Acceptance: `portal.integration.test.ts` (defaults, one row, audit, manager read-only;
    refused fields, an unknown `logoUrl` ignored).
  - [x] (2026-10-30) Team and audit (`src/team/`, `src/audit/audit.controller.ts`), admins
    only. Adding someone creates their Better Auth user and staff record in one transaction
    (`createStaffRows`, shared with `bun run staff:add`); a manager may operate several venues
    (`venueIds`; the earlier page assumed one), an admin none. Name, email, phone and venues
    are replaced with `PUT`; a changed email is told at its old address. Role and status have
    their own routes; promoting frees the venues and the staff guard then requires an
    authenticator; suspending deletes the person's sessions; another admin resets a lost
    authenticator (removes it, signs the person out). Nobody changes their own role, status or
    authenticator, or removes themselves (409 `NOT_ON_YOURSELF`); HashiFi keeps an active admin
    (409 `LAST_ADMIN`), checked under a lock on every admin row taken in one order, because
    through the API it can only be broken by two admins acting on each other at once. Each
    change is audited and the person emailed (`team-emails.ts`, plain text, no sign-in links).
    `GET /api/audit` pages the trail with filters by record and actor.
    Acceptance: `team.integration.test.ts` (add a manager with two venues, who is told and
    sees them; taken email, admin with venues and bad phone refused; email change; suspend
    and reactivate; four self-actions refused; two mutual demotions and two mutual suspensions
    at once leave one admin, the first seen to fail without the lock; promotion and reset;
    removal frees venues and stays in the audit trail).
  - [x] (2026-10-30) The live view (`src/live/live-hub.ts`, finding 8). `/ws/live` is
    upgraded by the hub itself, since guards do not run on an upgrade: the session cookie must
    belong to active staff (an admin only with an authenticator), and the Origin must be the
    web's, or the upgrade is refused with 401 or 403. Open sockets are signed in again every
    minute (`REVALIDATE_MS`), so suspension disconnects (close 4401). Hotspot updates go to
    admins and the venue's managers; provisioning transcripts (secret parameters already
    redacted) to admins. While anyone watches, the live monitor polls routers every tick;
    otherwise every sixth. Works through Express on Bun's `node:http`.
    Acceptance: `live.integration.test.ts` (no session, another origin and an unenrolled admin
    refused; a manager gets one of two venues' updates and no transcript, an admin all three;
    a suspended manager is closed at the next check); the origin test fails with the check
    removed.
  - [x] (2026-10-30) `RosRow` is a class at the RouterOS boundary: `get(field)` returns
    `string | null`, and `toRows` builds every reply, including `mikrotik.ts`. Absence checks
    moved from `undefined` to `null`; the one read that relied on `Number(undefined)` being
    `NaN` (`pingTotals`, where `Number(null)` is `0`) has a test. Router sim after the change:
    setup and verify on a fresh CHR, guest test 6/6 twice. One earlier run on a router not
    reset first failed 2 of 6 guest checks with the serial console's echo in the output; it
    did not repeat, and the cause is not known.
  - [x] (2026-10-30) The vendor's guides are `docs/runbooks/router-onboarding.md` and
    `mikrotik-hotspot-reference.md`, with a note on what changed since they were written.
  - [x] (2026-10-30) Web pass, first slice: `lib/api.ts` (one client, typed errors), sign-in
    on Better Auth (email code, then the authenticator or a backup code), and
    `/setup-authenticator` (QR code, key, backup codes), where the admin layout holds anyone
    `twoFactorEnrollmentRequired`. `PUT /api/me` changes one's own name. Checked in headless
    Chrome: an admin held at setup, enrolled, reaching `/admin`; a second browser asked for both
    codes; no API errors but the 401 from `/api/me` before signing in.
  - [x] (2026-10-30) Web pass, the rest: every admin page reads `@hashifi/types` through
    `lib/api.ts`, and the hand-written `lib/types.ts` is gone. Saving a router now comes before
    its script; a venue save leaves its operator alone; package and router edits send the
    whole record, keeping what the form does not show; Payments is removed until M6 gives it an
    API. Checked in headless Chrome against the real API and database: all sixteen admin pages
    load with no API or console errors; a router saved and its script generated; a batch of
    three made and printed by batch id; the portal saved; a manager added, signing in, seeing
    their venue and sent away from Team.
    Left for later, in `docs/backlog/technical-debt.md`: the provisioning report types are still
    copied in `provision-dialog.tsx`; a second setup on a busy router is not refused.
- [x] (2026-10-30) M5 Captive portal in the web, and the security pass
  ([ADR-0008](../../engineering-decisions/0008-captive-portal.md)). `apps/web/app/portal/login`
  takes a voucher, outside the staff route group; the API's `/api/guest/*` decides everything.
  Findings 1 and 2 are closed: no code is returned for a MAC, `link-login` is checked against the
  router and rebuilt, and the router pages use URL-encoded variables. Public endpoints are
  reviewed in `docs/SECURITY.md`.
  Acceptance: `guest.integration.test.ts` (another venue's voucher,
  two devices racing for one place, blocked devices, attempt limits, session status);
  `router-sim guest-test` 14/14 through the real API, sign-in back 48 s after an unblock; the page
  in headless Chrome at phone width, wrong code, handoff to the router page and its POST,
  a scanned card going round, a hostile `link-orig` inert, nothing fetched from another host.
- [x] (2026-10-30) Sign-in moved to the API, closing M5's open findings. The hotspot is
  `login-by=mac-cookie` alone, and `/ip hotspot active login` is probed and required. No response
  or router page holds a code; `link-login`, the router's login form and `alogin.html` are gone.
  Every package has a router profile, so a device's MAC cookie lasts as long as its package. On
  a production build the portal is about 200 KB gzipped, self-hosted font included. Reviewed with the
  design inspector and detector: one FAIL stands, the default brand colour on the house rules'
  banned terracotta list, which is the owner's decision.
  Acceptance: `router-sim guest-test` 17/17 on a router set up by the normal path; integration
  tests for a device the router cannot see and a login the router refuses; the page in headless
  Chrome with a simulated router redirect. Not done: a real phone, a captive sheet and an https
  portal (M8).
- [ ] M6 Mobile-money payments (Snippe) and customers.
- [ ] M7 Release pipeline and deployment.
- [ ] M8 Live acceptance on a physical router: a mobile-money purchase and a printed voucher.

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
- Observation: security defects in the starting code (fixed in M4 and M5, each with a
  regression test):
  1. The portal's auto-reconnect returns a voucher code (the hotspot username and password)
     to anyone supplying an active device's MAC in the query string, inside a form that
     posts itself to an unvalidated `link-login` URL; a `javascript:` URL there runs script.
     Evidence: `45ebd53:apps/api/src/routes/captive-portal.ts:120`, `renderAutoReconnect`.
  2. Query values are placed in inline scripts with HTML escaping only (`esc`), which does
     not escape backslashes or newlines. Not exploitable as found, but the wrong encoding.
     Evidence: `45ebd53:apps/api/src/routes/captive-portal.ts:1149`.
  3. `GET /api/routers/provisioning-backlog` requires sign-in but no role or venue scope,
     so a manager sees every venue's routers. Other read routes may share this.
     Evidence: `45ebd53:apps/api/src/routes/routers.ts:130`.
  4. Router passwords are encrypted with AES-256-CBC (unauthenticated) and a published
     fallback key when `ENCRYPTION_KEY` is unset. Fixed in M3 (`SecretBox`, AES-256-GCM).
     Evidence: `45ebd53:apps/api/src/utils/encrypt.ts:3`.
  5. Voucher codes, which are the hotspot credentials, come from `Math.random()`: six base-36
     characters (about 31 bits) from a non-cryptographic generator, so they can be guessed or
     predicted, and nothing rate-limits redemption. Fixed in M4: eight characters from
     `node:crypto`'s `randomInt` over a 31-character upper-case alphabet without 0, O, 1, I or L
     (`voucher-codes.ts`, about 39.6 bits); M5 rate-limits redemption.
     Evidence: `45ebd53:apps/api/src/routes/vouchers.ts` (batch generation).
  6. Customers are listed and read with no venue scoping, so a manager sees every venue's
     guests (phone numbers, devices). Fixed in M4: devices (the renamed customers) are scoped
     to the manager's venues through their sessions, with usage and online state counted at
     those venues only, and 404 outside them.
     Evidence: `45ebd53:apps/api/src/routes/customers.ts` (list and `GET /:id`).
  7. The bootstrap script put the router name, unchecked, into its banner comment, so a name
     containing a newline ended the comment and ran the rest as a RouterOS command when the
     admin pasted the script (for example a full-rights `/user add`). Fixed in M3: the script
     builder refuses control characters in every value it interpolates, and the request schema
     rejects them in the router name as in the other fields; `bootstrap.test.ts`.
     Evidence: `45ebd53:apps/api/src/services/router-provision/bootstrap.ts` (banner and
     `routerName` schema).
  8. The live socket (`/ws/live`) accepted any connection: no sign-in, no origin check. Anyone
     who could reach the API received every venue's connected guests (voucher codes, MAC and
     IP addresses) and every provisioning transcript. Fixed in M4 (`live-hub.ts`): the upgrade
     needs active staff (an admin with an authenticator) and the web's origin, sockets are
     checked again every minute, managers receive only their venues' hotspots, and transcripts
     go to admins only; `live.integration.test.ts`.
     Evidence: `45ebd53:apps/api/src/server.ts` (`new WebSocketServer({ server, path })`).
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
  Evidence: `apps/web/app/admin/packages/create/page.tsx`, `[id]/edit/page.tsx`. The API
  enforces them since the packages module (`package-input.ts`), with the rules that make
  throttling apply at all: the earlier API accepted a throttled speed with no peak hours or
  data threshold, and peak hours or a threshold with no throttled speed, each of which the
  live monitor then ignored.
- Observation: Biome's "safe" fixes rewrote the router portal pages' inline scripts (ES5
  `function` to arrow functions). The router only stores and serves these pages; the guest's
  browser runs them, and every browser since about 2016 runs arrow functions, so only very old
  Android WebViews (4.4 and earlier) would fail. They are ES5 on purpose, so
  they are restored unchanged apart from the brand name and excluded from Biome; M5 decides
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
  Evidence: router sim, 2026-10-29; `bootstrap.test.ts`.
- Observation: on CHR 7.25 a running hotspot keeps its dynamic firewall rules first whatever
  static rules do, re-inserting them above its disabled "place hotspot rules here" rule each time
  it starts; on a fresh board they also appear a moment after the server is created. Placing our
  accepts first therefore failed the read-back, and moving them above the dynamic rules is
  ignored. The firewall steps now wait for the hotspot's rules and place ours above the
  placeholder. The hAP lite (measured on the board) let a static rule sit above the dynamic
  ones; both cases are accepted.
  Evidence: router sim, 2026-10-29; `steps.test.ts`.
- Observation: the earlier code used one backend address for two roles: management (API
  connections, the router's input accept rule, readiness ping, portal-file download) and the
  guest-facing portal (login redirect, walled garden, forward accept). The IP binding
  (`ip-binding-backend`) bypasses the hotspot for the management address, which only matters if
  the API sits on the guest network; it is kept for now and reviewed with the tunnel.
- Observation: a walled-garden `dst-host` entry is accepted but flagged invalid while its name
  does not resolve; resolved, RouterOS keeps one pass-through rule pair per address.
- Observation: the guest segment first used a QEMU multicast socket, which never delivered:
  this host routes multicast into its Cloudflare WARP VPN interface. A point-to-point UDP link
  on 127.0.0.1 replaced it.
  Evidence: `ip route get 230.0.0.1` → `dev CloudflareWARP`; router `ether2` rx-packet 0.
- Observation: RouterOS compares hotspot usernames case-sensitively: a lower-cased voucher code
  was refused (`invalid username or password`) and the exact code logged in. MySQL had compared
  codes case-insensitively, PostgreSQL does not; codes are now upper-case by CHECK and guest
  input is to be upper-cased before lookup and login (M5).
  Evidence: router sim, `/ip hotspot active login` with each case, 2026-10-29.
- Observation: the earlier expiry job selected expired `pending_activation` vouchers but then
  marked only `active` and `unused` ones, leaving the rest pending forever (its own comment said
  otherwise). Fixed; `test/integration/voucher-jobs.integration.test.ts`.
- Observation: Sentry 11 removed `sendDefaultPii`; its replacement, `dataCollection`, collects
  user info, cookies, headers, bodies and query parameters by default. Every category is off.
- Observation: Prisma 7 reads no `.env` and Bun does not load one for Prisma's binary;
  `prisma.config.ts` loads `apps/api/.env` itself and falls back to the local database URL, so
  `prisma generate` (run on install) needs no database, as a fresh clone and CI require.
- Observation: Better Auth 1.7's two-factor gate only covers password-style sign-ins, and its
  after-hook handler receives the hook input rather than the endpoint context, so Pigfarm's
  1.6 wrapper (overriding `getSignedCookie`) failed with a 500. HashiFi widens the gate's
  matcher and hands it the request headers without the trust-device cookie.
  Evidence: `apps/api/src/auth/create-auth.ts` (`withEmailCodeGate`).
- Observation: the per-person code budget, first checked in the send callback, let anyone
  lock a staff member out: by then the library had already replaced their code, so each
  refused request voided the code last sent. It is now decided in the before-hook, ahead of
  code creation, with the library's own answer.
  Evidence: `sign-in.integration.test.ts` ("requests beyond the budget do not void the last
  code sent"), failing before the fix.
- Observation: concurrent tunnel allocations all chose the same lowest free address and
  retried on the unique index; twenty at once exhausted the five retries (the eight-router
  test failed now and then). Allocation now takes a PostgreSQL transaction lock.
  Evidence: `tunnel-allocator.integration.test.ts` with 20 routers fails on the previous
  allocator, passes on the new one.
- Observation: on RouterOS 7.25, removing an active session also deletes its MAC cookie, so the
  planned reconnect by cookie alone would have left every throttled device signed out. The API
  signs it back in with `/ip hotspot active login`. Also, a device that sent traffic while blocked
  is refused for about 50 seconds after unblocking.
  Evidence: `/ip hotspot cookie print` around a kick; `router-sim guest-test`.
- Observation: the one guest-test failure left unexplained in M4 was very likely a MAC cookie from
  an earlier run signing the guest in, so the page had no redirect to read: the same failure
  came back on a router not reset first, after this was added. The test now clears them.
- Observation: Prisma queries are lazy thenables, which `expect(...).rejects` does not accept;
  the integration tests await them through a helper.
- Observation: from the Pigfarm session (2026-10-29), for when HashiFi adds BullMQ: BullMQ
  6.5.1 or later; `autoReconnect: false` on producer clients built with
  `createBunRedisClient` (on Bun 1.4.4 they otherwise reconnect without calling `onclose`);
  re-attach listeners in a `duplicate()` wrapper; no unbounded retries. Workers keep
  `autoReconnect` and the offline queue on (so the job loop waits rather than spinning and
  starving SIGTERM), but cannot rely on close events to notice a lost Redis: a bounded periodic
  read (every few seconds, with a timeout) opens an outage window when it fails or hangs and
  closes it when answered; when the window expires the worker exits, with deployment restarts
  capped. A test cuts Redis under a running worker and asserts the outage is reported once.
  And for M7: a CI job
  that runs tests apart from the build must run `prisma generate` first (here `bun install`
  does, through `postinstall`).
- Observation: CHR 7.25 rejects `rate-limit` on a hotspot user; the self-test measures it and
  vouchers fall back to per-package profiles, as designed.
- Observation: Bun 1.4 workspaces install in isolated mode (`node_modules/.bun/`, symlinked per
  app); the earlier `turbopack.root` pin stopped Next.js resolving itself and was removed.
  Next.js finds the root `bun.lock`.
- Observation: the root Django `.gitignore` hid `apps/web/lib/` from the first import commit;
  the commit was amended before publication to include it.
  Evidence: `git check-ignore` against the old `.gitignore` (`lib/`).
- Observation: the vendor READMEs refer to `../CLAUDE.md`, `../AGENT.md`,
  `../ARCHITECTURE.md` and `../TEST.md`, which were not delivered. Their rules that matter
  are restated in AGENTS.md (time zone, phone formats, copy, provisioning).

## Decision Log

- Decision: build from the earlier system; keep its multi-venue model.
  Rationale: [ADR-0001](../../engineering-decisions/0001-start-from-a-working-system.md).
  Date/Author: 2026-10-28 / Paul, Claude
- Decision: Bun, NestJS, Prisma, PostgreSQL 18, Next.js, Biome; newest stable versions pinned.
  Rationale: [ADR-0002](../../engineering-decisions/0002-toolchain.md).
  Date/Author: 2026-10-28 / Paul, Claude
- Decision: the API owns logic and workflows; the portal moves to the web.
  Rationale: [ADR-0003](../../engineering-decisions/0003-api-owns-logic-web-presents.md).
  Date/Author: 2026-10-28 / Paul, Claude
- Decision: two ways in, one mechanism. Self-service mobile-money purchase on the portal is the
  default (M6, with a `customers` table, before the release); printed vouchers sold for cash
  stay supported, for guests who will not use a mobile wallet. Both end in a voucher the router
  confirms. Built in that order: vouchers first, because they prove the router path without a
  payment provider.
  Rationale: the purpose is that nobody has to ask the owner for access, at any hour; cash
  vouchers still remove the connecting and disconnecting of devices.
  Date/Author: 2026-10-28 / Paul; widened 2026-10-29 / Paul (payments selected, then made part of
  the first release)
- Decision: develop against MikroTik CHR (Cloud Hosted Router, free licence, 1 Mbps);
  buy one physical board (an ARM model with built-in WiFi, not a `smips` board) before M8.
  Rationale: a hotspot must sit on the guests' network, so production needs hardware at
  each venue, but everything except a phone joining real WiFi can be proved on CHR.
  Date/Author: 2026-10-28 / Paul, Claude
- Decision: the repository stays private until M5's security fixes land.
  Rationale: the findings above describe exploitable defects; the code is published once
  they are fixed. The earlier code is HashiFi's to change or delete.
  Date/Author: 2026-10-28 / Paul
- Decision: the repository goes public when HashiFi is ready to deploy, not when M5 lands.
  Date/Author: 2026-10-30 / Paul
- Decision: the API alone signs devices in, and the router accepts no login from the network,
  instead of adding CHAP to the router's login. CHAP would leave the router taking guesses, and a
  captured exchange could be brute forced offline; this closes both open findings
  (ADR-0008). HashiFi is unreleased, so workflows are replaced when a better one exists.
  Date/Author: 2026-10-30 / Paul, Claude
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
- Decision: staff sign in with Better Auth inside HashiFi, as in ntumie. and Pigfarm; the shared
  identity service (the earlier decision, 2026-10-28) is deferred until a concrete
  cross-product need. M4 no longer waits on a workspace plan.
  Rationale: [ADR-0007](../../engineering-decisions/0007-sign-in-with-better-auth.md): only a
  handful of staff sign in, who use no other product; Better Auth is already the shared part,
  and keeping its tables apart from `admin_users` keeps the service possible later.
  Date/Author: 2026-10-29 / Paul
- Decision: lint findings in code M3 and M4 replace (Express routes, middleware, `server.ts`,
  the Drizzle layer) are warnings until those milestones remove the code, rather than typed
  now and deleted after. The router portal pages (`apps/api/mikrotik-files/`) are uploaded to
  routers unchanged; Biome does not touch them.
  Rationale: kept code (`services/`, `utils/`, the web) is fixed; the rest is rewritten.
  Date/Author: 2026-10-28 / Claude
- Decision: M3 is the data foundation and the NestJS shell; M4 ports each Express route once.
  M3: Prisma schema and migrations on PostgreSQL 18, the NestJS shell (entrypoint, LogTape and
  Sentry, configuration with `_FILE` secrets, `PrismaService`), the kept services (router
  provisioning, sync, reconciliation, expiry, live monitor, credentials, audit) moved onto Prisma
  as providers, and one serializer layer to `@hashifi/types`. M4: each Express route ported
  straight to a NestJS module and deleted with its Drizzle code. Between them the old Express
  server does not run against a database.
  Rationale: porting the 5.5k lines of route queries to Prisma in M3 and again to NestJS in M4
  would write them twice; nothing is deployed, so the gap costs nothing.
  Date/Author: 2026-10-29 / Claude (advisor review), Paul informed
- Decision: the earlier Express app is removed once M3 replaced its foundation; M4 reads
  each route from commit `45ebd53` rather than from a copy in the tree.
  Rationale: git keeps it permanently; a copy in the tree looked live, kept the security
  scanner re-reporting known defects, and the repository removes replaced code.
  Date/Author: 2026-10-29 / Paul
- Decision: a router's tunnel key pair is allocated once and its private key stored sealed
  (AES-256-GCM), amending ADR-0006's "only the public key is kept".
  Rationale: the bootstrap script is regenerated (it is safe to paste twice); fresh keys each
  time would orphan the key already on the router.
  Date/Author: 2026-10-29 / Claude (advisor review)
- Decision: no uploaded branding. HashiFi's logo and any images ship with the web in
  `apps/web/public/` (`LOGO_SRC`); the portal settings keep wording, colours and voucher
  defaults only, and the earlier logo, background and letter-mark fields are removed.
  Rationale: HashiFi is used as it is, not resold to venues to brand, so upload, storage and
  backup of images would serve nobody. Briefly stored in PostgreSQL before the owner ruled
  that media must not live in the database, and then that the uploads are not needed.
  Date/Author: 2026-10-30 / Paul
- Decision: FSL-1.1-ALv2, Shikome Technology Limited as licensor.
  Rationale: public source without permitting a competing commercial service.
  Date/Author: 2026-10-28 / Paul

## Outcomes & Retrospective

Not started beyond the import and scaffold.

## Context And Orientation

- `apps/api` (at the start): Express 5, Drizzle on MySQL, `ws`, `routeros` (RouterOS API
  client), `sharp` (portal images), `nodemailer` (admin sign-in codes). Entry
  `src/server.ts`; one file per resource in `src/routes/`; `src/services/` holds
  `router-provision/` (bootstrap script, capability probe, per-board dialect, setup steps,
  readiness and verification), `mikrotik.ts`, `router-sync.ts`, `reconcile-daemon.ts`,
  `expiry-daemon.ts` and `live-monitor.ts`. Tests sit beside the code as `*.test.ts`.
  `mikrotik-files/` are the pages uploaded to routers; `mikrotik-knowledge-files/` is the
  seller's router onboarding procedure and reference, worth keeping as runbooks.
- `apps/web` (at the start): Next.js 16 admin with shadcn components; `lib/types.ts` mirrors
  the API's responses.
- **CHR**: MikroTik's RouterOS as a virtual machine image, used here as the router sim.
- **Walled garden**: hosts a hotspot lets unauthenticated guests reach (the portal and API).

## Plan Of Work

### M1 Toolchain and name

Done (see Progress). One root `bun.lock`; Biome replaces Prettier; root scripts from the template made real.
Dependencies moved to the newest stable releases and pinned (check `npm view <pkg>
dist-tags`: Prisma's `latest` is a release candidate at the time of writing, so 7.10.1).
Every "WiFi Billing" and `wifi_billing`/`wifibilling` name becomes HashiFi (UI strings,
cookie and database names, demo addresses, router pages). In the web: remove
`@vercel/analytics`, replace the `next-maps` GitHub dependency, fix the Recharts error and
drop `typescript.ignoreBuildErrors`. `bun run verify` passes, with the 170 existing tests.

### M2 Router sim on CHR

Run CHR locally; apply the bootstrap script and the automated setup to it. Decide, with
evidence, and record as an ADR:

- how the cloud API reaches routers behind NAT (WireGuard opened by the router, the API on
  the encrypted API port through it);
- how the walled garden admits the portal and API by name rather than a changing IP;
- that `routeros` and `sharp` work under Bun.

A script brings the router sim up so the provisioning steps and readiness checks can be run
against it repeatably.

### M3 Prisma on PostgreSQL and the NestJS shell

Done (see Progress). The original scope, kept for reference: port the schema to
`prisma/schema.prisma`: `uuid` keys, `jsonb`,
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

Sign-in first ([ADR-0007](../../engineering-decisions/0007-sign-in-with-better-auth.md)):
Better Auth (newest stable, pinned) with email one-time codes through Resend, sign-up
disabled, its tables (`users`, `sessions`, `accounts`, `verifications`) beside `staff`, which
shares the user's id and holds role, status and venue scope. Team management creates both.
Admins must enroll TOTP with recovery codes; managers may. Rate limits on requesting and
verifying codes, one answer whether or not an email is staff. Then the routes, each behind the
role and venue guard.

The same first migration renames what the earlier names got wrong, folded into the baseline
(nothing is deployed): `admin_users` becomes `staff` (it holds managers too) and
`wifi_customers` becomes `devices`, dropping its unused `username` and `email`. A row there is
one MAC address the network saw, created when a voucher is redeemed: one person can be several
devices, and a phone that randomises its MAC can be a new device at each venue, so it is not a
customer. Sessions, vouchers and payments refer to `deviceId`.

Each Express route, read from commit (`git show
45ebd53:apps/api/src/routes/<name>.ts`), is ported straight to a NestJS module: venues,
routers, packages, vouchers, customers, sessions, analytics, revenue, portal settings, team,
audit. The admin/manager role rule comes from `45ebd53:apps/api/src/middleware/rbac.ts`.
The services, jobs, configuration, secrets, encryption and telemetry already exist (M3):
modules use them. Every query is scoped by role and venue (finding 3). The router module's
bootstrap endpoint allocates the router's tunnel with `TunnelAllocator` and passes it to the
script. The live view (`/ws/live`) becomes a gateway fed by `LiveMonitor.pollOnce`'s
`onUpdate` and the router log (`45ebd53:apps/api/src/services/provision-broadcast.ts`); there
are no portal uploads (see the Decision Log). Analytics groups by `businessDaySql` instead of `CONVERT_TZ`. The API normalises
on write what the schema's CHECKs require, so an admin's typing never becomes a 500: team
member emails to lower-case, voucher batch prefixes and the portal's `voucherPrefix` to
upper-case.
Totals and derived figures the admin pages compute today move into the responses, and the API
enforces every rule the web pre-checks (the package price and throttle rules). The NestJS DTOs
implement `@hashifi/types`, which grows to the whole contract, and `apps/web/lib/types.ts` (the
stale hand-written copy) is deleted; raw `fetch` moves into one client module. `RosRow`
(`Record<string, string | undefined>`) becomes a `null`-returning accessor at the RouterOS
boundary (ADR-0004). Email moves to Resend. The vendor's OTP login, sessions and mailer are not
ported: Better Auth replaces them (ADR-0007), and only the account-event emails the Team page
needs (welcome, suspended, role changed) are rewritten for Resend. HTTP requests get the same wide events the jobs
have (a NestJS interceptor around `withWideEvent`). Snippe
routes and the webhook are left out (backlog). The vendor's onboarding knowledge files move
to `docs/runbooks/`.

### M5 Captive portal in the web, and the security pass

The portal pages move to `apps/web`; the API exposes the portal workflows. `link-login` is
accepted only as an `http(s)` URL whose host is a registered router or hotspot gateway;
`mac` and `ip` are validated; no voucher code is returned for reconnection, which uses the
router's own mechanism (MAC cookie) or a short-lived token tied to the router's request
(findings 1 and 2). Values in scripts are JSON-encoded. A review of every public endpoint
follows, with findings fixed or recorded.

### M6 Mobile-money payments (Snippe) and customers

Selected by the owner, 29 October 2026, who is obtaining the Snippe API: self-service purchase
is the default way in and the reason HashiFi exists, so it ships in the first release rather
than after it. Gate: the portal works (M5) and a Snippe account exists; it needs no physical
router, because the router sim and Snippe's test environment prove it. Guests buy a package on
the portal with mobile money, and a voucher is issued and confirmed by the router before
access is granted. Printed vouchers sold for cash stay a supported path alongside it.

- **`customers`**: the person who pays, identified by a normalised Tanzanian mobile number
  (E.164, `+255…`, unique), with the devices they used and their payments. Created on a first
  payment; the phone number is the only personal data, shown to admins and to managers for
  their venues.
- Ported from `45ebd53`: `routes/snippe-webhook.ts` and `payments.ts`,
  `utils/snippe.ts`, `scripts/reconcile-pending-payments.ts` and the payment half of
  `services/reconcile-daemon.ts`, as a NestJS module and jobs on the M3 foundation.
- Kept from the earlier design: a payment's `router_provisioned_at` is tracked apart from
  `status = paid`, and access waits on it; pending payments are reconciled after the
  authorisation window; the webhook is verified by signature and idempotent per event.
- The API decides payment state; the portal presents it (ADR-0003). Copy never names a
  provider ("mobile money", "mobile number").
- Three sales paths on one mechanism ([PRODUCT.md §4.7](../../../PRODUCT.md#47-selling-access-three-paths-one-mechanism)):
  self-service, with the paying device logged in by its own portal session (the code returned
  to that session once, never to a request keyed by MAC); assisted sales recorded by staff
  against a phone number, the voucher sent or printed; and pre-printed cards recorded as cash
  sales when redeemed, unsold cards as stock.
- Voucher delivery to phones by SMS through BRIQ, the messaging provider chosen as
  cross-product work ([workspace brief](https://github.com/hashikome/workspace/blob/main/backlog/messaging-delivery.md); Pigfarm will use it too). HashiFi depends on a small
  sending interface, not the provider's API, and confirms delivery through BRIQ's signed,
  retried webhooks. **SMS only:** a guest asking for WiFi usually has no data, so WhatsApp and
  email cannot reach them; SMS reaches any phone with signal. The code is always also shown on
  screen where it was bought, with a Copy button: on the paying device's portal session (only
  that session, until the voucher expires) and on the staff sale screen. A failed SMS (the
  provider reports a failure or the confirmation is overdue) is therefore harmless; the screen
  says it was not delivered and to keep the code shown, and contact the venue if both are lost.
- Acceptance: on the router sim, each path gets the guest online and into the venue's figures:
  a payment through Snippe's sandbox logs the paying device in and sends the code; an assisted
  sale sends or prints it; a pre-printed card is counted when redeemed. A replayed or unsigned
  webhook changes nothing; a paid-but-unprovisioned payment is retried and recovers; with SMS
  failing, the paying device still gets online, its screen still shows the code to copy, and
  another session cannot see it.

### M7 Release pipeline and deployment

Dockerfiles, `verify` and `release` workflows copied from ntumie. and adapted; images in
GHCR; the stack's sensitive values as external Docker secrets, the rest in a private env
file, with an optional 1Password `op run` adapter that the application does not depend on; a database and role on the shared PostgreSQL through the infra repository; Dokploy
deployment; Uptime Kuma monitors. The production domain is chosen here.

### M8 Live acceptance on a physical router

A physical MikroTik at Paul's home onboarded through the admin. Both ways in, on a real phone:
a guest buys a package on the portal with a real mobile-money payment and is online without
anyone acting for them; and a printed voucher sold for cash is redeemed. Each browses,
reconnects, and is cut off at expiry.

## Concrete Steps

From the repository root, once M1 lands:

```bash
bun install
bun run verify
```

Expected result: every check passes, including the 170 existing tests.

## Validation And Acceptance

- `bun run verify` passes at the end of every milestone.
- M2: the bootstrap script and automated setup turn a fresh CHR into a passing readiness
  checklist, from the API, through the chosen tunnel.
- M5: regression tests show the auto-reconnect never returns a voucher code, an
  unregistered or non-http `link-login` is refused, a manager cannot read another venue's
  routers or customers, voucher codes come from a CSPRNG, and redemption is rate-limited.
- M8: a real mobile-money purchase and a cash voucher, on a physical router and a real phone.
- M6: as listed in its section, then once with a real mobile-money payment.

## Idempotence And Recovery

The router setup is designed to be re-run safely (tagged configuration). CHR can be reset
by recreating the VM. Nothing is deployed before M7, so schema changes before then start
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
