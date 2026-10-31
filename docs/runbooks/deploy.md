# Deployment

Every push to `main` is verified, built into images and deployed, for as long as HashiFi is in
development. To make it manual, replace `push` with `workflow_dispatch` in
`.github/workflows/release.yml`.

Production is `hashifi.hashikome.com`: one host, on the shared Dokploy platform
([infra](https://github.com/hashikome/infra/blob/main/docs/dokploy-release.md)). Traefik sends
`/api/`, `/ws/`, `/webhooks/` and `/portal/hotspot-files/` to `hashifi-api`, and the rest to `web`.

## What a release does

1. `verify.yml`: formatting, lint, types, tests, builds, integration tests.
2. Images to GHCR, named by commit and digest.
3. The shared [`dokploy-release`](https://github.com/hashikome/actions/tree/main/dokploy-release)
   action, only when the repository variable `DEPLOY_ENABLED` is `true`, configured by
   `deploy/release.json`: runs the migration stack, waits for it to exit 0, then updates the
   application stack and waits until every service is healthy on exactly these images. A failed migration leaves the application as
   it was. A revision that has been superseded is refused.

## Preparing production

Once, before setting `DEPLOY_ENABLED`:

- Two Dokploy Stacks, raw source with auto-deploy off: `hashifi-xxxxxx` (`deploy/docker-stack.prod.yml`)
  and `hashifi-release-xxxxxx` (`deploy/docker-stack.migrate.yml`), named in `deploy/release.json`,
  each with the inputs in
  the stack section of `.env.example`.
- A database and roles on the shared PostgreSQL, and the Docker secrets it names.
- DNS: `hashifi.hashikome.com` proxied, and `wg.hashikome.com` DNS-only, since Cloudflare's proxy
  does not carry WireGuard.
- Email sends from `no-reply@notify.hashikome.com` with the shared Hashikome Resend key, as Soko
  does; HashiFi holds it as its own Docker secret.
- In GitHub: an environment `production` with the secret `DOKPLOY_API_KEY`, and the variables
  `DOKPLOY_REGISTRY_ID` and `DEPLOY_ENABLED`.
- Uptime Kuma monitors on `/api/health` and `/portal/login`.

The first admin is added with `bun run staff:add` in the API image.

Mobile money and SMS need nothing here until their providers exist: add `SNIPPE_*` or `BRIQ_*`
and they turn on ([ADR-0010](../engineering-decisions/0010-payments-and-sms.md)).

## The management tunnel

The `hashifi-tunnel` service in the stack (`apps/tunnel`) is the platform's end of the routers' tunnels
([ADR-0006](../engineering-decisions/0006-router-management-tunnel.md)). It runs on the host's
network with `NET_ADMIN`, creates `wg0` at `10.88.0.1` and listens on `wg.hashikome.com:51820`, so the API needs
no capability: its traffic to a router leaves through the host and is masqueraded on `wg0`, and the
router sees the one address it accepts. Every 20 seconds it reads the peer list from
`/api/internal/tunnel-peers`, so adding or deleting a router needs no shell. Routers fetch their
portal pages from `10.88.0.1:8080`, which relays those paths and nothing else.

The host's firewall needs two rules, set once by someone with `sudo`:

- `sudo ufw allow 51820/udp`: without it WireGuard receives nothing, and `wg show` on the service
  reports no handshake and 0 bytes received.
- `sudo ufw allow in on wg0 to 10.88.0.1 port 8080 proto tcp`: without it the tunnel connects and
  the API reaches routers, but routers time out fetching their pages from the relay.
