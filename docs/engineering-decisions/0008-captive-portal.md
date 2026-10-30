# ADR-0008: How a guest reaches the portal, signs in and comes back

Status: accepted, 30 October 2026, as proved in the router sim. Amends ADR-0006 (decision 3).

## Context

The earlier portal rendered HTML from the API on a shared LAN. It found the venue from the
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
3. **Fragments, not query strings.** The router sends a guest to `/portal/login#router=…`, and a
   printed QR code is `/portal/login#code=…`. A fragment reaches no server or log. A card scanned
   with no router context keeps its code in the tab's `sessionStorage` on this origin and asks the
   guest to join the WiFi and continue. Continuing opens a plain http address, carrying no code,
   which the router intercepts and returns with context. That address is not ours, so the code
   never goes to it.
4. **Only the API signs a device in.** The hotspot has `login-by=mac-cookie` and no http method,
   so the router accepts no code over the network: a direct POST is refused even with the right
   one. The portal sends the code to the API over its own origin, and the API runs
   `/ip hotspot active login` on the management link. The code never crosses the WiFi to the
   router, nothing can guess at the router, and the portal posts nothing from https to http. The
   router's login page does nothing but redirect, and `alogin.html` is gone because no browser
   logs in. Provisioning probes the command and refuses a board without it; verification fails if
   any http method is enabled.
5. **The router confirms the device, before and after.** The browser names its MAC and IP, so the
   API checks them against the router's host table once the code is known to be good, and before
   the voucher's clock starts: a cookie is never planted for a device that is not there. After
   the login it reads the active session back, and only then does the voucher go `active`.
6. **A device comes back by the router's MAC cookie,** so nothing returns a code for a MAC. Every
   package has a router profile whose cookie lasts as long as the package, because the router's
   default is 3 days. On RouterOS 7.25 removing an active session also deletes its cookie, so
   where a device must stay on (a new speed), the live monitor signs it back in itself.
7. **The router's pages hold no code.** They are served in clear over the WiFi, so `status.html`
   does not use `$(username)`, and asks the API for time and data by router and device. A forged
   MAC reads a remaining time and never a code.
8. **Sessions open from what the router reports,** in the live monitor, not at redemption: a
   returning device never passes the portal. The device limit is `voucher_devices`, written under a
   lock on the voucher.
9. **A block is at the router** (`ip-binding type=blocked`), on every router, re-applied by
   `syncRouter`; a portal check alone would not stop a device whose cookie is still valid. After a
   device that sent traffic while blocked is unblocked, the router takes about 50 seconds to
   accept it again.

## Why not CHAP

Protecting the router's login with CHAP was the planned fix for the code crossing the WiFi in
clear. It would leave the router taking guesses, and anyone who captures one exchange could brute
force a roughly 40-bit code offline against MD5. Removing the router's web login closes both.

## Evidence

Router sim (RouterOS 7.25 CHR, a guest VM, the real API on the sim database), on a router set up
by the normal path: `guest-test` passes all 17 steps, including a direct POST with the right code
refused, a device the router cannot see refused with the voucher's clock unstarted, redemption
through the walled garden, a session opened by the monitor, a device kept on after a kick, a
device back by its cookie after 135 seconds away, a cookie lasting as long as its package, a block, and sign-in within 90 seconds of
unblocking. The page was walked on a production build in headless Chrome with the router's redirect
simulated: a scanned card held on this origin and restored after going round, with no code in any
request to the outside address; a wrong code; a proxy answering with a page; online; and on to the
destination.

## What remains open

- **A MAC address is only a claim.** Anyone on the network can copy one, and with it a device's
  cookie: inherent to hotspot networks. Nothing here treats a MAC as proof of anything else.
- **RouterOS 6 is unproven.** The probe decides per board; only 7.25 has been run.
- **A real phone and an https portal are unproved:** the sim serves http and its guest has no
  browser. Check in M8, with the captive sheets of iOS and Android and a scanned card.
