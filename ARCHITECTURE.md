# Architecture

The stable system map. Evolving detail belongs in [docs/design-docs/](docs/design-docs/README.md).
This describes the **target** being built by the
[adoption plan](docs/exec-plans/active/adopt-purchased-billing-system.md); until it lands,
`apps/api` is the purchased Express application.

## Purpose

Grant WiFi access only as a paid or issued voucher allows, enforced by the venue's router,
with a cloud backend that is the single authority for venues, packages, vouchers and
sessions.

## System shape

```text
guest phone ── venue WiFi ── MikroTik hotspot ──► ISP router ──► internet
                                  │   ▲
           portal redirect        │   │ RouterOS API over a router-initiated tunnel
                                  ▼   │
admin browser ──► apps/web (Next.js: admin + captive portal)
                         │
                         ▼
                  apps/api (NestJS on Bun) ──► PostgreSQL 18 (shared platform)
```

- The MikroTik intercepts unauthenticated guests and redirects them to the portal; the
  walled garden lets the portal and API through before login.
- The API reaches each router over a tunnel the router opens to the platform, because routers
  sit behind NAT. The tunnel design is [ADR-0006](docs/engineering-decisions/0006-router-management-tunnel.md).

## Codemap

| Path | Responsibility |
| --- | --- |
| `apps/api` | NestJS API: business rules, authorization, router provisioning and sync, background jobs, persistence (Prisma) |
| `apps/web` | Next.js: the admin interface and the captive portal pages |
| `docs/` | Design documents, decisions, plans and runbooks |

## Dependency rules

- The web reaches data only through the API; it never imports Prisma or API internals.
- Only the API talks to routers.
- Router-specific behaviour lives in the provisioning dialect, nowhere else.

## Runtime

- One API service with background jobs: voucher expiry and reconciliation of anything the
  router has not confirmed.
- Live session and provisioning updates reach the admin over a WebSocket.

## Deployment shape

GitHub CI verifies, builds and pushes immutable images to GHCR; Dokploy deploys them in
Docker Swarm stack mode. The server never builds application images. PostgreSQL is a
database on the shared platform instance, allocated by the infra repository.

## Invariants

- The API owns business logic and workflows; the web presents
  ([ADR-0003](docs/engineering-decisions/0003-api-owns-logic-web-presents.md)).
- Access is reported only after the router confirms it.
- A voucher code is never returned to a client that has not proved it holds it.
