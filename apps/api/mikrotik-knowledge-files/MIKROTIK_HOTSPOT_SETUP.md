# MikroTik Hotspot — Complete Setup & Operations Guide

> ## 👉 Setting up a router right now? Start with [`ROUTER_ONBOARDING.md`](./ROUTER_ONBOARDING.md)
>
> That file is the **step-by-step procedure**: reset → paste the generated **Bootstrap script**
> → **Test connection** and save → **Set up router** → check a phone. Almost everything done by
> hand in this document is now automated, and following the manual steps here instead will
> produce duplicate rules and untagged config the system cannot manage.
>
> **This document is the reference**, not the procedure: why each setting exists, every
> error we hit and its fix, and the manual equivalent of each automated step. Read it when
> onboarding goes wrong, or when you need to understand what the provisioner is doing.
>
> One exception — **[§0](#0-routeros-7--check-the-hotspot-package-first) applies to
> everyone on RouterOS 7** and must be checked before anything else.

This is the exact, battle-tested procedure for connecting this Express + Next.js billing
system to a MikroTik hotspot. Every command, every gotcha, every error we hit is documented
here so future setups are frictionless.

---

## System Architecture

```
Internet
    │
ISP / Home Router  (192.168.0.1)  ← has MAC whitelist in our setup
    │ ethernet (plugged into ether1 on MikroTik)
    │
MikroTik hAP Lite  (192.168.0.161 on bridgeLocal)
    ├── WiFi Hotspot  wlan1  →  10.5.50.0/24  (DHCP pool hs-pool-2)
    └── Backend Server  192.168.0.15  (Mac on bridgeLocal via USB ethernet)

Phone (WiFi client, gets 10.5.50.x)
    │
    ▼  MikroTik intercepts HTTP, serves login.html
    │  login.html redirects → http://192.168.0.15:8080/portal/login
    ▼
Express backend (192.168.0.15:8080)
    │ /portal/login renders captive portal page
    │ /portal/validate-voucher validates voucher in MySQL
    │ Backend calls RouterOS API → creates hotspot user on MikroTik
    ▼
Phone browser POSTs credentials to MikroTik login URL
    │ MikroTik checks /ip hotspot user list
    ▼
Internet access granted  →  alogin.html shown  →  auto-redirects to destination
```

**No FreeRADIUS.** MikroTik manages its own user list (`/ip hotspot user`). The backend
validates voucher codes against MySQL, creates the hotspot user via RouterOS API,
and returns the credentials. MikroTik does the final authentication check itself.

> **CRITICAL DISTINCTION:** MikroTik (192.168.0.161) is NOT the internet gateway —
> the ISP router (192.168.0.1) is. MikroTik sits between the ISP router and WiFi clients.
> We confused these two during setup, which wasted significant debugging time.

---

## Prerequisites

- MikroTik router with hotspot license
- **RouterOS 7: the `hotspot` package must be installed — see below. It is NOT in the core build.**
- Laptop running the backend (`npm run dev` or `node dist/server.js`) on port **8080**
- Laptop and MikroTik on the same LAN (e.g. 192.168.0.0/24)
- Laptop IP **must be static** (see §1) — hotspot clients route through MikroTik to reach it
- Backend `.env` has `PORT=8080`
- Backend listens on `0.0.0.0` (not `127.0.0.1`) — Express default is already correct

---

## 0. RouterOS 7 — CHECK THE HOTSPOT PACKAGE FIRST

**RouterOS 7.20+ removed hotspot from the core build** on space-constrained architectures
(smips especially, e.g. hAP lite) and ships it as a separate **Extra package**. Upgrading
across that boundary silently deletes the hotspot subsystem: `/ip hotspot` disappears,
`/ip firewall filter` renames the hotspot chain to `unused-hs-chain`, and every backend
call fails with `no such command or directory (hotspot)`.

Your config, files and voucher users all survive — only the feature is gone. Reinstalling
the package brings the entire old setup straight back.

### 0.1 Check

```routeros
/system resource print       # note the EXACT version, e.g. 7.23.2, and the channel
/system package print        # is `hotspot` listed and enabled?
/ip hotspot print            # "no such command or directory" = package missing
```

### 0.2 Install

Get `hotspot-<version>-<arch>.npk` from **mikrotik.com/download → your architecture →
Extra packages**. The version **and release channel must match `/system resource print`
exactly** — a mismatched package is silently ignored at boot.

Easiest route, no WinBox needed — the router downloads it itself:

```routeros
/tool fetch url="https://download.mikrotik.com/routeros/7.23.2/hotspot-7.23.2-smips.npk" mode=https
/file print                  # must land in the ROOT of Files, not inside hotspot/
/system reboot
```

Verify before rebooting: `/file print` reports `package-name`, `package-version` and
`package-build-time` for a valid `.npk`. **The build-time should match the installed
`routeros` package** — that is the strongest confirmation you have the right file.

The package is tiny (~132 KiB), so free flash is not a constraint even on a 16 MB board.

### 0.3 After reboot

```routeros
/system package print        # hotspot listed, disabled=false
/ip hotspot print            # returns a menu
```

> **Do NOT downgrade or Netinstall over this.** A missing hotspot menu on RouterOS 7 is a
> missing package, not a dead board. We lost time assuming smips could not run hotspot on
> v7 — it can, with the Extra package.

> **A config reset keeps installed packages.** `/system reset-configuration` wipes settings
> only; `hotspot` stays installed. Only Netinstall removes packages.

### 0.4 If the package is installed and the menu is still missing

Check device-mode — `home`/`basic` hides hotspot regardless of packages:

```routeros
/system device-mode print
# hotspot: false → /system device-mode update mode=advanced
# then CONFIRM within 5 minutes: press the reset button or power-cycle,
# otherwise the change is discarded.
```

---

## 1. Set a Static IP on the Backend Machine

**Why:** Every setting below uses the backend machine's IP. If it changes (DHCP lease
renewal, network reconnect, switching from ethernet to WiFi), the phone gets
ERR_ADDRESS_UNREACHABLE and you must redo §4, §5, §6.

### 1.0 Which machine, which interface

The static IP goes on the **wired interface plugged into a MikroTik bridgeLocal port** —
the USB-ethernet adapter in our setup, not the WiFi card. The backend must sit on
bridgeLocal (192.168.0.0/24) so hotspot clients can route to it through the MikroTik.

> **Do not configure the same IP on two interfaces.** If WiFi holds `192.168.0.15` by DHCP
> and you also set the ethernet adapter to `192.168.0.15`, you get a duplicate address on
> the same L2 segment the moment both come up. Pick ONE interface to be the backend NIC and
> turn the other off (or leave it on a different subnet).

### 1.1 All four fields are mandatory

Set every one of these — an incomplete manual config is **worse** than DHCP, because the OS
may silently discard it and leave the interface with no address at all:

| Field           | Value                                                | Notes                                              |
| --------------- | ---------------------------------------------------- | -------------------------------------------------- |
| **IP address**  | `192.168.0.15`                                       | Pick one outside the DHCP pool, or reserve it (§1.4) |
| **Subnet mask** | `255.255.255.0`                                      | **Blank mask = config silently ignored**            |
| **Router**      | `192.168.0.1` (the ISP router, NOT the MikroTik)      | Omit it and the machine has no default route → no internet |
| **DNS**         | `8.8.8.8` (or `1.1.1.1`)                             | Manual config does not inherit DNS from anywhere    |

> **The MikroTik is not your gateway.** The Router/Gateway field is the ISP router
> (`192.168.0.1`). See the CRITICAL DISTINCTION note under System Architecture.

### 1.2 On macOS

System Settings → Network → **USB 10/100 LAN** → Details… → TCP/IP:

1. Configure IPv4 → **Manually**
2. IP address `192.168.0.15`, Subnet mask `255.255.255.0`, Router `192.168.0.1`
3. DNS tab → add `8.8.8.8`
4. OK, then turn WiFi off so it can't claim the same address

Or from the terminal (does the same thing, in the right order):

```bash
networksetup -setairportpower en0 off
sudo networksetup -setmanual "USB 10/100 LAN" 192.168.0.15 255.255.255.0 192.168.0.1
sudo networksetup -setdnsservers "USB 10/100 LAN" 8.8.8.8
```

Verify — and read the output carefully, `networksetup` accepts a half-filled config
without complaining:

```bash
networksetup -getinfo "USB 10/100 LAN"
# Subnet mask and Router must BOTH have values. If either is blank or (null),
# macOS discards the whole IPv4 config and the interface gets no address.

ifconfig en7 | grep inet
# Must print: inet 192.168.0.15 netmask 0xffffff00
# "status: active" alone means the CABLE is up, not the IP layer.
```

> **Symptom of a blank subnet mask:** the Network pane shows the service as "Connected"
> with your manual IP listed, but `ifconfig` shows no `inet` line, nothing routes out that
> interface, and WinBox MAC-connection fails with `ERR: Could not connect,
> MacConnection syn timeout` (MAC-WinBox is layer 2 — it needs a live interface to send
> frames out of, and macOS won't offer it one with no address). Connecting over WiFi still
> works, which makes it look like a router problem. It isn't.

### 1.3 On Windows 11

1. Settings → Network & Internet → Ethernet → your connection → IP assignment → Edit
2. Switch to **Manual**
3. Enable **IPv4**
4. Fill in all four fields from the table in §1.1
5. Save

Verify:

```powershell
ipconfig | findstr IPv4
# Should show 192.168.0.15
```

### 1.4 Reserve the IP in the ISP router admin panel

A static IP on the machine stops *that machine* from changing address. It does **not** stop
the ISP router's DHCP server from handing the same address to a phone or laptop that joins
later — then two devices answer to `192.168.0.15` and the portal breaks intermittently.

Log in to the ISP router admin panel (`http://192.168.0.1`) and add a **DHCP reservation /
static lease** binding `192.168.0.15` to the backend NIC's MAC address. Menu name varies by
vendor: *DHCP Reservation*, *Address Reservation*, *Static Lease*, *Bind IP to MAC*.

Get the MAC of the interface you configured — it must be the **wired** NIC's MAC, not WiFi:

```bash
# macOS
networksetup -getinfo "USB 10/100 LAN" | grep "Ethernet Address"

# Windows
ipconfig /all | findstr /C:"Physical Address"
```

```routeros
# Or read it off the MikroTik once the machine has talked to it
/ip arp print where address=192.168.0.15
```

> **Reservations are per-MAC.** Swap the USB ethernet adapter, or move the backend from
> ethernet to WiFi, and the reservation silently stops applying — the machine picks up a
> pool address and every rule keyed to `192.168.0.15` breaks. Redo the reservation against
> the new MAC.

While you are in that admin panel, check §17.2 — this router also has a **MAC whitelist**,
which is a separate list from DHCP reservations. The MikroTik's bridgeLocal MAC must be on
it or hotspot clients get no internet.

> **If you skip all of this** and the IP changes later, see §10 — "When the Laptop IP Changes".

---

## 2. MikroTik Hotspot Profile Configuration

### 2.1 Check what profile your hotspot uses

```routeros
/ip hotspot print
```

Note the `profile` field — for this setup it's `hsprof3`. Replace `hsprof3` in every
command below with your actual profile name.

### 2.2 CRITICAL — Disable CHAP, enable PAP only

```routeros
/ip hotspot profile set hsprof3 login-by=http-pap
```

**Why this matters:** MikroTik defaults to HTTP-CHAP (challenge-response authentication).
CHAP requires the browser to compute an MD5 hash using a raw-byte challenge MikroTik
injects as `$(chap-id)` and `$(chap-challenge)`. These are raw bytes, not hex strings.
When passed through URL parameters (as our redirect does), the encoding is unreliable,
producing a wrong hash and `login failed: invalid username or password`.

HTTP-PAP sends the plain password. Our captive portal submits the voucher code as the
password in plain text — this works cleanly.

Verify the change:

```routeros
/ip hotspot profile print where name=hsprof3
# login-by should show: http-pap
```

### 2.3 Check hotspot server is running

```routeros
/ip hotspot print
```

Should show `disabled=no`. The hotspot should be bound to your WiFi interface (e.g.
`bridge1`, `wlan1`, or similar).

### 2.4 Check CAP (CAPsMAN) is not interfering

If you're running CAPsMAN:

```routeros
/caps-man manager print
# If enabled=yes, CAPs manage the radio interfaces via CAPsMAN
```

We had a case where CAP was disabled, which was actually the correct state for a
standalone hotspot setup. Do not enable CAPsMAN unless you have a dedicated controller
router.

---

## 3. Create the Login Redirect Page

MikroTik's hotspot intercepts HTTP and serves `hotspot/login.html` from the router's
filesystem. We replace this with a tiny redirect page that sends the phone to our
Express portal, passing MikroTik's variables as query parameters.

**Three pages are pushed**, all from `backend/mikrotik-files/` and all listed in `PORTAL_FILES`:

| File | When the customer sees it |
| --- | --- |
| `login.html` | Not yet authenticated — redirects to the Express portal |
| `alogin.html` | Immediately after a successful login — "You're connected" |
| `status.html` | Already online and they open the hotspot address again |

`status.html` replaces the RouterOS stock page (a four-row table whose logout opens a popup window
that mobile browsers block). Unlike `login.html`, it is rendered **by the router** from `$(…)`
variables rather than fetching everything from the backend — a customer checking their remaining
time is already online, and the page must be complete even with the backend down. The backend is
only consulted to add the voucher's data allowance, which the router does not know.

Two constraints on editing it:

- **RouterOS substitutes `$(name)` anywhere in the file**, comments and script bodies included, so a
  jQuery-style `$(` would be silently replaced with nothing. `portal-files.test.ts` whitelists every
  variable the file may use.
- **Nothing external.** No stylesheet link, no script src — a phone on the hotspot has no internet
  until it logs in, and only the files we upload exist on the router.

### 3.1 Create the file on your laptop

Save as `login.html` (or edit `C:\Users\Patrick\Desktop\login.html`):

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Connecting...</title>
  </head>
  <body>
    <script>
      window.location.replace(
        "http://192.168.0.15:8080/portal/login" +
          "?mac=$(mac)" +
          "&ip=$(ip)" +
          "&link-login=$(link-login-only)" +
          "&link-orig=$(link-orig)" +
          "&chap-id=$(chap-id)" +
          "&chap-challenge=$(chap-challenge)",
      );
    </script>
    <p>Redirecting to portal...</p>
  </body>
</html>
```

> Replace `192.168.0.15` with the current laptop static IP if it differs.

### 3.2 Upload to MikroTik

**Option A — MikroTik web interface (Winbox or WebFig):**

1. Open Files in Winbox
2. Navigate to `hotspot/`
3. Drag and drop `login.html` to overwrite the existing one

**Option B — MikroTik terminal (if file is already on the router):**

```routeros
/file set [find name="hotspot/login.html"] contents="...paste html here..."
```

### 3.3 Verify the file is in the right place

```routeros
/file print where name~"hotspot"
# Should show hotspot/login.html
```

---

## 4. Walled Garden — Allow Backend Before Authentication

Unauthenticated clients are blocked by the hotspot. We must whitelist the backend IP
so phones can reach the portal page before they log in.

```routeros
/ip hotspot walled-garden ip add dst-address=192.168.0.15 action=accept
```

Verify:

```routeros
/ip hotspot walled-garden ip print
```

> If you see duplicate entries (same IP added twice), remove the extra:
>
> ```routeros
> /ip hotspot walled-garden ip remove 1
> ```
>
> (Remove by index — `0` is the first entry, `1` is second, etc.)

---

## 5. Firewall — Allow Hotspot Clients to Reach the Backend

Hotspot clients are on `10.5.50.0/24`. The backend is on `192.168.0.15`. By default,
MikroTik's forward chain may drop this inter-subnet traffic.

Add a forward rule that explicitly permits it, **before any drop rules**:

```routeros
/ip firewall filter add \
  chain=forward \
  src-address=10.5.50.0/24 \
  dst-address=192.168.0.15 \
  action=accept \
  place-before=0 \
  comment="hotspot-to-billing-backend"
```

Verify:

```routeros
/ip firewall filter print
# Rule 0 should be the accept rule above
```

> **Do not add this twice.** Check `print` first. If you see duplicates, remove with:
>
> ```routeros
> /ip firewall filter remove 1
> ```

### 5.1 Also allow the backend to reach the router ITSELF (input chain)

The forward rule above lets hotspot _clients_ reach the backend. A **second, separate**
rule is needed so the backend (Mac) can reach the **router itself** — i.e. the RouterOS
API on port 8728, Winbox, etc. That traffic is destined _to_ the router, so it hits the
**input** chain, not forward. Without it, the hotspot/firewall can drop the backend's API
connections and `router-sync` / `live-monitor` silently fail.

```routeros
/ip firewall filter add \
  chain=input \
  src-address=192.168.0.15 \
  action=accept \
  comment="backend-to-router-api"
```

Verify both hand-made rules exist (the dynamic `D`-flagged hotspot rules are separate):

```routeros
/ip firewall filter print
# Expect one accept in chain=forward (dst 192.168.0.15)
# and one accept in chain=input (src 192.168.0.15)
```

> **Both rules are keyed to the backend IP.** If the backend IP changes, BOTH must be
> updated — the forward rule's `dst-address` and the input rule's `src-address`. See §10.

---

## 6. NAT — Masquerade Hotspot Traffic

Hotspot clients need their traffic masqueraded (source-NATed) to reach the internet
through MikroTik's WAN interface.

Check if a masquerade rule already exists:

```routeros
/ip firewall nat print
```

Look for a rule with `action=masquerade` and `src-address=10.5.50.0/24`. If it exists,
you're done. If not:

```routeros
/ip firewall nat add \
  chain=srcnat \
  action=masquerade \
  src-address=10.5.50.0/24 \
  comment="hotspot-masquerade"
```

> In our setup this rule already existed from the original hotspot configuration.
> You only need to add it if it's missing.

---

## 7. Backend CORS Configuration

### 7.1 The CORS setup that WORKS

```typescript
// server.ts — this exact pattern
const adminCors = cors({ origin: frontendOrigin, credentials: true });
const portalCors = cors({ origin: "*" });

app.use("/api", adminCors);
app.use("/uploads", adminCors);
app.use("/portal", portalCors);
```

### 7.2 The CORS setup that BREAKS (do not use)

```typescript
// BROKEN — do not use regex paths with app.use() for CORS
app.use(/^\/(api|uploads)(\/|$)/, cors({ origin: frontendOrigin, credentials: true }));
app.use(/^\/portal(\/|$)/, cors({ origin: "*" }));
```

**Why it breaks:** `app.use()` with a regex path does not reliably intercept HTTP OPTIONS
preflight requests. The browser sends OPTIONS before the real request; without CORS
headers on the preflight response, the browser blocks the actual request with:
`No 'Access-Control-Allow-Origin' header is present`.

String paths (`"/api"`, `"/portal"`) work correctly because Express matches them for
OPTIONS preflight the same way it does for GET/POST.

---

## 8. Creating Hotspot Users (Manual — Pre-Automation)

MikroTik authenticates against its own internal user database. The backend validates
vouchers against MySQL, but MikroTik doesn't know about them — you must create matching
users in MikroTik for each voucher you want to test.

### 8.1 Check what users exist

```routeros
/ip hotspot user print
```

### 8.2 Add a user matching a voucher code

The backend uses the voucher code as both `username` and `password`:

```routeros
/ip hotspot user add name=WIFI-XMZET0 password=WIFI-XMZET0
```

Replace `WIFI-XMZET0` with the actual active voucher code from your database.

### 8.3 Generate fresh vouchers from the admin panel

1. Open `http://localhost:4000/admin/vouchers` in the browser
2. Click "Generate Vouchers"
3. Select a package and quantity
4. Note the generated codes
5. Add each code to MikroTik: `/ip hotspot user add name=<CODE> password=<CODE>`

> **Phase 2 goal:** The RouterOS API integration will automate step 5 — when the
> portal validates a voucher, the backend will call MikroTik's API to create the user
> automatically. See §11.

---

## 9. Testing the Full Flow

1. **Connect your phone to the hotspot WiFi** (the SSID served by MikroTik)
2. Open any http:// URL in the phone browser (not https — HTTPS bypasses captive portal detection on some devices; try `http://example.com`)
3. You should be redirected to `http://192.168.0.15:8080/portal/login`
4. Enter a voucher code that exists in **both** the MySQL database AND MikroTik's user list
5. Tap "Connect"
6. If successful, MikroTik grants internet access and the browser navigates to the original URL

### 9.1 What to check on each step

| Step                              | What to verify                                                     |
| --------------------------------- | ------------------------------------------------------------------ |
| Phone doesn't redirect            | Check login.html is at `hotspot/login.html` on router              |
| `ERR_ADDRESS_UNREACHABLE`         | Laptop IP changed — see §10                                        |
| Portal page loads, form errors    | Check browser console on phone; backend CORS config                |
| "Invalid voucher code"            | Code doesn't exist in MySQL DB; generate fresh codes               |
| "Connected" but redirected back   | Voucher not in MikroTik user list; add with `/ip hotspot user add` |
| Voucher validated but no internet | NAT masquerade rule missing                                        |

### 9.2 Watch MikroTik hotspot logs live

```routeros
/log print follow where topics~"hotspot"
```

Key messages and what they mean:

| Log message                      | Meaning                                             | Fix                                             |
| -------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| `logged in`                      | Auth succeeded — user is online                     | —                                               |
| `password is not chap encrypted` | Profile still in CHAP mode                          | Run `login-by=http-pap` from §2.2               |
| `invalid username or password`   | Credentials wrong OR user doesn't exist in MikroTik | Add user with `/ip hotspot user add`            |
| `trying to log in by http-chap`  | CHAP mode still active                              | Profile change didn't save; re-run it           |
| `trying to log in by http-pap`   | PAP mode active (correct)                           | If still failing, check username/password match |

---

## 10. When the Laptop IP Changes

> **This is no longer a manual chore — press Set up router.** All four places below are
> regenerated from the backend's current address, which the system discovers by finding its own
> interface on the router's subnet (`resolveBackendUrl` in `router-provision/context.ts`). The
> steps here remain as the reference for what changes and where, and for a board you are fixing
> by hand.

This used to be the most common cause of breakage. When the backend IP changes (e.g. from
`192.168.0.29` to `192.168.0.15`), FOUR places must be updated:

### 10.1 Update login.html

Edit `C:\Users\Patrick\Desktop\login.html`, change the old IP to the new one, then
re-upload to MikroTik (see §3.2).

### 10.2 Update the walled garden

```routeros
# Remove the old entry
/ip hotspot walled-garden ip remove [find dst-address=192.168.0.29]

# Add the new entry
/ip hotspot walled-garden ip add dst-address=192.168.0.15 action=accept
```

### 10.3 Update the firewall forward rule

```routeros
# Find the rule
/ip firewall filter print

# Update its destination (by rule number, e.g. 0)
/ip firewall filter set 0 dst-address=192.168.0.15
```

Or remove and re-add:

```routeros
/ip firewall filter remove [find comment="hotspot-to-billing-backend"]
/ip firewall filter add \
  chain=forward \
  src-address=10.5.50.0/24 \
  dst-address=192.168.0.15 \
  action=accept \
  place-before=0 \
  comment="hotspot-to-billing-backend"
```

### 10.4 Update the firewall INPUT rule (easy to forget)

The input-chain rule from §5.1 is keyed to the backend's **source** address. Update it too:

```routeros
/ip firewall filter set [find chain=input src-address=192.168.0.29] src-address=192.168.0.15
# (or set by rule number after a print)
```

> If a hand-made filter rule has no comment, `[find comment=...]` matches nothing — target
> it by its old address or by rule number instead, and add a comment while you're there so
> next time the find-by-comment trick works.

### 10.5 Prevent it from happening again

Follow §1 to set a permanent static IP. Once set, the IP never changes and these
updates are never needed again.

---

## 10b. When You Switch to a DIFFERENT Router (changing the whole subnet)

This is bigger than an IP change — it moves the entire flat segment (home router +
MikroTik bridge + Mac) onto a new subnet, e.g. `192.168.1.0/24` → `192.168.0.0/24`.

**Key principle of this topology:** the MikroTik bridges the uplink + the Mac onto the
home router's LAN — they all share ONE subnet. So the MikroTik's bridge subnet must
**equal** the home router's LAN subnet. The MikroTik is NOT a NAT router for the Mac; it
only masquerades the separate hotspot subnet (`10.5.50.0/24`). The Mac's gateway is the
**home router**, never the MikroTik.

When the home router's LAN is fixed (e.g. an ISP router locked to `192.168.0.x`), move
the MikroTik to match it. Every place the old subnet/IP appears — the full checklist that
will otherwise cost you an afternoon:

| #   | What                      | Where / command                                                                     |
| --- | ------------------------- | ----------------------------------------------------------------------------------- |
| 1   | MikroTik bridge address   | `/ip address set [find interface=bridgeLocal] address=192.168.0.161/24`             |
| 2   | Default route gateway     | `/ip route set [find dst-address=0.0.0.0/0] gateway=192.168.0.1`                    |
| 3   | Walled garden             | `/ip hotspot walled-garden ip remove [find]` then re-add `dst-address=192.168.0.15` |
| 4   | IP binding (bypass)       | remove old, `/ip hotspot ip-binding add address=192.168.0.15 type=bypassed`         |
| 5   | Firewall **forward** rule | `dst-address=192.168.0.15` (§10.3)                                                  |
| 6   | Firewall **input** rule   | `src-address=192.168.0.15` (§10.4)                                                  |
| 7   | Mac static IP + gateway   | `192.168.0.15` / gw `192.168.0.1` (gateway = home router)                           |
| 8   | login.html redirect       | `http://192.168.0.15:8080/portal/login`, re-upload                                  |
| 9   | Backend `.env`            | `MIKROTIK_IP=192.168.0.161` + restart backend                                       |

The dynamic (`D`-flagged) hotspot filter/NAT rules regenerate themselves and will briefly
show BOTH old and new addresses until the hotspot service restarts or host entries time
out — that's cosmetic, not a fault.

**Then verify the path** from the MikroTik terminal (§17.3):

```routeros
/ping 192.168.0.1 count=3     # home router
/ping 8.8.8.8 count=3         # internet by IP
/ping google.com count=3      # DNS
```

All three passing = network layer solid; remaining issues are backend/portal-side.

---

## 11. HTTP-PAP vs HTTP-CHAP — Full Explanation

MikroTik supports two hotspot authentication modes:

### HTTP-PAP (what we use)

- Password sent in the form POST as plain text
- Simple — our portal sets `document.getElementById('mt-pass').value = voucher_code`
- Works perfectly with our setup

### HTTP-CHAP (MikroTik default — why we avoided it)

- MikroTik injects a `chap-id` (1 raw byte) and `chap-challenge` (raw bytes, typically 16)
  into the login page via `$(chap-id)` and `$(chap-challenge)` template variables
- The browser must compute: `MD5(chap_id_byte + plain_password + challenge_bytes)`
- **Problem 1:** When passed through URL parameters (as our redirect does), `$(chap-id)`
  and `$(chap-challenge)` are raw bytes. URL encoding changes them. The received values
  on our Express side are URL-decoded strings, not the original bytes. Recomputing MD5
  from these produces the wrong hash.
- **Problem 2:** `$(chap-id)` in URL context is a single raw byte character, not a
  decimal string. Doing `parseInt(chapId)` gives NaN; `chapId.charCodeAt(0)` gives the
  byte value but only if the URL encoding preserved it exactly.
- **Conclusion:** CHAP is reliable only when the login page runs natively from the router
  (not via a redirect), where MikroTik injects the raw bytes directly into the HTML.
  Since we redirect, PAP is the correct choice.

---

## 12. Full MikroTik Setup Command Sequence (Clean Install)

Run these in order on a fresh or reset MikroTik hotspot:

```routeros
# 1. Switch hotspot to PAP authentication
/ip hotspot profile set hsprof3 login-by=http-pap

# 2. Add walled garden entry for backend
/ip hotspot walled-garden ip add dst-address=192.168.0.15 action=accept

# 3. Add firewall forward rule
/ip firewall filter add \
  chain=forward \
  src-address=10.5.50.0/24 \
  dst-address=192.168.0.15 \
  action=accept \
  place-before=0 \
  comment="hotspot-to-billing-backend"

# 4. Verify NAT masquerade exists (do NOT run if it already exists)
/ip firewall nat print
# Only add if missing:
# /ip firewall nat add chain=srcnat action=masquerade src-address=10.5.50.0/24

# 5. Upload login.html (see §3)

# 6. Add test user matching a real voucher code
/ip hotspot user add name=<VOUCHER_CODE> password=<VOUCHER_CODE>
```

---

## 13. RouterOS API Integration — COMPLETED

**Status: DONE.** The system automatically creates, syncs, and removes MikroTik hotspot
users via the RouterOS binary API. No manual `/ip hotspot user add` ever needed.

### 13.1 Enable API service on MikroTik

```routeros
/ip service set api disabled=no port=8728
```

### 13.2 Create a dedicated API user

```routeros
/user add name=billing-api password=<STRONG_PASSWORD> group=full
```

### 13.3 Backend `.env` variables

```
MIKROTIK_IP=192.168.0.161
MIKROTIK_API_USER=billing-api
MIKROTIK_API_PASS=your-strong-password
```

Each router in the DB stores its own `ipAddress`, `apiUsername`, and `apiPasswordEncrypted`
(AES-256 encrypted). The env vars above are only needed for testing; production reads
credentials from the `routers` table.

### 13.4 Key service files

| File                                    | Purpose                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `backend/src/services/mikrotik.ts`      | Low-level RouterOS API — connect, create user, remove user, kick session       |
| `backend/src/services/router-sync.ts`   | High-level orchestration — push vouchers to venue routers, kick, remove        |
| `backend/src/services/live-monitor.ts`  | Background daemon — polls active sessions, marks disconnected clients          |
| `backend/src/services/expiry-daemon.ts` | Background daemon — finds expired vouchers, marks expired, removes from router |

### 13.5 Automatic triggers

| Event                           | Action                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Voucher batch generated         | `pushVouchersToVenueRouters` — pushes all new codes to every router in venue       |
| New router added via admin      | `syncNewRouter` — pushes all existing venue vouchers to the new router             |
| Admin clicks "Sync" on a router | `syncNewRouter` called manually                                                    |
| Admin terminates a session      | `kickVoucherFromVenueRouters` — kicks the active session from MikroTik immediately |
| Voucher deleted                 | `removeVoucherFromVenueRouters` — kicks then removes the user from MikroTik        |
| Voucher expires (cron)          | Expiry daemon calls `removeHotspotUser` to clear the user from MikroTik            |

### 13.6 `limit-uptime` — Hardware-level time enforcement

When a package has `durationHours`, the backend sets `limit-uptime` on the MikroTik
hotspot user. MikroTik disconnects the user automatically when the limit is reached —
no polling needed.

**Format:** `DdHH:MM:SS` — e.g. `1d00:00:00` (24h), `02:00:00` (2h), `0d30:00:00` (30 min)

```typescript
function hoursToRosUptime(hours: number): string {
  const totalSeconds = Math.round(hours * 3600);
  const days = Math.floor(totalSeconds / 86400);
  const hh = String(Math.floor((totalSeconds % 86400) / 3600)).padStart(2, "0");
  return days > 0 ? `${days}d${hh}:00:00` : `${hh}:00:00`;
}
// Applied as:  '=limit-uptime=' + hoursToRosUptime(durationHours)
```

### 13.7 RouterOS API — firmware-specific parameter limitations

These per-user parameters are **not accepted on every board**, and passing them anyway makes
`/ip/hotspot/user/add` fail with `unknown parameter`:

- `=shared-users=` — device limit
- `=rate-limit=` — speed cap

**Accepted on every board tested:**

- `=name=` — username
- `=password=`
- `=limit-bytes-total=` — data cap in bytes
- `=limit-uptime=` — time cap

> #### ⚠️ It is NOT simply "RouterOS 6 rejects them, RouterOS 7 accepts them"
>
> This section used to say the limitation was a 6.x thing and that on 7.x per-user
> `=rate-limit=` "is generally accepted", with a note to re-test before assuming otherwise.
>
> **Measured on 2026-08-11 — that is wrong.** On the hAP lite (`smips`) running
> **RouterOS 7.23.2**, `/ip/hotspot/user/add` rejects **both** `=rate-limit=` and
> `=shared-users=`:
>
> ```
> ✗ /ip/hotspot/user/add =name=… =password=… =limit-uptime=00:00:01 =rate-limit=1M/1M =shared-users=1
>   → unknown parameter rate-limit
> ```
>
> So the constraint tracks the **board/build**, not the major version. Do not infer it from
> `/system resource print`.

**What the code does about it.** `deriveCapabilities` in `probe.ts` can only *guess* from the
version, so it guesses optimistically (`v7 ⇒ supported`) — and on a board like the above that
guess is wrong. Two mechanisms cover it:

1. `createHotspotUser` catches `unknown parameter`, drops the optional params and retries, so a
   sale never fails because of this. It costs an extra round-trip and logs a warning.
2. The **self-test** (`verify.ts`, phase 6 of Set up, or "Check it's serving") creates a
   throwaway voucher *with* those params. When the board rejects them it records the measured
   truth into `routers.capabilities`, so subsequent vouchers skip the doomed attempt and speed
   limits move to hotspot-**profile** level instead.

`mergeCapabilities` then makes that measurement stick: a capability measured `false` is never
overwritten by a later probe's optimistic `true`. Without that latch every re-provision would
undo the discovery.

**Consequence worth knowing:** on a board that rejects `=rate-limit=`, per-voucher speed caps do
not exist. Until the self-test has run and the profile-level limits step has been applied, those
users are uncapped — different packages behave identically. Run Set up (or "Check it's serving")
on any board where speed tiers matter.

### 13.8 RouterOS API connection timeout caveat

The `routeros` npm library's `timeout` option applies to the **keepalive interval**,
not the TCP connect timeout. If MikroTik is unreachable, the library hangs indefinitely.

**Fix:** Wrap every `connectToRouter` call in `Promise.race` with a manual setTimeout:

```typescript
const conn = (await Promise.race([
  connectToRouter(creds),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Router connection timeout")), 5000),
  ),
])) as RouterConn;
```

### 13.9 `running=false` on an idle AP — and the DHCP server that believes it

**Measured on an hAP lite, RouterOS 7.23.2, immediately after a clean provision.** The hotspot
worked — a phone associated, got a lease and loaded the portal — but every read of the router said
it could not possibly work:

```
/ip dhcp-server print detail
  name="wbs-hs-dhcp" interface=wlan1 invalid=yes   .about="Interface not running"

/interface wireless print detail
  name="wlan1" disabled=no running=false           # ← the cause

/interface wireless monitor wlan1 once
  status: running-ap                               # ← the truth
  channel: 2412/20/gn(18dBm)
  registered-clients: 0
```

On legacy `/interface wireless` in AP mode, the interface's **`running` property tracks associated
clients, not transmission**. Beaconing to an empty room is `running=false`. `/ip dhcp-server` reads
that same property and marks itself `invalid`, so a freshly provisioned hotspot always reads as
broken until the first device connects, then silently fixes itself.

`monitor` is the only honest source. Two consequences for this codebase:

- **Never assert `running` on a radio.** `verify.ts`'s radio check asserts `mode` instead, and its
  DHCP check now reads `.about` plus `monitor` before deciding — a bare `invalid=yes` cannot tell
  "broken" from "idle". This is the second false positive the same property has caused.
- **Provisioning sets `disable-running-check=yes`** on the hotspot radio (step
  `hotspot-radio-running-check`), which pins `running=true` and stops the DHCP server reporting
  invalid at all. Non-critical, and legacy-only — wifiwave2 has no such property, which is why it
  lives in `dialect.ts` as `runningCheckField`.

The cost of not doing this is not a broken hotspot; it is an admin opening WinBox, seeing a red
`invalid` flag on a working router, and "fixing" it.

### 13.10 Where the speed cap lives when the user cannot hold it

Measured on the hAP lite (7.23.2): `/ip hotspot user` rejects **both** `rate-limit` and
`shared-users`, but `/ip hotspot user profile` accepts both:

```
/ip hotspot user add name=X rate-limit=2M/2M          →  unknown parameter
/ip hotspot user profile add name=Y rate-limit=2M/2M shared-users=3   →  OK
/ip hotspot user profile add name=Y comment=wbs:x     →  unknown parameter comment
```

So on such a board the cap has to ride a profile, and the profile has no comment field — the `wbs-`
name prefix is the only tag available.

**One profile per package, not per router.** Two packages on one router need different speeds, so a
single router-level profile cannot express them. The name is `wbs-pkg-<packageId>`, from the id and
not the package name, so a rename cannot orphan the profile its vouchers point at. 44 characters for
a UUID; verified accepted and read back unchanged.

`router-sync.ts` creates it at voucher-push time (provisioning does not know a venue's packages), and
`createHotspotUser` sends `=profile=` — ordered before `rate-limit`/`shared-users` so the
retry-without-optional-params fallback cannot strip it.

To read the state of a router:

```routeros
/ip hotspot user print detail where name~"^WIFI-"     # which profile each voucher is on
/ip hotspot user profile print                        # what each profile actually caps
```

A voucher showing `profile=default` on a board that rejects per-user `rate-limit` has **no cap at
all** — that was the bug in §15, and it is what the self-test now fails on.

> **The general lesson.** Every check in `verify.ts` used to read a command back and call that
> success. Reading configuration back is not the same as a limit being enforced, and the difference
> was a paying customer getting the entire uplink while the dashboard showed green.

### 13.11 Throttling is a profile *swap*, never a rate-limit write

Peak-hour and after-N-GB throttling used to call `/ip hotspot user set =rate-limit=…` on the live
user. That is the exact command §13.10 measures as rejected on this hardware, so on the hAP lite it
could never take effect — and because the caller only recorded the new state *after* the write
returned, the rejected command went back out on every 5-second poll, indefinitely. On a 32MB smips
board that is a real CPU cost for a feature that was doing nothing.

Each throttleable package therefore gets **two** profiles:

```
wbs-pkg-<packageId>    full speed      (rateLimitFor)
wbs-thr-<packageId>    throttled speed (throttledRateLimitFor)
```

Both 44 characters — the length already verified accepted here. Throttling moves the voucher between
them with `/ip hotspot user set =profile=…`, which every board tested accepts.

Three things that follow, each of which was a bug waiting to happen:

- **The throttled state needs its own profile, not an edit of the shared one.** `wbs-pkg-<id>` is
  shared by every voucher on the package; throttling one customer by editing it throttles all of
  them.
- **Both profiles exist even on a board that accepts per-user `rate-limit`.** Otherwise
  un-throttling would have to send the user back to `default`, which has no cap at all — the
  customer would leave the throttle window *faster* than their package allows.
- **A voucher push must treat the throttled profile as correct.** `repairProfile` passes it as an
  acceptable current profile, or the next sync would yank a throttled customer back to full speed
  mid-window.

**The swap alone only governs the next login.** RouterOS builds a hotspot session's dynamic queue
when the user authenticates, so a running session keeps the limit it started with. The live monitor
therefore kicks the session after a successful swap — and only when the profile actually changed,
because kicking someone to re-apply a limit they already have is pure harm. The portal's
auto-reconnect path logs a device with a live voucher straight back in, so the customer sees a blip
rather than a login screen.

> **Not yet verified on hardware.** The board was unreachable when this was written, so the profile
> swap, the 44-character `wbs-thr-` name and the kick-to-apply behaviour are reasoned from §13.10's
> measurements rather than measured themselves. `ensureHotspotUserProfile` reads the profile back and
> throws if the router did not keep it, so a rejected name fails loudly rather than silently
> uncapping anyone — but confirm on a live board before relying on throttling in production.

---

## 14. Quick Reference — Useful MikroTik Commands

### 14.0 Essential diagnostics (run these first when troubleshooting)

```routeros
# Show all physical interfaces + their MAC addresses
/interface print

# Show all IP addresses on each interface
/ip address print

# Show default route (confirms internet path)
/ip route print

# Show DNS config (MUST have servers set — empty = no DNS for clients)
/ip dns print

# Show all hosts detected on hotspot network (unauthenticated + authenticated)
/ip hotspot host print

# See all hotspot users
/ip hotspot user print

# See currently connected hotspot clients
/ip hotspot active print

# Watch live hotspot log
/log print follow where topics~"hotspot"

# See hotspot profile settings
/ip hotspot profile print

# See walled garden entries
/ip hotspot walled-garden ip print

# See firewall forward rules
/ip firewall filter print where chain=forward

# See NAT rules
/ip firewall nat print

# Kick a connected user (e.g. for testing)
/ip hotspot active remove [find mac-address=XX:XX:XX:XX:XX:XX]

# Remove all hotspot test users (careful in production)
/ip hotspot user remove [find]

# Check what's listening on the router
/ip service print
```

---

## 15. Summary of All Bugs We Hit and Their Fixes

| Bug                                                                           | Root Cause                                                                                     | Fix                                                                                                            |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ERR_ADDRESS_UNREACHABLE` on phone                                            | Laptop DHCP IP changed                                                                         | Set static IP (§1); update login.html, walled garden, firewall rule (§10)                                      |
| `/ip hotspot` → `no such command or directory` on RouterOS 7                  | RouterOS **7.20+ moved hotspot out of the core build** on smips (and other small-flash architectures) into a separate Extra package. An upgrade across that boundary silently removes the subsystem — config/files survive, the hotspot chain is renamed `unused-hs-chain` | Download `hotspot-<exact-version>-<arch>.npk` from mikrotik.com/download → Extra packages (version and release channel must match `/system resource print` exactly), upload to Files, reboot. **Not** a reason to downgrade or replace the board |
| `/ip hotspot` missing and the .npk didn't help                                | device-mode `home`/`basic` hides the menu regardless of packages                                | `/system device-mode print`; if `hotspot: false` → `/system device-mode update mode=advanced`, then confirm within 5 min via reset button or power-cycle |
| WinBox `MacConnection syn timeout` over ethernet, but works over WiFi         | Manual IPv4 set on the ethernet NIC with a **blank subnet mask** — macOS discarded the whole config, leaving the interface with no address and no route | Fill in mask AND router (§1.1); verify with `ifconfig en7 \| grep inet`, not the "Connected" label in the Network pane |
| `No 'Access-Control-Allow-Origin' header` (admin panel)                       | Express `app.use()` regex path doesn't intercept OPTIONS preflight                             | Change to string paths: `app.use("/api", adminCors)` (§7)                                                      |
| `password is not chap encrypted` (MikroTik log)                               | Hotspot in CHAP mode, plain text sent                                                          | `/ip hotspot profile set hsprof3 login-by=http-pap` (§2.2)                                                     |
| `invalid username or password` after CHAP attempt                             | CHAP hash wrong due to raw-byte encoding mismatch through URL params                           | Switch to PAP — see §11 for full explanation                                                                   |
| `invalid voucher code` (portal error)                                         | Voucher code doesn't exist in MySQL database                                                   | Generate vouchers from admin panel; use an active code from the DB                                             |
| Portal validates but redirects back to login                                  | Voucher code exists in DB but NOT in MikroTik's user list                                      | `/ip hotspot user add name=<CODE> password=<CODE>` (§8)                                                        |
| Duplicate firewall/walled garden rules                                        | Command ran twice by accident                                                                  | Remove by index: `/ip firewall filter remove 1`                                                                |
| Phone can reach portal but gets no internet after auth                        | NAT masquerade missing for hotspot subnet                                                      | `/ip firewall nat add chain=srcnat action=masquerade src-address=10.5.50.0/24` (§6)                            |
| CAP disabled warning                                                          | CAPsMAN controller mode — not relevant for standalone hotspot                                  | Leave CAP disabled; it's correct for non-CAPsMAN setup                                                         |
| Phone gets IP on hotspot but "no internet" — browser shows "server not found" | MikroTik's DNS was completely unconfigured (`servers:` field empty)                            | `/ip dns set servers=8.8.8.8,8.8.4.4 allow-remote-requests=yes` (§16)                                          |
| MikroTik can ping its gateway (192.168.0.1) but cannot reach 8.8.8.8          | ISP/upstream router has a MAC address whitelist — MikroTik's MAC wasn't on it                  | Add MikroTik's bridgeLocal MAC to ISP router's whitelist (§17)                                                 |
| RouterOS API call hangs forever when router is unreachable                    | `timeout` in the `routeros` npm library sets keepalive interval, NOT TCP connect timeout       | Wrap `connectToRouter` in `Promise.race` with a 5s `setTimeout` (§13.8)                                        |
| `unknown parameter` error when creating hotspot user                          | Passing `=shared-users=` or `=rate-limit=` on old firmware (hAP Lite / RouterOS 6.x)           | Remove those params — only supported at profile level on old firmware (§13.7)                                  |
| Admin terminates a session in dashboard but device still has internet         | Terminate endpoint only updated DB; never called MikroTik API                                  | `kickVoucherFromVenueRouters` fire-and-forget added to terminate endpoint                                      |
| Session shows "connected" after device disconnects                            | Live monitor polled router but never reconciled DB sessions against active list                | Added reconciliation loop in `pollOnce` — marks DB "connected" sessions absent from MikroTik as "disconnected" |
| Duration shows negative value (e.g. "-47m")                                   | `formatDuration` passed `durationSeconds = 0` or negative (race between endedAt and startedAt) | Added `if (seconds <= 0) return "0m"` guard; `Math.max(0, ...)` in terminate endpoint                          |
| "10.5.50.254 refused to connect" when testing                                 | User was trying to open their phone's own IP in the browser, not the hotspot gateway           | The hotspot gateway/portal is at `192.168.0.15:8080`, not the phone's own IP                                   |
| Backend server itself was intercepted by hotspot firewall                     | MikroTik treated backend server as an unauthenticated hotspot client                           | Add IP binding: `/ip hotspot ip-binding add address=192.168.0.15 type=bypassed` (§16.3)                        |
| Duplicate masquerade rules in NAT                                             | Multiple hotspot setup/wizard attempts each added their own masquerade rule                    | Harmless but messy — remove duplicates with `/ip firewall nat remove <index>`                                  |
| Bootstrap script applied everything **except** the radio, with no visible error | The generated `§7` radio stanza was a single **1038-character** line; the RouterOS console truncates a pasted line at ~1024 bytes, so it became a syntax error whose message scrolled away with the session the bridge step had already dropped | One short, self-contained statement per menu — no line over 512 chars, no line depending on a `:local` another line set. `bootstrap.test.ts` enforces both. `/import` of the `.rsc` is unaffected by the limit |
| DHCP server `invalid=yes` on a hotspot that demonstrably works                 | On legacy `/interface wireless`, `running` tracks **associated clients**, not transmission; `/ip dhcp-server` copies that flag. `monitor` said `status=running-ap` at the same moment | `disable-running-check=yes` on the hotspot radio (step `hotspot-radio-running-check`), and `verify.ts` reads `.about` + `monitor` before failing (§13.9) |
| Verify reported a voucher "with speed and device limits" that had neither      | The check inferred success from *no rejection this run*, but once capabilities are latched to false the params are never sent, so nothing is rejected | Report from the params actually sent, not from the absence of an error |
| Set up aborted on a freshly reset board: `Firewall — hotspot clients → backend (§5): no such item` | Both firewall steps sent `=place-before=0`. `place-before` needs an item that exists — an `.id` works, an index past the end is rejected. On a clean board the step runs moments after the hotspot server is created, before RouterOS has populated its dynamic rules, so index 0 is empty. Both steps are critical, so the run stopped before the portal pages were uploaded. It passed the *first* clean-board test because the list had settled by then | `addRuleFirst` resolves the current first rule's real `.id`, and adds without `place-before` when the list is empty |
| Every voucher had **no speed cap** on a board that rejects per-user `rate-limit`, on a router whose Set up reported `ok: true` | `createHotspotUser` never sent `=profile=`, so vouchers sat on `default`. The `wbs-hs-users` profile provisioning created carried `shared-users=1` and no rate-limit, and nothing was assigned to it. Every check verified *configuration* — a command read back — and none verified *enforcement* | Per-package profile `wbs-pkg-<packageId>` carrying the package's `rate-limit`, created by `router-sync.ts` at push time, with existing vouchers moved onto it; the self-test now asserts a cap is actually in force and fails if it is not (§13.10) |
| Router form saved `ssid = NULL` even though the SSID was typed in              | It was typed into the bootstrap dialog, whose SSID field was local state with no write-back to the form (unlike the API password). `hotspot-radio-ssid` is skipped when the column is null | `onSsidChosen` callback mirroring `onPasswordGenerated`, wired into the create and edit pages |

---

## 16. MikroTik Network Setup — Static IP, DNS, and IP Binding

### 16.1 Setting a static IP on MikroTik itself

**Why:** In our setup, MikroTik's LAN IP kept changing (DHCP from ISP router). The backend
stores the router IP in DB — if it changes, the API connection breaks.

First, identify the interface that faces the LAN (usually `bridgeLocal` or `ether1`):

```routeros
/interface print
/ip address print
```

Disable the DHCP client on that interface (if active):

```routeros
/ip dhcp-client print
# Note the number of the entry for bridgeLocal, e.g. 0
/ip dhcp-client disable 0
```

Add a static address:

```routeros
/ip address add address=192.168.0.161/24 interface=bridgeLocal
```

Add the default route pointing to ISP router:

```routeros
/ip route add gateway=192.168.0.1
```

> **Error "cannot change dynamic address"** — this happens if you try to set/change
> an address while a DHCP client is running on that interface. Disable the DHCP client
> first, then add the static address.

### 16.2 Configure DNS — MANDATORY

Fresh MikroTik installations have **no DNS servers configured** (`servers:` field is
empty). Hotspot clients request DNS through MikroTik (hotspot DNS rules redirect port 53
to the router). If MikroTik can't resolve names, clients see "server not found" on every
domain, even though they have an IP and can technically reach the internet.

```routeros
/ip dns set servers=8.8.8.8,8.8.4.4 allow-remote-requests=yes
```

Verify:

```routeros
/ip dns print
# servers: 8.8.8.8,8.8.4.4
# allow-remote-requests: yes
```

This must be done once after initial hotspot setup. Without it, the portal works but
clients see no websites after authentication.

### 16.3 IP Binding — Bypass hotspot firewall for backend server

If the backend server is on the same LAN segment that MikroTik's hotspot is monitoring,
MikroTik may treat it as an unauthenticated hotspot client and block its connections
(including RouterOS API connections from the backend TO MikroTik).

Fix: tell MikroTik to bypass hotspot processing for the backend server's IP:

```routeros
/ip hotspot ip-binding add address=192.168.0.15 type=bypassed
```

Verify:

```routeros
/ip hotspot ip-binding print
```

The `type=bypassed` means: "this device is not a hotspot customer, let all its traffic
through unconditionally."

---

## 17. ISP Router / Internet Access Requirements

### 17.1 MikroTik is NOT the internet gateway

This is the most common conceptual confusion. In our setup:

```
ISP Router (192.168.0.1)  ← This provides internet access
       ↑
MikroTik (192.168.0.161)  ← This provides WiFi hotspot, sits behind ISP router
```

MikroTik needs internet access itself to forward hotspot client traffic. MikroTik's
WAN-side port is a LAN port on the ISP router.

### 17.2 ISP router MAC whitelist

Some ISP routers (especially home/residential routers from local ISPs) restrict which
devices can use them — only whitelisted MAC addresses get internet access.

**Symptom:** MikroTik can ping `192.168.0.1` (ISP router, same LAN) but cannot ping
`8.8.8.8` (internet). Default route exists. Everything looks correct but internet is
still unreachable.

**Fix:** Find MikroTik's MAC address on the interface that faces the ISP router:

```routeros
/interface print
# Look for bridgeLocal or ether1 — note the MAC address column
# e.g. D4:01:C3:4A:38:F4
```

Then log in to the ISP router admin panel and add that MAC to the whitelist (the exact
location varies by ISP router model — often under "LAN clients", "MAC filter", or
"Access control").

Once whitelisted, all hotspot clients get internet through MikroTik's masquerade NAT.

### 17.3 Verifying the internet path step by step

Use these commands in MikroTik terminal to isolate where connectivity breaks:

```routeros
# 1. Can MikroTik reach ISP router? (same LAN)
/ping 192.168.0.1 count=3

# 2. Can MikroTik reach internet? (if this fails → ISP router block or DNS issue)
/ping 8.8.8.8 count=3

# 3. Can MikroTik resolve DNS? (if step 2 works but this fails → dns misconfigured)
/ping google.com count=3
```

If step 1 works but step 2 fails → ISP router is blocking MikroTik (MAC whitelist issue).
If step 2 works but step 3 fails → DNS not configured (see §16.2).
If all work → MikroTik has internet; if clients still don't, check masquerade NAT (§6).

---

## 18. alogin.html — After-Login Connected Page

### 18.1 What it is

`alogin.html` is MikroTik's template page shown **after successful authentication**,
before the client is redirected to their original destination. MikroTik substitutes
template variables into the HTML before serving it.

Available template variables:

| Variable               | Value                                      |
| ---------------------- | ------------------------------------------ |
| `$(username)`          | The hotspot username (voucher code)        |
| `$(link-orig)`         | The URL the user originally tried to visit |
| `$(mac)`               | Client's MAC address                       |
| `$(ip)`                | Client's IP address                        |
| `$(session-time-left)` | Remaining session time                     |

> **It no longer claims success on faith.** The page opens in a "Checking your
> connection" state and only says "You're connected" after a real reachability probe
> passes — it loads an image from an external host (google.com / cloudflare.com favicon,
> cache-busted). Reaching the backend proves nothing, because the backend is inside the
> walled garden and answers even when no internet was granted. `fetch()` is unsuitable
> here too: a cross-origin request returns an opaque response whose status can't be read,
> so an intercepted request is indistinguishable from a successful one. An image either
> decodes or it doesn't. On failure the page retries once after 2s, then shows
> "Not connected yet" with a **Check again** button instead of a false positive.
>
> The script deliberately avoids `async`/`await` — captive-portal mini-browsers on older
> Android WebViews predate ES2017.

> **Remaining time / data.** The page shows a live countdown and a data bar, fed by
> `GET /portal/session-status?mac=`, re-synced every 30s. Two deliberate choices:
>
> - The countdown ticks from the last server figure using *elapsed time since that sync*,
>   never by comparing the client clock to an absolute expiry — a device with a wrong
>   clock would show nonsense. When it reaches zero the client does **not** declare
>   expiry; it asks the server, which decides whether to send the user back to the portal.
> - The time shown is **wall-clock** (`vouchers.expires_at`). MikroTik separately enforces
>   `limit-uptime`, which counts accumulated online time and diverges whenever a user
>   disconnects and returns. Wall-clock always elapses faster, so displaying it can never
>   promise more time than the user actually has.
>
> The endpoint deliberately does not return the voucher code — the code is also the
> hotspot password, and that endpoint is public and keyed only by a spoofable MAC.

### 18.2 Creating the file

The file lives at `mikrotik-files/alogin.html` in this repo. Design principles to match
the admin UI:

- Background: `#f4efe9` (warm cream — same as admin)
- Accent: `#e05c2b` (orange — same as admin buttons)
- Card: white with `#e8dcd5` border
- Font: system-ui stack (same as admin)

### 18.3 Handling `$(link-orig)` safely

MikroTik substitutes `$(link-orig)` as a raw string. When no original URL is available,
it stays as the literal text `$(link-orig)`. Always guard against this:

```javascript
var raw = "$(link-orig)";
var dest = raw && raw.indexOf("$(") === -1 && raw.length > 0 ? raw : "http://google.com";
```

This prevents the page from redirecting to a literal `$(link-orig)` string.

### 18.4 Uploading to MikroTik

Via Winbox:

1. Open **Files** in Winbox
2. Navigate to `hotspot/` folder
3. Drag and drop `alogin.html` — it overwrites the existing file

Via terminal (if file is already on router):

```routeros
/file print where name~"hotspot"
# Note the full name, e.g. hotspot/alogin.html
```

Verify upload:

```routeros
/file print where name~"alogin"
# Should show the file with correct size
```

### 18.5 Auto-redirect timing

The current implementation auto-redirects after 4 seconds using a CSS animation on the
progress bar plus a JavaScript `setTimeout`. The CSS animation is purely decorative —
the JS timeout is what triggers the redirect.

```javascript
setTimeout(function () {
  window.location.replace(dest);
}, 4000);
```

> **Why we need this page:** Without a custom `alogin.html`, MikroTik shows its own
> default "you are logged in" page which looks completely out of place (plain HTML,
> MikroTik branding). A custom page provides continuity with the portal's look and feel.

---

## 19. Session Lifecycle — Live Monitoring, Disconnect Detection, Admin Kick

### 19.1 Session states

| State          | Meaning                                                                       |
| -------------- | ----------------------------------------------------------------------------- |
| `connected`    | Voucher validated, user currently authenticated on MikroTik                   |
| `disconnected` | User's device left the hotspot (detected by live monitor)                     |
| `expired`      | `expiresAt` passed — expiry daemon marks it expired and removes from MikroTik |
| `terminated`   | Admin manually terminated via dashboard                                       |

### 19.2 Live monitor — how disconnect detection works

`backend/src/services/live-monitor.ts` runs every 30 seconds:

1. For each venue, connect to each router and call `/ip/hotspot/active/print`
2. Collect all currently active usernames into a `Set<string>` per venue
3. Query DB for all `connected` sessions in those venues
4. Any session whose voucher code is NOT in the active set → mark `disconnected` with `endedAt = now`

**Critical implementation detail:** When multiple routers in a venue are polled in
parallel (`Promise.allSettled`), initialize the per-venue `Set` BEFORE the parallel
callbacks run. Otherwise one callback's `activeByVenue.set(venueId, new Set())` can
overwrite another callback's results:

```typescript
// Pre-initialize sets for all venues BEFORE parallel polling
for (const router of allRouters) {
  if (!activeByVenue.has(router.venueId)) {
    activeByVenue.set(router.venueId, new Set());
  }
}
// Now safe to do parallel .add() calls — sets already exist
await Promise.allSettled(
  allRouters.map(async (router) => {
    const codes = await getActiveUsernames(router);
    const set = activeByVenue.get(router.venueId)!;
    codes.forEach((c) => set.add(c));
  }),
);
```

### 19.3 Admin terminate — kicking the device immediately

When an admin clicks "Terminate" on a session:

1. DB: session status updated to `terminated`, `endedAt` set
2. MikroTik: `kickHotspotSession` is called fire-and-forget — removes the entry from
   `/ip/hotspot/active` which immediately drops the device's internet access

`kickHotspotSession` vs `removeHotspotUser`:

- **kick** (`/ip/hotspot/active/remove`): drops the current session. The user account
  still exists in `/ip/hotspot/user` — the device could log in again if the voucher is
  still valid in DB.
- **remove** (`/ip/hotspot/user/remove`): deletes the user account. The device cannot
  log in again on this router until the account is re-created.

Admin terminate uses **kick only** — the DB marks the session terminated, so the portal
will reject any re-login attempt regardless.

### 19.4 Device type detection

MikroTik does not report device type. Detection happens by parsing the User-Agent string
at login time (`POST /portal/validate-voucher`). The result is stored in the `wifiSessions`
and `wifiCustomers` tables as `deviceType` (`phone` / `tablet` / `desktop`) and
`deviceName` (e.g. `iPhone`, `Samsung Galaxy`, `Windows PC`).

Pattern priority (highest to lowest):

1. iPad → tablet
2. iPhone → phone / `iPhone`
3. Android mobile → phone / manufacturer name from UA
4. Windows → desktop / `Windows PC`
5. Mac → desktop / `Mac`
6. Linux → desktop / `Linux`
7. Fallback → `Unknown Device`

The detection is best-effort. The important thing is that it happens at the session
boundary (login time) so it does not add latency to subsequent requests.
