# HashiFi product requirements

The canonical product definition: what HashiFi must do and why. How it is built is in
[ARCHITECTURE.md](ARCHITECTURE.md) and [docs/design-docs/](docs/design-docs/README.md).

## 1. Summary

Sharing an internet connection means people asking for access, some late at night, and the
owner enabling and disabling their devices and tracking MAC addresses by hand. HashiFi
replaces that with prepaid access nobody has to ask for: a guest joins the WiFi, the router
shows a captive portal, and the guest buys a package with mobile money and is online straight
away. Guests who pay cash get a printed voucher instead. Either way the router lets them online
for the package's time, speed and device limit, and cuts them off when it ends.
The same system serves one home and many venues, each with its own routers, packages and
branding.

HashiFi is built from a purchased hotspot billing system developed for this market
([ADR-0001](docs/engineering-decisions/0001-adopt-purchased-billing-system.md)). Its
multi-venue business model is HashiFi's long-term direction and is kept.

## 2. Users and use

| User | Context and goals |
| --- | --- |
| Platform admin | Runs HashiFi: venues, routers, packages, team, settings, audit |
| Venue manager | Runs one or more venues: their routers, vouchers, sessions and figures |
| Guest | Joins a venue's WiFi on a phone, often on a slow link, and wants to get online quickly |

Paul's home is the first venue.

## 3. Principles

- **Nobody has to ask.** Self-service purchase on the portal is the default way in; it works at
  any hour without the owner or a venue's staff acting for the guest.
- **Cash still works.** Printed vouchers sold for cash are a first-class way in for guests who
  will not use a mobile wallet.
- **Every way in is one mechanism and is recorded.** Self-service, an assisted sale and a
  pre-printed card all end in a voucher the router confirms, and every one is counted as a sale
  at its venue. Which one fits is a venue's choice, not the product's.
- **Access follows the router, not the database.** HashiFi reports access granted only
  after the router confirms it.
- **The voucher is the guest's identity.** MAC addresses are a soft device signal:
  modern phones randomise them per network, and anyone nearby can observe them.
- **The ISP router is only an uplink.** HashiFi controls a MikroTik behind it.
- **Routers are probed, not assumed.** Board and RouterOS differences are detected.

## 4. Scope

### 4.1 Venues and routers

Admins create venues and add routers to them. Adding a router generates a bootstrap
script for a freshly reset MikroTik. HashiFi then configures the hotspot automatically and
safely repeatably, and a readiness checklist shows what is working.

Acceptance: a reset router becomes a working hotspot through the bootstrap script and the
automated setup alone, and the checklist reports each check's real state.

### 4.2 Packages

A package defines a price in TSH, a duration, optional speed and data limits and a device
limit, and is offered at selected venues.

### 4.3 Vouchers

Admins and managers generate vouchers in batches for a package and print them with QR
codes, to sell for cash. A voucher bought on the portal is the same kind of voucher, issued
when the payment is confirmed. A voucher's lifecycle is `unused → pending_activation → active → expired`, decided by
the API and the router.

### 4.4 Captive portal

A guest on a venue's WiFi sees that venue's branded portal and either buys a package with
mobile money (4.7), is logged straight in, or enters or scans a voucher they were given or sent,
and is online once the router confirms. A returning device with an active voucher reconnects
without re-entering the code, without the code ever being exposed.

Acceptance: a phone on a HashiFi hotspot reaches the portal, redeems a voucher and browses;
the voucher's limits and expiry are enforced by the router.

### 4.5 Sessions and figures

Live sessions per venue and router, automatic expiry, usage analytics and revenue,
calculated by the API.

### 4.6 Team and audit

Admin and manager roles; managers see only their venues. Sensitive actions are audited.

### 4.7 Selling access: three paths, one mechanism

All three end in a voucher confirmed by the router before access starts, and all three record
a sale for the venue's figures. They suit different places, and a venue can use all of them.

- **Self-service on the portal (the default).** The guest picks a package and pays with their
  mobile number. When the payment is confirmed, HashiFi issues a voucher and logs **the device
  that paid** straight in: no code to type. The code is returned to that device once, over the
  portal session that made the payment, and is also sent to the phone number, as the receipt
  and the way to add a second device (within the package's limit) or reconnect. Works at any
  hour with nobody acting for the guest. A payment that succeeds while the router is
  unreachable is retried until the guest has access, and is shown as access owed until then.
- **Assisted sale.** A manager or admin records a payment (cash or mobile money) against the
  guest's phone number; HashiFi issues the voucher and sends it to that phone, or the manager
  prints it. The fullest record: who paid, how, at which venue, for which voucher. Suits
  regulars.
- **Pre-printed cards.** Vouchers printed in batches are stock at a known price per venue,
  handed over for cash with no phone number or typing: the fastest, for a busy venue. A card
  counts as a cash sale at its venue when it is redeemed; unsold cards remain stock.

Codes reach phones by WhatsApp or SMS through BRIQ, the messaging provider shared with other
Hashikome products, falling back to the other channel, then to email when the guest gave one,
then to "contact the venue" on the portal. A delivery outage never costs the paying device its
access. Payments use Snippe (adoption plan M6).

Acceptance: on the router sim with Snippe's test environment, each path gets a guest online and
expiry cuts them off, and each appears in the venue's figures; then on a physical router with a
real payment and a real message (M8).

## 5. Data

| Data | Purpose | Visible to |
| --- | --- | --- |
| Staff | Sign-in (email and one-time code, an authenticator app for admins), roles, venue scope | Admins |
| Devices | A guest device's MAC address, name and type, and its sessions (not a person: one guest can be several devices) | Admins; managers for their venues |
| Customers | A paying guest's mobile number, their devices and payments (from M6) | Admins; managers for their venues |
| Router credentials | Configuring routers | Encrypted at rest; never returned to clients |

Development and tests use invented data only.

## 6. Non-functional requirements

- **Guests on cheap phones and slow links:** the portal is small and works on a first visit
  with nothing cached.
- **Time:** stored in UTC; business days in `Africa/Dar_es_Salaam`.
- **Money:** whole TSH, never decimals in presentation.
- **Copy:** never name a mobile-money provider.
- **Security:** voucher codes are credentials; see [docs/SECURITY.md](docs/SECURITY.md).

## 7. Out of scope

- **Routers other than MikroTik** (OpenWrt, UniFi, Omada, pfSense) are future options.
- **PPPoE** settings exist in the purchased code but are not selected.

## 8. Delivery

Active plan: [adopt the purchased billing system](docs/exec-plans/active/adopt-purchased-billing-system.md).
Nothing is deployed.
