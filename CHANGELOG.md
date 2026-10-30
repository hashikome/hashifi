# Changelog

## Unreleased

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

- The API runs on NestJS 12 and Bun with Prisma on PostgreSQL 18 (adoption plan M3): a baseline
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
- The purchased Express, Drizzle and MySQL backend is removed; the import commit `45ebd53` keeps
  it for reference while M4 ports its routes.

- HashiFi is built from a purchased hotspot billing system, imported as received under
  `apps/api` and `apps/web` without the seller's database dumps and uploads
  ([ADR-0001](docs/engineering-decisions/0001-adopt-purchased-billing-system.md)).
- Repository structure from the Hashikome product template: product, architecture and
  design documents, decisions, ExecPlans, runbooks and policies. The empty Django skeleton
  is removed; the network architecture reference moved to `docs/design-docs/`.
- Licensed under FSL-1.1-ALv2 (Shikome Technology Limited).
- Bun manages packages: pnpm and npm files removed; packages renamed `@hashifi/api` and
  `@hashifi/web`.
- Toolchain (adoption plan M1): one root `bun.lock` with every dependency on its newest stable
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
