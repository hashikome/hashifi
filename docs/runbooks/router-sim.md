# Router sim

Use the router sim to run router onboarding, provisioning and verification against real
RouterOS without hardware. It is a MikroTik Cloud Hosted Router (CHR) in QEMU, driven by the
same provisioning code the API runs. It proves everything except a phone joining real WiFi,
which needs a physical board (adoption plan M8).

## Prerequisites

- Linux with KVM (`/dev/kvm` readable and writable by you) and `qemu-system-x86_64`,
  `qemu-img`.
- The CHR image, verified against MikroTik's published checksum, in the git-ignored
  `data/router-sim/`:

  ```bash
  V=7.25   # the current stable: curl -s https://download.mikrotik.com/routeros/NEWESTa7.stable
  mkdir -p data/router-sim && cd data/router-sim
  curl -fLO https://download.mikrotik.com/routeros/$V/chr-$V.img.zip
  curl -fs https://download.mikrotik.com/routeros/$V/chr-$V.img.zip.sha256   # compare:
  sha256sum chr-$V.img.zip
  unzip chr-$V.img.zip
  ```

  Changing the version means updating `ROS_VERSION` in `tooling/router-sim.ts`.

The free CHR licence caps throughput at 1 Mbps, which is irrelevant to the sim.

## Topology

```text
host 127.0.0.1:18728 ──forward──► ether1 ─┐
host 10.0.2.2 ("ISP router")  ◄─────────── ├─ bridgeLocal 10.0.2.15/24 (venue LAN)
                                           │
guest VM ── UDP link 127.0.0.1:18100-18101 ── ether2  hotspot 10.5.50.0/24
```

QEMU's user network is the venue LAN, with the host as the ISP router at `10.0.2.2`. The
API, forwarded to `127.0.0.1:18728`, is how the sim reaches the router (its *management
target*). CHR has no radio, so the hotspot runs on `ether2`, a point-to-point UDP link to the guest VM
(not multicast, which a host VPN such as Cloudflare WARP can swallow). During `setup`, the sim serves the portal pages the router fetches on
`127.0.0.1:8080`, which the router reaches as `http://10.0.2.2:8080`.

## Commands

```bash
bun run router-sim up          # boot (a copy-on-write overlay over the pristine image)
bun run router-sim bootstrap   # onboarding steps 1-2: reset with no defaults, paste the bootstrap script
bun run router-sim setup       # step 4: the real setupRouter pipeline (probe, readiness, apply, verify, self-test)
bun run router-sim verify      # the readiness checks alone
bun run router-sim console '<RouterOS statement>'
bun run router-sim reset       # discard the overlay and boot a factory-fresh router
bun run router-sim down
```

Set `PORTAL_ORIGIN` (for example `PORTAL_ORIGIN=https://handbook.hashikome.com`) to provision
with a host-name portal behind Cloudflare, as production will; without it guests are sent to
the management URL, the purchased LAN design.

`reset`, then `bootstrap` and `setup`, is the full onboarding of a new router. It takes about
a minute and must end with `Setup succeeded.`; a second `setup` must report 0 changes.
`verify` then passes with two expected warnings: no client activity, and the voucher speed
cap applied through a profile (CHR rejects a per-user `rate-limit`).

## Guest

A guest VM stands in for a phone on the hotspot: Alpine Linux's `virt` ISO booted live, with
nothing installed, on the other end of the router's `ether2` link.

```bash
cd data/router-sim
curl -fLO https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86_64/alpine-virt-3.24.3-x86_64.iso
curl -fs https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/latest-releases.yaml \
  | grep -A8 'flavor: alpine-virt'      # compare its sha256 with:
sha256sum alpine-virt-3.24.3-x86_64.iso
cd ../..
bun run router-sim guest          # boot it (about 25 s); `guest down` stops it
bun run router-sim guest-test     # about 90 s, most of it waiting for the voucher to expire
```

`guest-test` walks a guest's whole path and must pass every step: an address from the hotspot;
an unauthenticated page request redirected to the portal origin; with an HTTPS portal, the
portal host reachable before login (the walled garden) while other HTTPS sites stay blocked; a
1-minute voucher created by the API's own code and confirmed by the router; the internet open
after logging in with it; and the guest cut off again at expiry. Run it after `setup`, with or
without `PORTAL_ORIGIN`. `bun run router-sim voucher [minutes]` creates a voucher on its own.

The guest's checks look at what really answered, not at whether a connection opened: the
hotspot redirects unauthenticated port 80 and 443 connections to the router itself, so a bare
TCP connect "succeeds" to any host.

## Management tunnel

```bash
bun run router-sim reset && bun run router-sim bootstrap --tunnel   # the bootstrap brings up WireGuard
bun run router-sim hub up                                    # the platform side, in a container
bun run router-sim tunnel-status                             # expect a recent handshake
bun run router-sim setup && bun run router-sim verify               # over the tunnel alone
bun run router-sim hub restart                               # the router must reconnect unaided
bun run router-sim hub down
```

The hub (`tooling/router-sim-hub/Dockerfile`, built once with
`docker build -t hashifi-router-sim-hub:1 tooling/router-sim-hub`) runs WireGuard in its own network
namespace with `NET_ADMIN`, published on `127.0.0.1:51820/udp`, which the router reaches as
`10.0.2.2:51820`. With a tunnel, `setup` and `verify` run inside the hub, as your user, because
only the hub is on the platform side; the router's API accepts only `10.88.0.1`. Creating the
interface loads the host kernel's `wireguard` module if it is not already loaded.

## Notes

- Sim credentials are generated per router and kept in `data/router-sim/state.json`
  (mode 600, git-ignored).
- The tool types into the serial console as an operator would, so it answers RouterOS's
  first-login prompts (licence, forced password change) and pages long output with space.
  RouterOS's pager `D` writes the rest to a `console-dump.txt` file on the router.
- `setup` and `verify` bypass the database through an in-memory `RouterStore`; the API uses
  `dbRouterStore`.
