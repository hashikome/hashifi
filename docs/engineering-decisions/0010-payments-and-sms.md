# ADR-0010: Payments, vouchers and SMS

Status: accepted, 31 October 2026, as proved against test doubles and the router sim. Real mobile
money and SMS have not run yet: neither provider's account exists.

## Context

Self-service purchase is the default way in. Money is the one place a bug costs a guest something,
and three things can finish a payment at the same moment: the provider's webhook, a guest's waiting
screen and the reconcile job. The earlier code checked and then inserted, kept the voucher code in
a payment's metadata, deduplicated events in that same metadata, and returned the code to anyone
holding a payment id.

## Decision

1. **One transition.** `PaymentsService.complete` moves a payment from pending to paid and makes
   its voucher in one transaction, under a row lock, so one payment is one voucher. A provider's
   event is written to `webhook_events` in that transaction, so a repeat does nothing. A late
   failure never walks back a paid payment; money that arrives after a failure still counts. An
   amount or currency that does not match grants nothing, and leaves the payment for a person.
2. **Paid is not online.** `settle` runs after the commit and is safe to repeat: the code goes out,
   the router confirms the voucher (`router_provisioned_at`), and the paying device is signed in
   by the same `GuestService.admit` a typed code uses. What fails waits for the reconcile job,
   shown as access owed. Router work never delays the provider's 2xx.
3. **The code goes to the session that paid.** Starting a payment returns a random secret once,
   and only its hash is stored. Status needs that secret, so a payment id shows nothing, and no
   metadata holds the code. The browser keeps the secret in its tab, so a reload finds the receipt.
4. **Nothing prompts a phone until everything is checked:** a registered router, a package on sale
   there, a payable price, a device not blocked, a device the router can see, and limits per
   number, device and address. A router that cannot be asked does not stop a purchase: the
   payment waits, as access owed.
5. **Webhooks are proved over the exact bytes.** Payment reports are signed over the timestamp and
   body, and refused 300 seconds out. SMS reports have no timestamp, so the event id alone stops a
   replay. Bodies never reach a log, because they hold a customer's number.
6. **Assisted sales prompt nobody.** Staff record money already taken, for cash or mobile money. The
   code comes back to them, and goes by SMS if there is a number. Printed cards stay as they are:
   stock until redeemed, then cash sales.
7. **SMS cannot strand a guest.** A message is sent once per payment, and its text is not kept.
   One nobody reports on becomes `unconfirmed` at 10 minutes. The screen always has the code.
8. **Providers sit behind interfaces** (`MobileMoneyGateway`, `SmsSender`). Without keys, a fake
   gateway and an outbox stand in for development, and production refuses to start without the
   real ones. No background queue: PostgreSQL holds the state, so `IntervalJob` is enough.

## Evidence

`payments.integration.test.ts` (15 tests): checks before a prompt, limits, forged, unsigned, stale
and replayed reports, odd whitespace in a signed body, concurrent completion, wrong amounts, late
failures, lost webhooks, a router that was down, failing SMS, another session, manager scope and
revenue. `router-sim guest-test`: a purchase through the walled garden brings the paying device
online. Walked in a browser: buy, approve, receipt, reload, a second session, a staff sale.

## What remains open

- **Neither provider has been called for real.** Contracts come from their documents of 31 October.
- **Snippe:** whether a test mode exists; whether the fixed `customer.email` is accepted; whether
  `webhook_url` must be HTTPS. The earlier code recorded a live account ending approval at about 10 minutes,
  where the documents say 4 hours, so a guest may wait on a prompt that has gone.
- **BRIQ:** the send returns `job_id` and delivery reports name `message_id`, and the documents do
  not say how they link. Messages match on either; the rest end `unconfirmed`. A sender ID needs
  TCRA approval, which takes weeks.
