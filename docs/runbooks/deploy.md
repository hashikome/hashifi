# Deployment

Every push to `main` is verified, built into images and deployed, for as long as HashiFi is in
development. To make it manual, replace `push` with `workflow_dispatch` in
`.github/workflows/release.yml`.

Production is `hashifi.hashikome.com`: one host, on the shared Dokploy platform
([infra](https://github.com/hashikome/infra/blob/main/docs/dokploy-release.md)). Traefik sends
`/api/`, `/ws/`, `/webhooks/` and `/portal/hotspot-files/` to `api`, and the rest to `web`.

## What a release does

1. `verify.yml`: formatting, lint, types, tests, builds, integration tests.
2. Images to GHCR, named by commit and digest.
3. `tooling/release.ts`, only when the repository variable `DEPLOY_ENABLED` is `true`: runs the
   migration stack, waits for it to exit 0, then updates the application stack and waits until
   both services are healthy on exactly these images. A failed migration leaves the application as
   it was. A revision that has been superseded is refused.

## Preparing production

Once, before setting `DEPLOY_ENABLED`:

- Two Dokploy Stacks, raw source with auto-deploy off: `hashifi-xxxxxx` (`deploy/docker-stack.prod.yml`)
  and `hashifi-release-xxxxxx` (`deploy/docker-stack.migrate.yml`), each with the inputs in
  `deploy/production.env.example`.
- A database and roles on the shared PostgreSQL, and the Docker secrets that example names.
- A DNS record for `hashifi.hashikome.com`.
- In GitHub: an environment `production` with the secret `DOKPLOY_API_KEY`, and the variables
  `DOKPLOY_APPLICATION`, `DOKPLOY_MIGRATION`, `DOKPLOY_REGISTRY_ID` and `DEPLOY_ENABLED`.
- Uptime Kuma monitors on `/api/health` and `/portal/login`.

The first admin is added with `bun run staff:add` in the API image.

Mobile money and SMS need nothing here until their providers exist: add `SNIPPE_*` or `BRIQ_*`
and they turn on ([ADR-0010](../engineering-decisions/0010-payments-and-sms.md)).

## The management tunnel

Production cannot reach a venue's router until this exists
([ADR-0006](../engineering-decisions/0006-router-management-tunnel.md)). The proposal, not yet built:

WireGuard on the Docker host, on one public UDP port, at `10.88.0.1`. The API needs no capability:
its traffic to `10.88.0.0/16` leaves through the host and is masqueraded on `wg0`, so a router
sees `10.88.0.1`, the one address it accepts. Routers reach the API's pages through a port on that
address alone. A timer on the host pulls the peer list from the API, so adding or deleting a
router needs no shell. This changes the shared server, so it belongs in the infra repository.
