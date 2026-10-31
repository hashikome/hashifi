# Redesign the admin around an owner's jobs

This ExecPlan is a living document. Maintain it according to `PLANS.md`. Keep `Progress`,
`Surprises & Discoveries`, `Decision Log` and `Outcomes & Retrospective` current as work
proceeds.

## Purpose / Big Picture

An owner with a reset MikroTik reaches a working hotspot without guessing the next step, and every
admin screen answers the question it was opened for. Observable result: from a new router's page,
the owner downloads the script, presses Set up router, watches each stage finish, and sees a result
that survives a refresh; a failure says what to do. Adding a venue takes three fields. On a phone,
a list screen shows its list first.

The audit that motivates this scored the admin 16/40: it is organised around database tables, not
jobs. The look stays: `DESIGN.md`, teal and Figtree are kept, as the brand has its own session.

## Progress

- [x] (2026-11-01) Audit, with findings recorded here.
- [x] (2026-11-01) Fix: setup and verify always answered 400 (`0da36cc`).
- [x] (2026-11-01) M1: setup runs in the background, with progress and a result stored on the router.
- [x] (2026-11-01) M2: a router page holding the journey; the setup dialog removed.
- [ ] M3: the venue form cut to what is used; the unused columns, map and region data removed.
- [ ] M4: list screens: the question first, named actions, phones reach the list.
- [ ] M5: the remaining forms, in plain words.
- [ ] M6: design-audit on the result; findings fixed; `DESIGN.md` and the runbooks updated.
- [ ] Finish the production test with CHR: a voucher redeemed from the guest VM.

## Surprises & Discoveries

- Observation: every Set up router and Check it's serving click failed, and only a toast said so.
  Evidence: three 400s in 7-23ms in the production logs; `parseInput` turned an absent flag into `{}`.
- Observation: a reset router has no DNS, so a tunnel to a host name never connected.
  Evidence: `failure: dns server failure` on CHR; fixed in `aec19d9`.
- Observation: seven venue fields are read only by the form and its serializer.
  Evidence: road, street, ward, district, postal code, latitude and longitude, by search of the code.

## Decision Log

- Decision: keep `accent-ladder`, teal and Figtree rather than deal a new style.
  Rationale: `DESIGN.md` already commits to it, and the audit's problems are structural.
  Date/Author: 2026-11-01 / Claude
- Decision: setup runs in the background, and its state lives on the router row.
  Rationale: Cloudflare ends a request at about 100 seconds, and a result held in a dialog is lost
  on refresh. The API owns the workflow (ADR-0003), so the page only reads it.
  Date/Author: 2026-11-01 / Claude
- Decision: a venue is a name, a city or town, and an optional address.
  Rationale: nothing else is used by anything. Paul asked for the fields to go; production holds
  only test data, so dropping the columns discards nothing of value.
  Date/Author: 2026-11-01 / Paul
- Decision: the journey has three stages: connect, set up, serving.
  Rationale: they are what an owner does; the six internal phases show only as progress within
  Set up.
  Date/Author: 2026-11-01 / Claude

## Outcomes & Retrospective

Not started.

## Context And Orientation

- `apps/web/app/(staff)/admin/`: the admin routes. `components/provision-dialog.tsx` is the setup
  dialog this plan replaces; `components/router-bootstrap-dialog.tsx` makes the script.
- `apps/api/src/routers/`: the routers module. `services/router-provision/setup.ts` runs the six
  phases and shares one `RouterLogger`, which is streamed over `/ws/live`.
- `packages/types`: the API's shapes as the web reads them.
- The journey's stages come from the API, per ADR-0003: the web renders them and decides nothing.

## Plan Of Work

M1 first, because M2 renders it. `POST /api/routers/:id/setup` starts a run and answers 202; the run
records its stage on the router, and `GET /api/routers/:id/journey` answers the stage, the current
phase and the last result. A second start while one runs is refused. A run older than ten minutes
with no finish counts as interrupted, since an API restart ends it.

M2 adds `/admin/routers/[id]` as the router's home: the title, its status, the three stages with the
next one open, and the last result with what to do. The list's row opens it, and the wand goes.

M3 is a migration plus the form. M4 to M6 go screen by screen.

## Concrete Steps

From the repository root: `bun run verify`, `bun run test:integration`, and for the journey
`bun run router-sim import <script>` against production, as `docs/runbooks/router-sim.md` says.

## Validation And Acceptance

A reset CHR becomes a working hotspot from the router page alone, and a guest VM redeems a voucher.
Refreshing during setup keeps the progress. A failed run names the fix. design-audit reports no P0
or P1.

## Idempotence And Recovery

Setup is safe to repeat, as provisioning is. The migration drops only columns nothing reads.

## Interfaces And Dependencies

`RouterJourney` in `@hashifi/types` is the contract between M1 and M2.
