# HashiFi 🔥📶  
_“WiFi by the bonfire” — Secure, smart, shared access._

HashiFi is a Django REST-based system for managing **time-bound, device-limited WiFi access** using QR codes and subscription logic. It is designed for individuals and small businesses (e.g. hotels, homes, coworking spaces) that share internet access and want control without constant manual password changes.

---

## 🌟 Features

- Generate WiFi access QR codes linked to subscriptions
- Support for daily, weekly, monthly or custom durations
- Device locking using MAC address
- Manage access per router/location
- Admin dashboard and REST API
- Custom domain ready (e.g. `hashifi.namestarlit.com`)
- Router redirect compatible (for captive portal style access)

---

## 📦 Stack

- **Backend**: Django + Django REST Framework
- **QR Generation**: Built-in with `qrcode` and device tracking
- **Database**: PostgreSQL
- **Deployment**: VPS-ready, Nginx + Gunicorn + Docker
- **Client-Side Portal**: To be added (React/Svelte/HTML)

---

## 🚀 Quickstart (Development)

1. Clone the repo:
   ```bash
   git clone https://github.com/hashikome/hashifi.git
   cd hashifi
