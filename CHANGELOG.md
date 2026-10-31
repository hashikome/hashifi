# Changelog

## Unreleased

- Errors and wide events reach Sentry in production, each marked with its release.
- One `.env.example` at the repository root replaces the API's and the deployment's, and an empty
  secret file now stops the start.
- The credentials standard: HashiFi starts from its own env values and Docker secrets alone, and
  no document names a password manager.
- The management tunnel: a `tunnel` service runs the platform's end of the routers' WireGuard
  tunnels, keeps its peers in step with the API, and relays the pages routers fetch during setup.
- Release pipeline: images, Docker stacks and CI, with every push to `main` deploying once
  production is prepared. Production is `hashifi.hashikome.com`.
- HashiFi launches on printed vouchers. Mobile money, assisted sales and SMS turn on when their
  providers' credentials are set; until then guests see the voucher form and a price list.
- Fixed: printed QR codes pointed at the API, which has no portal page, and printed cards told
  the holder to ask for a voucher.
- Guests buy WiFi on the portal with mobile money: they approve on their phone, the voucher is
  issued, the router confirms it and the device goes online. The code is on their screen and sent
  by SMS. Staff record assisted sales, and Payments shows who paid and who is owed access.
- Fixed: two guests loading a portal at the same moment could crash its settings lookup.
- Each venue has its own brand: name, logo, background, colours and wording, on its portal and
  printed vouchers, with HashiFi as the default. Images live in Cloudflare R2, and on disk in
  development. Portal Pages previews the real guest page.
- `bun run router-sim demo` runs the whole system to use in a browser.
- Design foundations in `DESIGN.md`: one provisional teal ladder, self-hosted Figtree on every page, flat surfaces and a
  sidebar on the page ground, across the admin, the guest portal and the router's pages.
- The captive portal is a web page at `/portal/login`: a guest enters a voucher and is online,
  through the API, with the router confirming before anything reports success. A device
  comes back by the router's MAC cookie, a block holds at the router, and sessions open from what
  the router reports.
- Guests are signed in by the API, and the router accepts no login from the network: a voucher
  code never crosses the WiFi to the router, and nothing can guess at it. A device must be seen
  by the router before a voucher starts, and a voucher goes active only once the router reports
  that device online.
- Fixed: the portal returned a voucher code to anyone naming a device's MAC address, trusted a
  `link-login` from the request, and put codes in URLs; a voucher could start its clock at
  another venue's router; the router's pages placed a guest's URL unescaped in a script.

- The admin web runs on the new API: staff sign in with an email code and, for admins, an
  authenticator app set up on a new page. Adding a router now saves it first, then gives its
  script. Payments is removed from the admin until payments arrive (M6).
- Fixed: saving a venue could have unassigned its manager, and editing a package would have
  reactivated it and reset its device limit.

- The live view through the NestJS API: routers' connected guests and provisioning transcripts
  pushed to signed-in staff, each manager seeing their own venues.
- Fixed: the live socket accepted anyone and sent them every venue's guests and every
  provisioning run.

- Team and audit through the NestJS API: admins add, change, suspend and remove staff and reset
  a lost authenticator app; managers may run several venues; HashiFi always keeps an active
  admin, even when two admins act on each other at once; everyone affected is emailed.

- Portal settings through the NestJS API: wording, colours and voucher defaults, with the API's
  defaults until saved, validated field by field. No uploaded branding: HashiFi's logo ships
  with the web (`apps/web/public/logo.svg`) and appears on the portal and printed vouchers.

- Analytics and revenue through the NestJS API, with one definition of revenue and every
  figure by the Dar es Salaam business day and month. Managers see their venues' usage only.
- Fixed: revenue counted vouchers that never worked, months followed the server's clock,
  revenue on days without sessions was dropped, and managers saw every venue's package and
  device shares.

- Devices and sessions through the NestJS API: managers see guests' devices and sessions only
  as their venues saw them; admins block, unblock and forget devices; managers end sessions at
  their venues. Blocking ends a device's sessions everywhere.
- Fixed: managers could list every venue's guests and their usage.

- Vouchers through the NestJS API: batches for a package the venue sells, with codes from a
  cryptographic generator; managers make and print their own venues' vouchers; admins revoke
  unused ones, which stay on record. Printing is by batch or voucher id.
- Fixed: voucher codes came from `Math.random` and could be guessed; printing put codes in the
  URL; every batch overwrote the portal's voucher prefix; deleting vouchers removed sales
  records.

- Packages through the NestJS API: admins manage one catalogue and choose what each venue
  sells; managers read what is on sale. The API enforces the price and throttle rules the form
  pre-checked, refuses throttle settings the router would ignore, and keeps packages that
  vouchers still use.

- Routers through the NestJS API: managers see their venues' routers and backlog; admins add,
  replace, delete, sync, probe, verify, set up and provision them. The bootstrap script is
  generated for a saved router and opens its management tunnel when one is configured, with
  one API password and key however often it is generated. No response carries a credential
  but the script. Venue updates are `PUT`.
- Fixed: the provisioning backlog counted every venue for managers; a connection test could
  send a router's stored password to any address typed into the form.

- Venues through the NestJS API: managers see only the venues they operate (another's is not
  found), admins manage them, every change is audited, and a venue with routers cannot be
  deleted. Every error has one shape (`code`, `message`, `details`); every request is a wide
  event, refusals included; signed-in writes from other sites are refused.
- Fixed: many routers onboarding at once could fail to get a tunnel address.

- Staff sign in with an email code through Better Auth; admins must also use an authenticator
  app, asked for at every sign-in. No sign-up (`bun run staff:add` adds people); one answer
  whether or not an email is staff; rate limits per client address and per person; codes
  stored keyed; every route requires active staff unless declared public. Email through
  Resend, or an outbox directory in development.
- Schema: `staff` (renamed from `admin_users`) holds role, status and venue scope beside
  Better Auth's tables; guests' devices are `devices` (renamed from `wifi_customers`).

- The API runs on NestJS 12 and Bun with Prisma on PostgreSQL 18 (build plan M3): a baseline
  migration with UUIDv7 keys, `timestamptz` and `CHECK` constraints keeping voucher codes
  upper-case (RouterOS compares them case-sensitively); validated configuration with Docker
  secrets; health and readiness endpoints; background jobs as LogTape and Sentry wide events,
  with voucher codes, credentials and personal data redacted.
- Router provisioning, sync, expiry, reconciliation and the live monitor run on Prisma; router
  secrets are sealed with AES-256-GCM; each router can be allocated a management tunnel once.
- Fixed: an expired voucher still waiting on router confirmation stayed `pending_activation`
  forever; it now expires. Voucher codes no longer appear in logs or audit records.
- The router sim provisions through the real database store and sells vouchers through
  `RouterSync`, in LAN and tunnel modes.
- The Express, Drizzle and MySQL backend is removed.

- HashiFi starts from a working hotspot system under `apps/api` and `apps/web`
  ([ADR-0001](docs/engineering-decisions/0001-start-from-a-working-system.md)).
- Repository structure from the Hashikome product template: product, architecture and
  design documents, decisions, ExecPlans, runbooks and policies. The empty Django skeleton
  is removed; the network architecture reference moved to `docs/design-docs/`.
- Licensed under FSL-1.1-ALv2 (Shikome Technology Limited).
- Bun manages packages: pnpm and npm files removed; packages renamed `@hashifi/api` and
  `@hashifi/web`.
- Toolchain (build plan M1): one root `bun.lock` with every dependency on its newest stable
  release, pinned (Bun 1.4.4, Next.js 16.4.3, React 19.3.1, TypeScript 7.0.2); Biome formats and
  lints; `bun run verify` runs format, lint, typecheck, the 170 tests and the web build. Type
  errors now fail the web build.
- `@hashifi/types` carries the API's JSON contract for packages, vouchers and portal settings;
  no `any`, `undefined` fields or non-null assertions in the web or the kept API services
  ([ADR-0004](docs/engineering-decisions/0004-types-without-any-or-undefined.md)).
- Fixed: printing vouchers without saved portal settings crashed; a manager whose role loaded
  late lost the preselected venue on voucher creation; the voucher preview showed the price with
  decimals.
- Removed what HashiFi does not use: the starter dashboard and its sample data, unused UI
  components and assets, 30 unused dependencies, Vercel Analytics.
- Named HashiFi throughout (interface, emails, router pages, cookie and storage keys); demo
  accounts use `example.com`. The API refuses to start without `ENCRYPTION_KEY`.
- Decided: email through Resend, BullMQ on Redis for queues, and sign-in from the shared
  Hashikome identity service; on 29 October replaced by sign-in with Better Auth inside HashiFi
  ([ADR-0007](docs/engineering-decisions/0007-sign-in-with-better-auth.md)).
