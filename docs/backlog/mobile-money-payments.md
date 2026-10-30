# Mobile-money payments

Status: `ready`. Planned as M6 of the
[build plan](../exec-plans/active/build-hashifi.md#m6-mobile-money-payments-snippe-and-customers),
which holds the work; this item is removed when M6 completes.

## Problem

Guests can only get online with a voucher someone sold them in person. Selling packages
directly on the captive portal, paid by mobile money, removes the need for a seller at the
venue.

## What exists

Commit `45ebd53` integrates Snippe
(`apps/api/src/routes/snippe-webhook.ts` and `payments.ts`, `src/utils/snippe.ts`,
`src/scripts/reconcile-pending-payments.ts`, and the payment half of
`src/services/reconcile-daemon.ts`; read with `git show 45ebd53:<path>`): a payment request from
the portal, a signed webhook, reconciliation of pending payments, and a voucher issued and
pushed to the router once paid. Payments track `router_provisioned_at` separately from
`status = "paid"`. The NestJS port left it out; the schema keeps the `payments` table.

## Gate

The portal works (build plan M5) and a Snippe merchant account exists. Its webhook is
verified against the published contract, and the portal flow reviewed under ADR-0003 (the API
decides payment state; the web presents it). No physical router is needed: the router sim and
Snippe's test environment prove it before the release.
