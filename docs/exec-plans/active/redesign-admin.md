# Rebuild the admin and captive portal in the Hearth design

This ExecPlan is a living document. Maintain it according to `PLANS.md`. Keep `Progress`,
`Surprises & Discoveries`, `Decision Log` and `Outcomes & Retrospective` current as work
proceeds.

## Purpose / Big Picture

Every person who signs in sees a screen built for their job, in Hashikome's bonfire brand. An owner
opens the overview and knows in five seconds whether everything is all right and what needs them;
trends live on Analytics. A guest on a cheap phone sees the venue's name and logo, a welcome, one
field and one button. The look is Hearth: mist ground, white panels, midnight ink, ember on the one
action and on live data, Figtree, and the open ring with the ember in its gap.

Observable result: Neema, owner of three venues, sees "Neema Hospitality" at the head of the
sidebar, filters to one venue at the top, switches workspace from the account menu at the foot,
reads today's takings against the same hour last week, and opens Analytics for the week. Musa, an
operator, sees only his venue's day. A guest at Mama Neema Lodge sees the lodge's portal under the
business's logo. design-audit reports no P0 or P1 at 1280 and 375 pixels, light and dark.

The roles and scopes come from [ADR-0011](../../engineering-decisions/0011-platform-and-business-scopes.md)
and are built by [business-scopes.md](business-scopes.md); branding from
[ADR-0009](../../engineering-decisions/0009-venue-branding.md).

## Progress

- [x] (2026-11-01) Audit of the admin (16/40), with findings recorded below.
- [x] (2026-11-01) Setup runs in the background with progress stored on the router; the router page
  holds the journey; the venue form is cut to what is used.
- [x] (2026-11-03) Production test with CHR: a guest VM redeemed a voucher, was let through, and
  showed in Live Sessions.
- [x] (2026-11-03) Design rounds: ten variations, then Hearth with Night Band's portal, then each
  role's view; chosen by the owner.
- [ ] H1: tokens, the mark and `DESIGN.md` in Hearth.
- [ ] H2: the shell: grouped navigation from capabilities, scope filter, account menu, business head.
- [ ] H3: the overview as "right now", and the Analytics page, both computed by the API.
- [ ] H4: lists and forms that work on a phone; named actions; the router edit form.
- [ ] H5: the captive portal: night top over a white sheet, the logo fallback, the welcome.
- [ ] H6: the business screens: Team, Packages with CSV import, Business profile, Add a business,
  Default packages.
- [ ] H7: design-audit on the result, findings fixed; `DESIGN.md`, runbooks and CHANGELOG current.

## Surprises & Discoveries

- Observation: every Set up router and Check it's serving click failed, and only a toast said so.
  Evidence: three 400s in 7-23ms in the production logs; `parseInput` turned an absent flag into `{}`.
- Observation: a reset router has no DNS, so a tunnel to a host name never connected.
  Evidence: `failure: dns server failure` on CHR; fixed in `aec19d9`.
- Observation: Cloudflare adds a bot-detection script and a hidden link to any text/html it serves,
  so a router's portal page arrived about 1.1 KB larger than rendered and setup refused it.
  Evidence: 8,057 bytes rendered, 9,171 on the router; `__CF$cv$params` in the body. Guests' pages on
  `hashifi.hashikome.com` get the same treatment, which the walled garden must be checked against.
- Observation: seven venue fields are read only by the form and its serializer.
  Evidence: road, street, ward, district, postal code, latitude and longitude, by search of the code.

- Observation: after a host reboot, `router-sim guest-run` hangs. The guest's shell asks the terminal
  for its cursor position and waits, and a freshly booted guest has `eth0` down.
  Evidence: `ESC[6n` on the console; DHCP answered once `ip link set eth0 up` ran.

## Decision Log

- Decision (replaced on 2026-11-03 by the Hearth direction below): keep `accent-ladder`, teal and
  Figtree.
  Rationale then: `DESIGN.md` committed to it, and the audit's problems were structural.
  Date/Author: 2026-11-01 / Claude
- Decision: setup runs in the background, and its state lives on the router row.
  Rationale: Cloudflare ends a request at about 100 seconds, and a result held in a dialog is lost
  on refresh. The API owns the workflow (ADR-0003), so the page only reads it.
  Date/Author: 2026-11-01 / Claude
- Decision: a venue is a name, one location, its allowed sites and a status.
  Rationale: nothing else was used; a town and an address are the same answer to "where". Production
  held only test data, so dropping the columns discarded nothing of value.
  Date/Author: 2026-11-01 and 2026-11-03 / Paul
- Decision: the journey has three stages: connect, set up, serving.
  Rationale: they are what an owner does; the six internal phases show only as progress within
  Set up.
  Date/Author: 2026-11-01 / Claude

- Decision: the Hearth direction: mist ground, white panels, midnight ink, ember on the one action
  and live data, Figtree, the open ring with the ember in its gap; the captive portal's night top
  over a white sheet; a vertical, grouped navigation with a scope filter at the top and the account
  menu, holding the workspaces, at the foot.
  Rationale: chosen by the owner from ten variations and two further rounds (3 November 2026).
  Date/Author: 2026-11-03 / Paul
- Decision: the overview shows what is happening now and what needs attention; trends move to a
  new Analytics page.
  Rationale: the overview was doing the glance and the analysis at once, and repeated Live sessions.
  Date/Author: 2026-11-03 / Paul and Claude

## Outcomes & Retrospective

Not started for H1 to H7.

## Context And Orientation

- `apps/web/app/globals.css`: the tokens (teal today); `DESIGN.md` documents them.
- `apps/web/app/(staff)/admin/`: the admin routes; `components/admin-sidebar.tsx` the navigation.
- `apps/web/app/(portal)` and `components/portal-view.tsx`: the captive portal and its preview.
- `apps/web/public/logo.svg`: the mark; `portal_settings` holds the portal's default brand.
- `apps/api/src/analytics/`: today's figures; the comparisons and ranges of H3 are new.
- Design reference: the owner's three private review pages (round 1: ten variations; round 2: Hearth
  with Night Band's portal; round 3: each role). Generated sample data adds up on every page.

## Plan Of Work

**H1, tokens and mark.** Light: ground `#F4F6F8`, panels `#FFFFFF`, tone step `#EDF0F3`, ink
midnight `#0D1B2A`, muted `#4E5D6E`, borders `#DFE3E8`, primary ember `#F59E2A` with midnight text,
data ember, ember as text `#A9530A`; problems in red, never ember. Dark: midnight ground, panels
`#132538`, ink `#EEF1F4`, ember text `#F6AE52`. The mark: an open ring with the ember in its gap
(`public/logo.svg`, favicon, router pages). Portal defaults in `portal_settings`: midnight and ember.
`DESIGN.md` rewritten for Hearth, recording the deliberate exception that the dark theme is midnight,
not neutral. Every existing screen takes the new tokens; nothing else changes yet.

**H2, shell.** The sidebar in groups (unlabelled: Overview, Live sessions, Analytics; then Selling,
Places, Guests, Business), rendered from the API's capabilities, never from role names. At the top,
the business's logo and name (HashiFi with the Platform tag for platform staff) and the scope filter
(all businesses or one; all venues or one; absent with one venue). At the foot, the account menu:
name and role, the workspaces, Account and security, Sign out, and "Runs on HashiFi". Below 768px a
48px bar and a sheet. Needs business-scopes M2.

**H3, overview and Analytics.** `GET /api/overview` returns what needs attention, the figures with
the same hour a week earlier, each venue today, and devices online today with last week's line;
`GET /api/analytics?range=` returns takings per day, by venue with shares, the package mix and the
busiest hours. The web renders both; the one-venue owner's and the operator's overviews come from
the same endpoint by capability. Lines, never bars, for time.

**H4, phones and forms.** Under 768px every table becomes stacked rows; the packages icon row and
the voucher buttons get names; the router edit form in plain words; the router page shows its model
and RouterOS version after setup.

**H5, captive portal.** The night top with the logo, venue name and place, over a white sheet with
the welcome ("Karibu. Pull up a seat."), the code field and the button; the packages below. Logo:
the venue's, else the business's, else HashiFi's. The router's pages stay byte-exact, and the walled
garden is checked against the script Cloudflare injects into guests' pages.

**H6, business screens.** Team (invite a manager or an operator to chosen venues; managers invite
operators), Packages (the defaults, venue-only packages, CSV import with a preview), Business
profile (name, logo, each venue's portal), and for platform staff Add a business and Default
packages. Needs business-scopes M3 to M5.

**H7, audit.** design-audit `critique` and `audit` at 1280 and 375, light and dark, with real seed
data; no P0 or P1 left. Then the docs, and the plan folded away.

## Order across plans

1. H1 (no schema change; can ship at once).
2. business-scopes M1 and M2.
3. H2, then H3.
4. business-scopes M3, M4 and M5.
5. H5 and H6.
6. H4 and H7.
7. business-scopes M6, live acceptance with a test business.

## Concrete Steps

From the repository root: `bun run verify`, `bun run test:integration`, and `bun run dev` to walk
each screen. design-audit runs against the running app.

## Validation And Acceptance

The Purpose's story walked in a browser for each role; design-audit with no P0 or P1; refreshing
any screen keeps its filter and workspace; a guest VM on CHR reaches the portal and redeems a
voucher after H5.

## Idempotence And Recovery

Each milestone ships on its own; H1 is token-only and reverts with one commit.

## Interfaces And Dependencies

`Capabilities` and `Principal` (business-scopes M2), and the overview and analytics shapes (H3), in
`@hashifi/types`.

## Deferred

- `router-sim guest-run` after a host reboot: answer the console's cursor query and bring `eth0`
  up before DHCP.
