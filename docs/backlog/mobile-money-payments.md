# Mobile-money payments

Status: `ready`. Planned as M8 of the
[adoption plan](../exec-plans/active/adopt-purchased-billing-system.md#m8-mobile-money-payments-snippe-and-customers),
which holds the work; this item is removed when M8 completes.

## Problem

Guests can only get online with a voucher someone sold them in person. Selling packages
directly on the captive portal, paid by mobile money, removes the need for a seller at the
venue.

## What exists

The purchased code, in the import commit `45ebd53`, integrates Snippe
(`apps/api/src/routes/snippe-webhook.ts` and `payments.ts`, `src/utils/snippe.ts`,
`src/scripts/reconcile-pending-payments.ts`, and the payment half of
`src/services/reconcile-daemon.ts`; read with `git show 45ebd53:<path>`): a payment request from
the portal, a signed webhook, reconciliation of pending payments, and a voucher issued and
pushed to the router once paid. Payments track `router_provisioned_at` separately from
`status = "paid"`. The NestJS port left it out; the schema keeps the `payments` table.

## Gate

Vouchers work end to end on a physical router (adoption plan M7). Then: a Snippe merchant
account, its webhook verified against the published contract, and the portal flow reviewed
under ADR-0003 (the API decides payment state; the web presents it).
