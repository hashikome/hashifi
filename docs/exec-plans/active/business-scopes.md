# Businesses own their venues; owners, managers and operators work in a scope

This ExecPlan is a living document. Maintain it according to `PLANS.md`. Keep `Progress`,
`Surprises & Discoveries`, `Decision Log` and `Outcomes & Retrospective` current as work
proceeds.

## Purpose / Big Picture

HashiFi is sold to businesses. Hashikome creates a business, its venues and routers; the business's
owner signs in and sees all of their venues, with a venue switcher only when there are several, and
invites managers to run venues for them and operators to work the counter. Hashikome's own platform
owner, managers and operators oversee every business. The rules are
[ADR-0011](../../engineering-decisions/0011-platform-and-business-scopes.md).

Observable result: the platform owner adds "Neema Hospitality" with two venues and invites Neema as
its owner. Neema signs in, sees both venues, invites Halima as manager of one venue and Musa as an
operator there. Halima can change that venue's portal and add a weekend package sold only there, but
cannot see the other venue or change business-wide prices; Musa can print vouchers and see live
sessions but not analytics. Every other business is invisible to all three, and a guessed id answers
not found.

## Progress

- [x] (2026-11-03) Roles agreed with the owner; ADR-0011 written; ADR-0007 narrowed to sign-in.
- [ ] M1: schema: businesses, memberships, membership venues, invitations, business packages;
  migration of existing rows.
- [ ] M2: the access policy and the principal; every service scoped through it.
- [ ] M3: invitations and Team pages for both scopes; the add-business flow for platform staff.
- [ ] M4: packages per business, the platform defaults and CSV import.
- [ ] M5: the web: scope switcher, navigation per role, the one-venue view; with the Hearth redesign.
- [ ] M6: live acceptance against production with a test business.

## Surprises & Discoveries

- Observation: venue scope is already applied in one place.
  Evidence: `apps/api/src/auth/venue-scope.ts` returns `{}` for an admin and `{ operatorId }` for a
  manager, and 56 call sites read `operatorId` through services; M2 replaces the helper, not each query.

## Decision Log

- Decision: one email per person, several memberships, one active per session (ADR-0011, 7).
  Rationale: the platform owner also owns a business, and people should not keep a second identity
  to change hats; one active membership still keeps every query in one scope.
  Date/Author: 2026-11-03 / Paul
- Decision: the business is the tenant, the venue a scope inside it.
  Rationale: an owner's "all venues" stays inside one tenant.
  Date/Author: 2026-11-03 / Paul and Claude
- Decision: one `users` table for everyone who signs in; `memberships` replaces `staff`.
  Rationale: one sign-in, one invitation flow and one policy; the scope column, not the table,
  separates platform staff from a business's people, and only the active membership applies.
  Date/Author: 2026-11-03 / Paul and Claude
- Decision: a business profile (name, logo) above each venue's portal brand; the admin keeps
  HashiFi's design (ADR-0009).
  Rationale: a business with venues known by different names needs the venue on its portal.
  Date/Author: 2026-11-03 / Paul and Claude
- Decision: keep platform operators in the model though none exist yet.
  Rationale: the same ladder in both scopes costs nothing extra and avoids a later migration.
  Date/Author: 2026-11-03 / Paul

## Outcomes & Retrospective

Not started.

## Context And Orientation

- `apps/api/prisma/schema.prisma`: `Staff` (role `admin` or `manager`, status), `Venue.operatorId`,
  global `Package` linked to venues by `VenuePackage`.
- `apps/api/src/auth/staff-guard.ts`: the global guard; reads `staff`, enforces the authenticator
  app for admins, and offers `@Roles(...)`.
- `apps/api/src/auth/venue-scope.ts`: the one venue filter every scoped query uses.
- `apps/api/src/team/`, `apps/api/src/staff/add-staff.cli.ts`: adding people today (admins only).
- `packages/types`: `StaffRole` and the principal as the web reads them.
- Terms: a *scope* is the platform or one business. A *membership* is a person's role in a scope,
  plus venues for a business manager or operator. *Owner-only* actions are listed in ADR-0011, 3.

Production holds only test data (one venue, `chr-test`, and test vouchers) and one staff member, the
platform owner, so the migration maps rows rather than preserving a live tenant.

## Plan Of Work

**M1, schema.** Add `Business` (name, logo key, status; the logo stored as ADR-0009 says), `Venue.businessId` (required; drop `operatorId`),
`Membership` (user id, scope `platform` or `business`, business id when business, role `owner`,
`manager` or `operator`, status; unique per user and scope), the session's active membership (a
column on Better Auth's session through its additional fields, or `session_memberships`, whichever
Better Auth supports cleanly), `MembershipVenue` (membership, venue), `Invitation`
(email, scope, business, role, venues, invited by, expiry, accepted at), and packages owned by a
business with an optional venue list (`PackageVenue`), plus `PlatformDefaultPackage`. The migration
creates one business per existing operator (or "Hashikome test" for venues without one), moves each
venue into it, turns the admin into the platform owner and each manager into an owner of their
business, and seeds the three default packages. `Staff` is renamed `Membership` in the same release
(pre-deployment compatibility: no alias).

**M2, access.** `apps/api/src/access/policy.ts`: actions as a closed union (`venue.read`,
`voucher.print`, `package.price.set`, `member.invite.manager`, ...), each mapped to the least role per
scope and whether it is owner-only. `Principal` is built from the session's active membership: membership id, scope, business id,
role and venue ids. `POST /api/me/membership` switches it (only to one of the person's own,
audited); `GET /api/me` lists the person's memberships for the account menu. `venueScope(principal)` returns `{}` for platform roles, `{ businessId }` for a business
owner, and `{ businessId, id: { in: venueIds } }` otherwise. `@Can(action)` replaces `@Roles`. The
guard enforces the authenticator app for anyone holding a platform membership.

**M3, people.** Invitations: create (only a role below one's own, venues within one's own), email via
Resend with a code sign-in, accept on first sign-in, revoke, expire after 7 days. Team page per scope.
Platform staff get "Add a business": name, first venue, owner's email; the owner's invitation goes
out. The owner's Business profile page sets the name and logo. Every change audited.

**M4, packages.** Business packages seeded from the platform defaults on creation; venue-limited
packages for managers; CSV import: parse, validate (name, duration such as `1h`, `24h`, `7d`, devices,
price in TSh, venues as `all` or names), return a preview of adds and updates, apply on confirm; no
deletes.

**M5, web.** The account menu at the sidebar's foot (who you are, your workspaces, account and
sign-out), kept apart from the scope filter at the top. The business's name and logo at the head of the sidebar for its people (HashiFi's
with the Platform tag for platform staff), the portal's logo fallback (venue, business, HashiFi), the scope switcher ("All businesses" for platform roles, "All venues" for an owner of
several, none for one venue), navigation per role from the API's capabilities, the one-venue
overview, Team and Packages screens, in the Hearth design (`docs/exec-plans/active/redesign-admin.md`).

## Concrete Steps

From the repository root: `bun run db:migrate` (M1), `bun run verify`, `bun run test:integration`.

## Validation And Acceptance

- Integration tests per role and scope: for each of the seven memberships (three platform, owner,
  manager, operator, and a manager of another business), every scoped route answers its data, not
  found, or forbidden as the policy says; a guessed id from another business is not found.
- Invitation tests: no one invites a role at or above their own, or to a venue they do not hold;
  inviting an existing user adds a membership; expiry and revocation work; the audit log records each.
- Switching tests: a person with a platform and a business membership sees only the active one's
  data; switching to a membership that is not theirs is refused; each switch is audited.
- CSV import tests: a valid file previews then applies; a bad row names its line and nothing is saved.
- Live: a test business in production walks the Purpose's story end to end.

## Idempotence And Recovery

The migration runs once and maps existing rows; it is safe against production's test data. Before
applying it in production, the backup runner's latest snapshot is confirmed in R2.

## Artifacts And Notes

Design reference: round 3 of the Hearth review, roles drawn per page (a private artifact the owner
holds).

## Interfaces And Dependencies

`Principal` and `Capabilities` in `@hashifi/types` are the contract between the API and the web; the
web renders navigation and actions from capabilities, never from role names.
