# ADR-0006: Routers are managed through a tunnel they open to the platform

Status: accepted, 29 October 2026, as proved in the router sim; widened the same day with
per-router allocation (decision 4). The production endpoint is not yet provisioned (see What
remains open).

## Context

The purchased system assumed the API shares a LAN with its routers: it connected to each
router's plaintext RouterOS API at the router's LAN address, discovered its own address by
matching the router's subnet, and admitted that one address everywhere. HashiFi's API runs in
the cloud ([network architecture](../design-docs/network-architecture.md)), and venue routers
sit behind an ISP router, often behind carrier-grade NAT, with no inbound port available.

## Options considered

- **Inbound access** (port forwarding, a public IP per venue): unavailable behind CGNAT, and
  exposes the RouterOS API to the internet.
- **A pull model** (routers poll the API and apply what it returns): would replace the
  provisioning, sync and verification code, which pushes over the RouterOS API and is tested.
- **A router-initiated WireGuard tunnel**, with the API pushing through it as before. Built into
  RouterOS 7 (`/interface wireguard`, no extra package on CHR); alternatives such as SSTP or
  ZeroTier add a package or a third party without a benefit for this use.

## Decision

1. **A router-initiated WireGuard tunnel.** The bootstrap script creates the interface, its
   address and the platform peer, with a 25-second keepalive so NAT mappings stay open. The
   API generates the router's key pair (`generateWireguardKeyPair`, cross-checked against
   `wg pubkey`); the private key travels in the pasted script, as the API password does.
2. **The RouterOS API accepts only the platform's tunnel address** (`/ip service set api
   address=<server>/32`). Provisioning connects to the router's tunnel address, its
   *management target* (`managementTarget`).
3. **Management and portal are separate endpoints** (`resolveBackendEndpoints`).
   `ROUTER_MANAGEMENT_URL` is where routers reach the API (the API's tunnel address, an IPv4
   URL): the router's input accept rule, the readiness ping and the portal-page download use
   it. `PORTAL_ORIGIN` is where guests' browsers load the portal, normally a public HTTPS host
   name: the login redirect and the walled garden use it. A host name enters the walled garden
   as `dst-host`, which RouterOS resolves into a pass-through rule per address, so a
   Cloudflare-fronted origin keeps working as its addresses change. The address-only forward
   accept is kept only for an IPv4 portal and removed otherwise.
4. **Each router's tunnel is allocated once** (`TunnelAllocator`): the next free address in
   the tunnel network (its first host is the platform), and a key pair whose private key is
   stored sealed (AES-256-GCM). The bootstrap script can be regenerated, and is safe to paste
   twice; generating fresh keys each time would orphan the key already on the router.
   Concurrent allocations queue on a PostgreSQL transaction lock; the unique index on the
   address remains the guarantee. The script is generated for a saved router
   (`POST /api/routers/:id/bootstrap-script`), which allocates the tunnel on first use; the
   platform side comes from `TUNNEL_NETWORK`, `TUNNEL_PLATFORM_PUBLIC_KEY` and
   `TUNNEL_ENDPOINT`, set together or not at all, and configuration refuses a
   `ROUTER_MANAGEMENT_URL` other than the network's first host, since routers accept the API
   from that address only.
5. **Deleting a router frees its tunnel address** for the next router. This is safe only
   because the platform admits a peer by its public key: removing a router must remove its
   peer, so the physical router cannot use the address once it is reassigned.

## Evidence

Router sim (RouterOS 7.25 CHR behind QEMU's outbound-only user network,
[runbook](../runbooks/router-sim.md)): a factory-fresh router bootstrapped with the tunnel
handshakes with the hub unaided; the direct API path is closed (`available-from 10.88.0.1/32`);
setup applies and verifies 14 changes over the tunnel alone; after the hub restarts the router
re-establishes the tunnel within about 45 seconds; a router switched between an IPv4 portal and
`https://handbook.hashikome.com` re-provisions and verifies in both directions.

## What remains open

- **The production endpoint.** A public UDP port on the platform, and how the API's container
  routes to the tunnel subnet under Docker Swarm (a capability such as `NET_ADMIN`, host
  networking, or a userspace WireGuard sidecar). Cloudflare's proxy does not carry WireGuard.
  This is shared-platform work owned by the infra repository; a tunnel concentrator may serve
  other products.
- **Peer registration.** The platform must add a router's public key as a peer (allowed IP:
  its tunnel address) when the tunnel is allocated, and remove it when the router is deleted
  (decision 5). Infra-owned, with the endpoint.
- **Long router operations behind the proxy.** Setup takes about 17 seconds on the sim and
  completes over HTTP (a 25-second request was checked on Bun), but Cloudflare ends a proxied
  request at 100 seconds. If a real board approaches that, setup becomes a job whose progress
  the live view streams.
- **A physical board.** WireGuard is in RouterOS 7's main package; confirm on the board bought
  for M8.
- **The IP binding** (`ip-binding-backend`) bypasses the hotspot for the management address,
  which matters only if the API sits on the guest network; to be removed once confirmed with a
  guest client.
