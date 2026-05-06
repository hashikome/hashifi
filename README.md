# HashiFi 🔥📶
_“WiFi by the bonfire” — Secure, smart, shared access._

**HashiFi** is a system for managing **time-bound, device-limited WiFi access** using QR codes, subscriptions, and captive-portal style access control. It is designed for individuals and small businesses such as hotels, homes, coworking spaces, shops, and shared compounds that want controlled internet sharing without constant manual password changes.

---

## 🏢 Company

> 📢 **Developed and maintained by [SHIKOME TECHNOLOGY LIMITED]**, a Tanzania-registered technology company building community-first digital solutions.  
>  
> Website coming soon: [hashikome.com](https://hashikome.com) | [hashikome.co.tz](https://hashikome.co.tz)

HashiFi is currently in **private development**. Open source licensing will be considered in the future.

---

## 🌟 Features

- Generate WiFi access QR codes linked to subscriptions
- Support for daily, weekly, monthly or custom durations
- Device/session limits with optional MAC-address binding
- Manage access per router/location
- Admin dashboard and REST API
- Custom domain ready (e.g. `wifi.hashikome.com`)
- Router redirect compatible (for captive portal style access)

---

## 🌐 Network Reality

HashiFi is viable, but the full implementation should not depend on the basic router supplied by an ISP. Routers commonly provided by ISPs such as Vodacom, Tigo/Yas, and Airtel are best treated as internet uplinks. They usually handle the connection, WiFi name/password, and basic device management, but they should not be assumed to support custom captive portals, RADIUS accounting, per-user expiry, device limits, or external API control.

The recommended setup is:

```text
Internet / SIM / Fiber
        ↓
ISP router
        ↓
HashiFi-controlled router or gateway
        ↓
Guest WiFi / access points
        ↓
Customers
```

For a real MVP, HashiFi should target routers or gateways with hotspot/captive-portal support, external portal redirects, firewall/session control, and ideally RADIUS or API access. **MikroTik RouterOS** is the preferred first target because it supports hotspot workflows, users, sessions, queues, firewall rules, scripting, API access, and RADIUS integration.

Basic QR-code WiFi sharing can work with any ordinary router, but it does not reliably enforce subscriptions, expiry, device limits, or payment-based access. For more implementation detail, see [docs/network-architecture.md](docs/network-architecture.md).

---

## 📦 Tech Stack

- **Backend**: Django + Django REST Framework
- **Web Server**: Uvicorn (replacing Gunicorn for development and possibly production)
- **Dependency Manager**: [uv](https://docs.astral.sh/uv/) for fast, modern Python project management
- **Database**: PostgreSQL
- **Deployment**: Docker Stack + Traefik Reverse Proxy
- **Dev Environment**: Docker-integrated development (used in SHIKOME's Middleware project)
- **Client-Side Portal**: To be added (React/Svelte/HTML)
- **Router Target**: MikroTik first, with possible future support for OpenWrt, UniFi/Omada, pfSense, or OPNsense

---

## 🚀 Quickstart (Development)

> 💡 This project uses `uv` instead of pip or poetry for dependency management.

1. Clone the repo:
   ```bash
   git clone https://github.com/hashikome/hashifi.git
   cd hashifi
   ```

2. Initialize the project with `uv`:
   ```bash
   uv venv
   uv sync  # Install dependencies from pyproject.toml and uv.lock
   ```

3. Run the dev server with `uvicorn`:
   ```bash
   uv run uvicorn hashifi.asgi:application --reload
   ```

4. Environment config:
   ```bash
   cp .env.example .env
   # Edit to match your local/dev database, etc.
   ```

---

## 🌐 Deployment

> Production setup uses Docker Stack and Traefik with optional DNS pointing to `hashikome.com` or `hashikome.co.tz`.

- App and DB run in isolated containers
- Traefik acts as a reverse proxy, handles routing, SSL (Let's Encrypt), and service discovery
- Backend served via **Uvicorn** directly, though a fallback to Gunicorn remains open for consideration
- Docker-based dev environment ensures parity with production

---

## 🧠 Inspired By

Shikome — the tradition of sharing wisdom and stories around a bonfire.  
**HashiFi** brings that spirit to the digital age, with boundaries.

---

## 📄 License

Private — Not open source (yet).  
We may consider OSS licensing in the future under SHIKOME TECHNOLOGY LIMITED.

---

## 🔥 Maintained by

**SHIKOME TECHNOLOGY LIMITED**  
“Solutions that connect and empower.”  
Built with 🔥 by [@hashikome](https://github.com/hashikome)
