# Onboarding a Router — Reset to Working Hotspot

**Use this whenever you put a new (or newly reset) MikroTik into service.** It works on any
model; the system detects the board and adapts.

```
1. Reset the router
2. Add the router in HashiFi and save it
3. Open its bootstrap script → paste it into the router
4. Set up router
5. Check a phone
```

> Written for the purchased system, and still the reference for steps on the router. Two things
> changed: the bootstrap script is generated for a saved router, because it carries that
> router's management tunnel ([ADR-0006](../engineering-decisions/0006-router-management-tunnel.md));
> and "test connection" only reaches a router the API shares a network with, so a router behind
> the tunnel is tested by its probe, after the script is pasted.

[mikrotik-hotspot-reference.md](mikrotik-hotspot-reference.md) is the *reference* — why each setting exists, and the manual
equivalent of every provisioning step. This file is the *procedure*. Do not follow the
reference's manual steps on a new router: it produces untagged config the provisioner cannot
manage.

---

## Why there is a manual step at all

Provisioning connects *through* four things, so it cannot create them: the **LAN address and
route**, the **API service and its user**, the **bridge**, and the **radio**. Everything else —
hotspot server and profile, pool, DHCP, DNS, walled garden, firewall, NAT, IP binding, the
portal pages, un-bridging and enabling the radio — is done for you, repeatably, and is safe to
re-run.

You do not write those four by hand. Step 2 generates the script for your board.

---

## Step 1 — Reset

> ⚠️ **Confirm you can reach the router by MAC in WinBox first** (Neighbors tab). After
> `no-defaults=yes` it has no IP address, so MAC is your only way back in.

```routeros
/system reset-configuration no-defaults=yes skip-backup=yes
```

`no-defaults` because the stock config makes `ether1` a WAN port; here `ether1` is a **LAN**
link to the ISP router, so the default config fights us.

A reset **keeps installed packages**, so a hotspot `.npk` you installed once survives it.

---

## Step 2 — Bootstrap

Open **Admin → Routers → Add Router**, fill in the router name, IP address and API username,
then press **Bootstrap script**. Do not save yet — you stay on this form for Step 3.

Copy what it gives you, reconnect with MAC-WinBox (user `admin`, blank password), and paste it
into a **New Terminal** (not the WinBox command bar). Or use **Download .rsc** and `/import`.

Leave the API Password blank and it generates a strong one and offers to fill it into the form,
so the router's password and the database's cannot drift apart.

The script is hardware-agnostic — it discovers the ethernet ports rather than assuming four,
and picks the wireless stack on the router at run time, so you do not need to know whether you
have a legacy `wlan1`, a wifiwave2 `wifi1`, or no radio at all. It is safe to paste twice. It
also removes any radio that is already a bridge port:

> **A radio must NOT be a bridge port.** The hotspot puts its gateway address directly on that
> interface; bridged, the addressing collides and the portal silently never intercepts.

It ends by pinging `8.8.8.8`. **No replies means stop here** — usually the `bridgeLocal` MAC is
not on the ISP router's whitelist (§17.2). Nothing downstream works without internet.

<details>
<summary>The manual equivalent — for a board where the script's radio line fails</summary>

```routeros
/user set admin password=<PICK_ONE>
/system identity set name=<ROUTER_NAME>

/interface bridge add name=bridgeLocal
/interface bridge port add bridge=bridgeLocal interface=ether1
/interface bridge port add bridge=bridgeLocal interface=ether2
/interface bridge port add bridge=bridgeLocal interface=ether3
/interface bridge port add bridge=bridgeLocal interface=ether4

/ip address add address=192.168.0.161/24 interface=bridgeLocal
/ip route add gateway=192.168.0.1

/ip service set api disabled=no port=8728
/user add name=billing-api password=<STRONG_PASSWORD> group=full

# Legacy /interface wireless boards:
/interface wireless set wlan1 disabled=no mode=ap-bridge band=2ghz-b/g/n ssid="<SSID>"
# wifiwave2 boards (most ARM on RouterOS 7) instead:
/interface wifi set wifi1 disabled=no configuration.mode=ap configuration.ssid="<SSID>"
# No radio (hEX, CRS): omit that line and name the ethernet or bridge interface in the
# Hotspot Interface field in Step 3.
```

The ethernet list is board-specific — 4 on an hAP lite, 5 on a hEX, 10 on an RB4011. Getting
that wrong is exactly what the generated script avoids.

</details>

---

## Step 3 — Test connection, then save

Press **Test connection** on the same form. It reads the board read-only, writes nothing, and
saves nothing — and it tells you the board and RouterOS version, whether it can run a hotspot,
**the exact plan** (which interface, which subnet, which gateway) or the reason provisioning
would refuse, plus every interface as a one-click choice for Hotspot Interface. On the edit form
you can leave the password blank and it uses the stored one.

Everything under **Hotspot Network** is optional; each field's help text says what happens if
you leave it blank. The two worth knowing:

- **Hotspot interface** — auto-detected. Set it only on a board with no radio (hEX, CRS), or
  when the board has several radios and you want a specific one. Auto-detection never falls back
  to a bridge, because that would put a captive portal on your LAN.
- **SSID** — set it and every Set up re-asserts the network name, so a radio someone turned off,
  renamed or bridged is repaired by pressing Set up rather than by a site visit.

> **Replacing an existing router?** Delete or edit the old record first — two rows pointing at
> the same IP means both sync to it. Deleting is safe for history (`router_id` on sessions is
> nulled, not cascaded) but the sessions lose their router link; edit the existing record if you
> want that preserved.

Saving pushes every existing voucher for that venue. That works before provisioning —
`/ip hotspot user` exists as soon as the package does.

---

## Step 4 — Set up

Routers list → the **wand icon** → **Set up router** (click twice to confirm).

Six phases run in order and stop at the first thing that would make the result wrong, listing
what to fix and how:

1. **Identify the board** — unreachable, bad credentials, or no hotspot support.
2. **Check the site is ready** — internet, backend reachable, interface usable, FastTrack off,
   hand-made config. **Nothing is written if this fails.** Every row names its own fix; amber
   means provisioning handles it, grey means it could not be checked — not that it passed.
3. **Preview every change** — a freshly reset board shows ~15 changes, 0 failures.
4. **Apply the configuration.**
5. **Prove it is repeatable** — a dry run that must report nothing left to do.
6. **Confirm the hotspot is actually serving** — including creating, reading back and removing a
   throwaway voucher. Phases 1–5 only prove the config reads back as asked; this one proves a
   customer would get online.

Phase 2 is a gate because the most damaging mistake is provisioning a router that cannot reach
the backend: `portal-files` is critical and runs **last**, so everything else is written before
anything complains. If you have read the reasons and want to proceed anyway, **Set up anyway**
appears after a run has reported them.

**Run steps individually** still exposes Probe, Dry run and Provision separately for debugging
one step. **Check it's serving** re-runs phase 6 alone against a router already in service.

---

## Step 5 — Check a phone

Phase 6 covers what a machine can. These need a real device:

- [ ] Phone connects to the SSID and gets an address in the hotspot range
- [ ] Captive portal appears and shows the branded page
- [ ] Reopening the hotspot address while online shows the branded **status page** — remaining
      time ticking, data used, and a working **Disconnect**
- [ ] A valid voucher on the portal reaches **"You're online"**, and the phone can browse.
- [ ] The countdown / data remaining displays and ticks down

The dialog lists these too, so nothing is dropped just because a machine could not check it.
Then work through `TEST.md` for the full matrix.

---

## When the backend machine's IP changes

Press **Set up router** again. The walled garden, both firewall rules, and the URL inside
`login.html` are regenerated from the backend's current address, which the system finds by
locating its own interface on the router's subnet. The manual chore in §10 no longer applies.

---

## Troubleshooting

Most failures now name their own fix in the dialog. These are the ones it cannot:

| Symptom | Cause / fix |
| --- | --- |
| Pasting the bootstrap script errors on odd lines | Paste into WinBox **New Terminal**, not the command bar. Or Download .rsc and `/import` — see below, `/import` has no line-length limit |
| Everything applied **except** the radio, with no error you can find | The console truncates a pasted line at ~1024 bytes. Every generated statement is now capped at 512 (`bootstrap.test.ts` enforces it), but if you hand-edit the script, keep lines short — or use **Download .rsc** + `/import`, which is not affected |
| Script printed "…rejected the radio command" | The board's wireless menu is not one the script tries. Use the manual radio line above, then carry on |
| Script printed "Radio is still disabled" | The radio never came up. That line re-reads the board, so it means the outcome, not just that a command errored — enable it by hand and run Set up |
| Script printed "No radio on this board" | Expected on a hEX/CRS — set Hotspot Interface in Step 3 |
| Dry run wants to create objects that already exist | Hand-made untagged config is present; the checks only match `wbs:` tags, so provisioning builds its own beside it. Reset (Step 1) so provisioning owns the whole configuration |
| Amber: "RouterOS marks the DHCP server invalid… the radio is on the air" | Expected on a hotspot nobody has connected to. On legacy `/interface wireless` the interface reports `running=false` until a device associates, and the DHCP server copies that flag. Connect a phone, or run Set up so `disable-running-check=yes` is applied (§13.9) |
| Clients get an IP but no websites | DNS — provisioning sets it; verify `/ip dns print` (§16.2) |
| `password is not chap encrypted` | Hotspot profile reverted to CHAP — run Set up again (§2.2, §11) |
| Portal shows an old page | Stale `login.html` / `status.html` on the router. Phase 6 catches this by byte count; run Set up again with the backend reachable |
| A `wbs-selftest-*` hotspot user is left behind | Phase 6's throwaway voucher failed to clean up. `/ip hotspot user remove [find name=<name>]` |

---

## Related

- **[mikrotik-hotspot-reference.md](mikrotik-hotspot-reference.md)** — the reference: why each setting exists, every error we hit,
  and the manual equivalent of every provisioning step
- **`../../TEST.md`** — full test matrix
- **`apps/api/src/services/router-provision/`** — the implementation. `bootstrap.ts` generates Step 2;
  `probe.ts` + `readiness.ts` are phases 1–2; `steps.ts` is the ordered registry phases 3–5 run;
  `verify.ts` is phase 6; `setup.ts` orchestrates all of it
