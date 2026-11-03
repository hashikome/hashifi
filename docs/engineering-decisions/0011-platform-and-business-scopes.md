# ADR-0011: Platform and business scopes, with owners, managers and operators

Status: accepted, 3 November 2026. Replaces the admin and manager roles of ADR-0007, which keeps
sign-in itself.

## Context

HashiFi is sold to businesses that want to sell their WiFi: a guest house, a café, a home. Hashikome
supplies the software, creates the business's venues, adds its MikroTik routers and sets them up;
the business buys the router and its internet line. One business can own several venues, and adds
one by asking Hashikome, which sets it up the same way.

Until now `staff` had two roles, admin and manager, and a venue had one `operator_id`. That cannot
say that Neema owns three venues, that someone runs one of them for her, or that someone else only
sells vouchers at its counter, and it gives Hashikome's own helpers nothing between "everything" and
"one venue".

## Options considered

- **Keep admin and manager, add venue lists.** Small, but a manager is both the person who runs a
  venue and the person at its counter, and Hashikome's helpers must be admins to help anyone.
- **Each venue its own organization.** An owner of three venues would belong to three tenants, and
  "all my venues" would read across tenant boundaries, which is what the boundary exists to stop.
- **Two scopes, one ladder of roles** (chosen): the platform and the business, each with an owner,
  managers and operators.

## Decision

1. **Two scopes.** The *platform* is Hashikome running HashiFi. A *business* is the tenant: it owns
   one or more venues, and every venue belongs to exactly one business. Packages, vouchers, sessions,
   devices, payments and brands are reached through their venue's business.
2. **The same three roles in each scope.**
   - **Owner** decides. The platform owner owns HashiFi; a business owner owns all of their venues.
   - **Manager** runs things for the owner, with the owner's powers inside their scope, except what
     the owner keeps (below). A platform manager runs businesses, venues, routers and onboarding; a
     business manager runs the venues they were given.
   - **Operator** does the daily work. A platform operator supports businesses: connection checks,
     setup help, looking things up. A business operator works the counter at their venues: vouchers,
     live sessions, devices and the day's cash.
3. **What each owner keeps.** The business owner alone invites and removes managers, sets the
   business-wide packages and prices, holds the payout and billing relationship with Hashikome,
   asks for a venue, and closes the business. The platform owner alone invites and removes platform
   managers, changes platform settings and secrets, sets what businesses pay, and deletes a business.
4. **Venue scope inside a business.** A business owner reaches every venue of the business. A
   business manager or operator reaches only the venues on their membership, at least one. A manager
   may add packages that are sold only at their own venues.
5. **Platform staff see every business.** Platform roles reach all businesses and venues, choosing
   one with the scope switcher. Only Hashikome creates businesses and venues and adds routers.
6. **Nobody gives more than they have.** A person invites only roles below their own, inside their
   own scope: an owner invites managers and operators, a manager invites operators to their venues.
7. **One membership per person.** A membership is a role in a scope, plus its venues where that
   applies. A person holds one; a second business or a platform role means another email. This keeps
   every session in one scope; revisit when someone truly needs two.
8. **Authorization comes only from memberships**, decided in one policy in the API: may this role
   take this action in this scope. The web shows what the API returns and never infers access from
   what it renders (ADR-0003). Better Auth keeps identity and sessions (ADR-0007); memberships hold
   what HashiFi decides.
9. **Second factor.** Every platform role must enroll an authenticator app before reaching anything,
   as admins had to. Business roles may enroll one; once enrolled it is required.
10. **Default packages.** A new business starts with the platform's default packages, which the
    platform owner edits: 1 hour for TSh 500, 1 day for TSh 1,500 and 1 week for TSh 7,000. A
    business can change them, add its own, or import them from a CSV file, shown in full before it
    is saved; an import adds and updates by name and never deletes.

## What must hold

- Every API read and write is scoped to the signed-in membership; a record in another business, or
  at a venue the membership does not hold, answers not found, never forbidden.
- The policy is the one place that maps a role and scope to an action; no controller compares role
  names.
- An owner-only action stays owner-only for managers in the same scope.
- Every invitation, role change and removal is in the audit log with who did it.

## Evidence

Agreed with the owner on 3 November 2026 from the round 3 design review (roles drawn in the Hearth
direction). Implementation, tests and the schema are in
[the plan](../exec-plans/active/business-scopes.md).
