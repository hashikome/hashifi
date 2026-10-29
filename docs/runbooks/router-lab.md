# Router lab

Use the router lab to run router onboarding, provisioning and verification against real
RouterOS without hardware. It is a MikroTik Cloud Hosted Router (CHR) in QEMU, driven by the
same provisioning code the API runs. It proves everything except a phone joining real WiFi,
which needs a physical board (adoption plan M7).

## Prerequisites

- Linux with KVM (`/dev/kvm` readable and writable by you) and `qemu-system-x86_64`,
  `qemu-img`.
- The CHR image, verified against MikroTik's published checksum, in the git-ignored
  `data/router-lab/`:

  ```bash
  V=7.25   # the current stable: curl -s https://download.mikrotik.com/routeros/NEWESTa7.stable
  mkdir -p data/router-lab && cd data/router-lab
  curl -fLO https://download.mikrotik.com/routeros/$V/chr-$V.img.zip
  curl -fs https://download.mikrotik.com/routeros/$V/chr-$V.img.zip.sha256   # compare:
  sha256sum chr-$V.img.zip
  unzip chr-$V.img.zip
  ```

  Changing the version means updating `ROS_VERSION` in `tooling/router-lab.ts`.

The free CHR licence caps throughput at 1 Mbps, which is irrelevant to the lab.

## Topology

```text
host 127.0.0.1:18728 ──forward──► ether1 ─┐
host 10.0.2.2 ("ISP router")  ◄─────────── ├─ bridgeLocal 10.0.2.15/24 (venue LAN)
                                           │
guest segment (multicast 230.0.0.1:18100) ─ ether2  hotspot 10.5.50.0/24
```

QEMU's user network is the venue LAN, with the host as the ISP router at `10.0.2.2`. The
API, forwarded to `127.0.0.1:18728`, is how the lab reaches the router (its *management
target*). CHR has no radio, so the hotspot runs on `ether2`, a multicast segment that a client
VM can join. During `setup`, the lab serves the portal pages the router fetches on
`127.0.0.1:8080`, which the router reaches as `http://10.0.2.2:8080`.

## Commands

```bash
bun run lab up          # boot (a copy-on-write overlay over the pristine image)
bun run lab bootstrap   # onboarding steps 1-2: reset with no defaults, paste the bootstrap script
bun run lab setup       # step 4: the real setupRouter pipeline (probe, readiness, apply, verify, self-test)
bun run lab verify      # the readiness checks alone
bun run lab console '<RouterOS statement>'
bun run lab reset       # discard the overlay and boot a factory-fresh router
bun run lab down
```

Set `PORTAL_ORIGIN` (for example `PORTAL_ORIGIN=https://handbook.hashikome.com`) to provision
with a host-name portal behind Cloudflare, as production will; without it guests are sent to
the management URL, the purchased LAN design.

`reset`, then `bootstrap` and `setup`, is the full onboarding of a new router. It takes about
a minute and must end with `Setup succeeded.`; a second `setup` must report 0 changes.
`verify` then passes with two expected warnings: no client activity, and the voucher speed
cap applied through a profile (CHR rejects a per-user `rate-limit`).

## Notes

- Lab credentials are generated per router and kept in `data/router-lab/state.json`
  (mode 600, git-ignored).
- The tool types into the serial console as an operator would, so it answers RouterOS's
  first-login prompts (licence, forced password change) and pages long output with space.
  RouterOS's pager `D` writes the rest to a `console-dump.txt` file on the router.
- `setup` and `verify` bypass the database through an in-memory `RouterStore`; the API uses
  `dbRouterStore`.
