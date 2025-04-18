```markdown
# HashiFi 🔥📶  
_“WiFi by the bonfire” — Secure, smart, shared access._

**HashiFi** is a Django REST-based system for managing **time-bound, device-limited WiFi access** using QR codes and subscription logic. It is designed for individuals and small businesses (e.g. hotels, homes, coworking spaces) that share internet access and want control without constant manual password changes.

---

## 🏢 Company

> 📢 **Developed and maintained by [SHIKOME LLC]**, a modern technology company building community-first digital solutions.  
>  
> Website coming soon: [hashikome.com](https://hashikome.com) | [hashikome.co.tz](https://hashikome.co.tz)

HashiFi is currently in **private development**. Open source licensing will be considered in the future.

---

## 🌟 Features

- Generate WiFi access QR codes linked to subscriptions
- Support for daily, weekly, monthly or custom durations
- Device locking using MAC address
- Manage access per router/location
- Admin dashboard and REST API
- Custom domain ready (e.g. `wifi.hashikome.com`)
- Router redirect compatible (for captive portal style access)

---

## 📦 Tech Stack

- **Backend**: Django + Django REST Framework
- **Web Server**: Uvicorn (replacing Gunicorn for development and possibly production)
- **Dependency Manager**: [uv](https://docs.astral.sh/uv/) for fast, modern Python project management
- **Database**: PostgreSQL
- **Deployment**: Docker Stack + Traefik Reverse Proxy
- **Dev Environment**: Docker-integrated development (used in SHIKOME's Middleware project)
- **Client-Side Portal**: To be added (React/Svelte/HTML)

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

Hashikome — the tradition of sharing wisdom and stories around a bonfire.  
**HashiFi** brings that spirit to the digital age, with boundaries.

---

## 📄 License

Private — Not open source (yet).  
We may consider OSS licensing in the future under SHIKOME LLC.

---

## 🔥 Maintained by

**SHIKOME LLC**  
“Solutions that connect and empower.”  
Built with 🔥 by [@hashikome](https://github.com/hashikome)
```
---
