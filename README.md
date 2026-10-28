# HashiFi 🔥📶
_“WiFi by the bonfire” — Secure, smart, shared access._

**HashiFi** manages **time-bound, device-limited WiFi access** sold as vouchers through a
captive portal. It is for anyone who shares an internet connection and wants control without
changing passwords by hand: a home, and venues such as hotels, coworking spaces, shops and
shared compounds, each with its own routers, packages and branding.

It started with a personal problem: people asking to use the WiFi, which meant enabling and
disabling access and tracking MAC addresses by hand, sometimes late at night.

> **Status:** in development. HashiFi is being built from a purchased hotspot billing system
> (Express, MySQL and a Next.js admin), now being ported to the Hashikome stack. The plan is
> [docs/exec-plans/active/adopt-purchased-billing-system.md](docs/exec-plans/active/adopt-purchased-billing-system.md).
> Until the Prisma port (M3), running the API locally needs MySQL 8.

## How it works

```text
Internet / SIM / fibre
        ↓
ISP router (uplink only)
        ↓
HashiFi-managed MikroTik (hotspot, firewall, sessions)
        ↓
Guest WiFi → captive portal → voucher → online for the package's time and devices
```

The ISP router stays an uplink. A MikroTik router behind it enforces access, and the cloud
backend sells packages, issues vouchers, configures each router and tracks sessions. See
[docs/design-docs/network-architecture.md](docs/design-docs/network-architecture.md).

## Features

- Venues, each with routers, packages and a branded captive portal
- Packages by duration, speed, data and device limits
- Vouchers generated in batches, printable with QR codes
- Router onboarding: a generated bootstrap script, then automated, verifiable setup
- Live sessions, automatic expiry, analytics and revenue
- Admin and manager roles, with an audit log

Mobile-money payments are planned after vouchers.

## Development

Requirements: [Bun](https://bun.sh) and Docker (for local PostgreSQL).

```bash
bun install
cp apps/api/.env.example apps/api/.env          # then fill it in
cp apps/web/.env.example apps/web/.env.local
bun run db:migrate
bun run dev
```

`bun run verify` runs every check CI runs.

## Layout

```
apps/api     NestJS API on Bun, Prisma and PostgreSQL
apps/web     Next.js admin and captive portal
packages/types  the API's JSON contract, shared by the API and the web
docs/        design documents, decisions, plans and runbooks (start at docs/README.md)
```

## Licence

[Functional Source License 1.1, Apache 2.0 future licence](LICENSE.md) (FSL-1.1-ALv2). You may
use, modify and redistribute HashiFi for any purpose except offering a competing commercial
product or service; each release becomes available under the Apache License 2.0 two years
after it is published.

Developed and maintained by **Shikome Technology Limited** ([@hashikome](https://github.com/hashikome)),
a Tanzania-registered technology company.
