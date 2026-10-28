# HashiFi product requirements

The canonical product definition: what HashiFi must do and why. How it is built is in
[ARCHITECTURE.md](ARCHITECTURE.md) and [docs/design-docs/](docs/design-docs/README.md).

## 1. Summary

Sharing an internet connection means repeatedly handing out passwords, enabling and
disabling devices and tracking MAC addresses by hand. HashiFi replaces that with prepaid
access: a guest joins the WiFi, the router shows a captive portal, the guest enters a
voucher, and the router lets them online for the package's time, speed and device limit.
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
codes. A voucher's lifecycle is `unused → pending_activation → active → expired`, decided by
the API and the router.

### 4.4 Captive portal

A guest on a venue's WiFi sees that venue's branded portal, enters or scans a voucher and
is online once the router confirms. A returning device with an active voucher reconnects
without re-entering the code, without the code ever being exposed.

Acceptance: a phone on a HashiFi hotspot reaches the portal, redeems a voucher and browses;
the voucher's limits and expiry are enforced by the router.

### 4.5 Sessions and figures

Live sessions per venue and router, automatic expiry, usage analytics and revenue,
calculated by the API.

### 4.6 Team and audit

Admin and manager roles; managers see only their venues. Sensitive actions are audited.

## 5. Data

| Data | Purpose | Visible to |
| --- | --- | --- |
| Admin users | Sign-in (email and one-time code), roles | Admins |
| Guests | Optional phone number, device MAC and details, sessions | Admins; managers for their venues |
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

- **Payments** (Snippe mobile money) are deferred until vouchers work end to end
  ([docs/backlog/mobile-money-payments.md](docs/backlog/mobile-money-payments.md)).
- **Routers other than MikroTik** (OpenWrt, UniFi, Omada, pfSense) are future options.
- **PPPoE** settings exist in the purchased code but are not selected.

## 8. Delivery

Active plan: [adopt the purchased billing system](docs/exec-plans/active/adopt-purchased-billing-system.md).
Nothing is deployed.
