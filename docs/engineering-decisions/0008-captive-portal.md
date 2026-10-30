# ADR-0008: How a guest reaches the portal, signs in and comes back

Status: accepted, 30 October 2026, as proved in the router sim. Amends ADR-0006 (decision 3).

## Context

The purchased portal rendered HTML from the API on a shared LAN. It found the venue from the
host in `link-login`, returned a voucher code to anyone naming an active device's MAC address so
a device could reconnect, and took everything in the query string. In the cloud design none of
that holds: routers on the default network share one gateway address, the portal is HTTPS while
the router is HTTP, and query strings reach proxy logs.

## Decision

1. **One origin before login.** The walled garden admits one host, the portal origin. A guest's
   browser reaches the API on it, at `/api/guest/*`: the web proxies those paths (`rewrites` in
   `next.config.mjs`). The proxy must be in `TRUSTED_PROXIES`, or every guest shares one address
   in the attempt limits. A guest's page loads no third-party asset.
2. **The router names itself.** `login.html` is rendered per router and carries its id, served
   at `/portal/hotspot-files/:routerId/:name`. A gateway address cannot identify a router.
   Redemption then checks `link-login` against that router and builds the login URL itself, and
   refuses another venue's voucher before its clock starts.
3. **Fragments, not query strings.** The router sends a guest to `/portal/login#router=…`, and a
   printed QR code is `/portal/login#code=…`. A fragment reaches no server or log. A card scanned
   with no router context keeps its code in the tab and opens a plain http address, which the
   router intercepts and returns with context.
4. **The router's own page signs in.** The portal sends the browser to the router's `/login` with
   the code in the fragment, and `login.html` posts it from its own http origin, so an HTTPS page
   never posts a form to HTTP.
5. **A device comes back by the router's MAC cookie** (`login-by=http-pap,mac-cookie`), so
   nothing returns a code for a MAC. On RouterOS 7.25 removing an active session also deletes its
   cookie, so where a device must stay on (a new speed), the live monitor signs it back in itself
   with `/ip hotspot active login`, sending the device nothing.
6. **Sessions open from what the router reports,** in the live monitor, not at redemption: only the
   router knows a device is online, and a returning device never passes the portal. The device
   limit is `voucher_devices`, written under a lock on the voucher.
7. **A block is at the router** (`ip-binding type=blocked`), on every router, re-applied by
   `syncRouter`; a portal check alone would not stop a direct login. After a device that sent traffic
   while blocked is unblocked, the router takes about 50 seconds to accept it again.

## Evidence

Router sim (RouterOS 7.25 CHR, a guest VM, the real API on the sim database): `guest-test` passes
all 14 steps, including redemption through the walled garden, a session opened by the monitor, a
device kept on after a kick, a device back by its cookie after 135 seconds away, a block, and
sign-in 48 seconds after unblocking. The page and the router page's handoff were checked in
headless Chrome, with a hostile `link-orig` left inert.

## What remains open

- **The code crosses open WiFi in clear** to the router (`http-pap`). CHAP would hash it, and
  needs MD5 in `login.html`. Before a venue goes live.
- **The router accepts guesses directly,** with no attempt limit. Code length is the wall.
- **A MAC address is only a claim.** Anyone on the network can copy one, and with it a device's
  cookie: inherent to hotspot networks. Nothing here treats a MAC as proof of anything but that.
- **An HTTPS portal** is unproved: the sim serves http. Check on a real phone in M8, with the
  captive sheets of iOS and Android, which may also not share the tab's storage in decision 3.
