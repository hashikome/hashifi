# HashiFi Network Architecture Reference

HashiFi is viable, but the access-control logic should not depend on the basic router supplied by an ISP. Routers commonly provided by ISPs such as Vodacom, Tigo/Yas, and Airtel are best treated as internet uplinks. They usually expose basic WiFi and device-management settings, but they should not be assumed to support a custom captive portal, router API, RADIUS accounting, per-session expiry, or reliable per-user firewall control.

## Core Assumption

HashiFi should control a dedicated gateway or hotspot router placed behind the ISP router.

```text
Internet / SIM / Fiber
        |
ISP router from Vodacom, Tigo/Yas, Airtel, etc.
        |
HashiFi-controlled router or gateway
        |
Guest WiFi / access points
        |
Customers
```

The ISP router provides internet access. The HashiFi-controlled router enforces subscriptions, redirects unauthenticated users, tracks sessions, and permits or blocks traffic.

## What Works With Basic ISP Routers

A basic ISP router can support simple QR-based WiFi sharing if the QR code only contains the WiFi name and password.

That approach is limited:

- The password can be shared freely.
- Expiry is not enforceable per customer.
- Device limits are not reliable.
- Admins may need to rotate passwords manually.
- There is little or no integration with payments, subscriptions, or per-router analytics.

This can be useful for a very small demo, but it is not enough for the full HashiFi model.

## Required Router Capabilities

For a proper implementation, the controlled gateway should support at least some of the following:

- Captive portal or hotspot mode
- External portal redirect
- Voucher, user, or token-based access
- RADIUS authentication and accounting
- Router API, SSH, or scripting
- Firewall rules per user, session, or device
- DHCP/client tracking
- Guest network isolation
- Bandwidth limits per user or subscription
- Session expiry and disconnect support

## Recommended Router Families

MikroTik RouterOS is the strongest first target for the MVP. It has built-in hotspot support, user/session controls, RADIUS integration, firewall rules, queues, scripting, and API access. It is also relatively affordable and common in small ISP and hotspot deployments.

Other viable options:

- OpenWrt-compatible routers: flexible and low-cost, but require more engineering work.
- UniFi or TP-Link Omada: useful for managed guest WiFi, though external portal and API behavior depends on model and controller support.
- pfSense or OPNsense gateway with separate access points: powerful, but more suitable for heavier business deployments.

## Bridge Mode And Double NAT

The cleanest setup is for the ISP router to run in bridge mode or IP passthrough mode, allowing the HashiFi-controlled router to become the main gateway.

```text
ISP modem/bridge -> HashiFi router -> Guest WiFi
```

Bridge mode is helpful but not mandatory. If the ISP router does not support bridge mode, HashiFi can still work behind it:

```text
ISP router NAT -> HashiFi router NAT -> Guest WiFi
```

This double-NAT setup is usually acceptable for customer browsing, messaging, streaming, and normal app use. It can complicate inbound port forwarding, remote administration, VPN hosting, and services hosted inside the premises. To avoid those problems, the HashiFi backend should be cloud-hosted and the router should initiate outbound connections to it.

## Captive Portal Flow

The recommended MVP flow:

1. Customer connects to the guest WiFi.
2. The router blocks normal internet access for unauthenticated clients.
3. The router redirects the customer to the HashiFi portal.
4. HashiFi validates a subscription, voucher, payment, or QR token.
5. HashiFi authorizes the router session.
6. The router allows internet access for the permitted duration.
7. The router enforces expiry, optional speed limits, and device/session limits.

The QR code should normally open the HashiFi portal or encode a subscription/voucher token. It should not only contain the shared WiFi password if the goal is enforceable access control.

## Device Locking Caveat

MAC-address locking can help, but it should not be the only identity mechanism. Modern Android and iOS devices often use randomized MAC addresses per WiFi network. Users can also reset or change their randomized address.

Recommended approach:

- Treat the subscription or voucher token as the primary identity.
- Use the router session/accounting state to enforce access.
- Use MAC addresses as a soft device-binding signal.
- Allow a configurable number of devices per subscription.
- Provide a way to release or replace a registered device.

## MVP Recommendation

Start with MikroTik as the first supported router target:

- Use MikroTik hotspot/captive portal features.
- Use HashiFi for subscription, voucher, QR, payment, and admin logic.
- Use RADIUS or MikroTik API for authorization and accounting.
- Host the HashiFi backend in the cloud.
- Let each router call outward to the backend to avoid inbound networking issues.

This keeps the first implementation practical while still leaving room to support OpenWrt, UniFi, Omada, pfSense, or OPNsense later.
