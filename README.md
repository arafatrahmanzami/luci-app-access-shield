# 🛡️ Access Shield

**Device Access Control & Traffic Monitor for OpenWrt/ImmortalWrt**

A modern LuCI application that enforces **MAC+IP whitelist** on any bridge — devices not on the list are isolated at the kernel level. Includes per-device internet block, rate limits, per-subnet shaping, temporary access tickets, wireless MAC filtering, and a live bandwidth monitor.

**Release:** `v1.0.0-r9` — 2026-10-07 — by [@arafatrahmanzami](https://github.com/arafatrahmanzami)

Replaces `luci-app-arpbind` with a unified dashboard. Everything is configured from one modern UI — no more editing shell scripts or hunting through UCI.

---

## 📖 Table of Contents

- [What does this actually do?](#what-does-this-actually-do)
- [You need this if / don't need this if](#you-need-this-if--dont-need-this-if)
- [Why Access Shield?](#why-access-shield)
- [Key Features](#key-features)
- [Prerequisites](#prerequisites)
- [Before You Start](#before-you-start)
- [Installation](#installation)
- [After Installation](#after-installation)
- [Quick Start](#quick-start)
- [Detailed Setup](#detailed-setup)
- [Per-Device Internet Block](#per-device-internet-block)
- [Rate Limits](#rate-limits)
- [Tickets — Temporary Access](#tickets--temporary-access)
- [Wireless MAC Filter](#wireless-mac-filter)
- [Device Aliases](#device-aliases)
- [Troubleshooting](#troubleshooting)
- [Changelog](#changelog)
- [Compile from Source](#compile-from-source)
- [Credits](#credits)
- [Glossary](#glossary)
- [License](#license)

---

## What does this actually do?

Imagine your home network has 20 devices — cameras, smart TVs, phones, IoT plugs. You want:

- **Only the devices you approve** to communicate on a specific bridge
- **Every other device blocked** at the kernel — not just DHCP-denied, actually dropped
- **Per-device internet control** — block the smart TV from phoning home, keep it on LAN
- **Rate limits** — throttle the guest network or one heavy downloader
- **Temporary access** — give a guest internet for 1 hour, auto-revoke after

Access Shield does all of this from one LuCI page. It enforces a MAC+IP whitelist on any bridge using **nftables** at the kernel's prerouting hook. Unlisted devices are dropped before routing.

**This is the same model MikroTik uses** — a "reply-only" style access control. Devices not on the list are fully isolated.

---

## You need this if

✅ You run OpenWrt / ImmortalWrt and want per-device access control
✅ You want MikroTik-style "reply-only" isolation on a camera/IoT bridge
✅ You're replacing `luci-app-arpbind` with something better
✅ You want a live dashboard of all devices across multiple bridges
✅ You want to issue temporary access tickets to guests
✅ You need per-device and per-subnet rate limits

## You don't need this if

❌ You have one router with simple needs
❌ You don't want to install additional packages
❌ Your network is already isolated at the hardware level

---

## Why Access Shield?

**Built to make network isolation simple and visible.**

- One UI for every access control feature — no more shell scripts
- Setup wizard guides first-time users through 7 steps
- Status dashboard shows what's working and what's not at a glance
- Every device's state is visible (bound / unbound / blocked / ticketed)
- Multi-bridge support — protect `br-lan2`, `br-lan3`, `br-guest` simultaneously
- Never touches your firewall config (`fw4`) — uses isolated nft tables
- Auto-rollback on failure — dnsmasq, tickets, all have guards

Access Shield is ideal for:

✔ IoT / camera networks — whitelist every camera, block everything else
✔ Guest WiFi — grant time-limited access, auto-revoke
✔ Homelab — control which VMs/devices can reach the LAN
✔ Small offices — per-device internet policy without hardware firewalls

---

## Key Features

**Enforcement**
- Prerouting nftables packet filter — MAC+IP whitelist per bridge
- Per-bridge mode: `disabled` / `loose` / `reply_only`
- Static-only DHCP mirroring (dnsmasq serves only whitelisted MACs)
- Rogue DHCP shield — blocks unauthorized DHCP servers on protected bridges
- Admin self-safeguard — auto-binds your session before any rule apply

**Device management**
- Unified device inventory (DHCP + ARP + IPv6 + WiFi association)
- **+ Add Device by MAC** — bind a device that isn't visible in the
  inventory yet (offline, pre-provisioning, or dropped by the shield
  before DHCP). See [Adding a device that isn't visible yet](#adding-a-device-that-isnt-visible-yet).
- Per-row Edit / Block / Allow / Bind / Unbind / Rename / Issue Ticket
- Friendly device aliases override DHCP hostnames
- Search + 4 filters (bound, state, link, access)

**Traffic control**
- Per-device rate limits — nftables `limit rate over` with Mbps/MBps/Kbps/KBps
- Per-subnet aggregate caps per bridge
- Live traffic monitor — per-device upload/download (conntrack)
- Speed Limit column on Traffic tab

**Temporary access**
- Ticket system — grant time-limited access to blocked devices
- 10-second expiry daemon with auto-revocation
- Ticket accept rules run before block drops (nftables priority 1 vs 5)
- Live countdown badge on Dashboard

**Wireless**
- Per-SSID MAC filter management (hostapd `macfilter` / `maclist`)
- Device dropdown + custom MAC input

**Setup & docs**
- 7-step Setup wizard with progress bar
- Status dashboard (6 environment checks at a glance)
- Help tab with full documentation
- Migration tool from `luci-app-arpbind`

---

## Prerequisites

To function correctly, Access Shield requires:

- **OpenWrt / ImmortalWrt 23.05+** (24.10+ recommended)
- **`nftables`** + **`kmod-nft-core`** + **`kmod-nft-bridge`** — installed by the package
- **`luci-base`** — installed by the package
- **`luci-compat`** (if encountering missing Lua runtime dependencies)

Optional (only if enabling Bandwidth Monitor):
- `conntrack`
- `kmod-nf-conntrack-netlink`

**Hardware:** any router running OpenWrt. Package is `PKGARCH=all` — works on x86, MIPS, ARM, AArch64, RISC-V.

---

## Before You Start

Answer these five questions before installing:

1. **Do I have a working OpenWrt / ImmortalWrt router?** — If no, install OpenWrt first.
2. **Do I know my router's IP?** — Usually `192.168.1.1` or `192.168.10.1`.
3. **Do I have SSH access?** — Try `ssh root@<router-ip>`. Password is the same as LuCI login.
4. **Do I have a working internet connection?** — Needed if installing dependencies from OpenWrt repos.
5. **Have I backed up my current config?** — In LuCI: **System → Backup / Flash Firmware → Generate archive**.

If all five are ✅, proceed. If any is ❌, fix that first.

**Very important:** Before enabling `reply_only` on any bridge, make sure at least one device you can reach the router from is **already bound** in the Bindings list. Otherwise you may lock yourself out.

The app has a built-in **admin safeguard** that auto-binds your current session, but binding manually first is still the safest path.

---

## Installation

### 1. Install the package

**OpenWrt ≤ 24.10 — opkg:**

    cd /tmp && \
    opkg update && \
    wget https://github.com/arafatrahmanzami/luci-app-access-shield/releases/download/v1.0.0-r9/luci-app-access-shield_1.0.0-r9_all.ipk && \
    opkg install luci-app-access-shield_1.0.0-r9_all.ipk && \
    rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* && \
    /etc/init.d/rpcd restart && /etc/init.d/uhttpd restart

**OpenWrt ≥ 25.12 — apk:**

    cd /tmp && \
    wget https://github.com/arafatrahmanzami/luci-app-access-shield/releases/download/v1.0.0-r9/luci-app-access-shield-1.0.0-r9.apk && \
    apk add --allow-untrusted luci-app-access-shield-1.0.0-r9.apk && \
    rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* && \
    /etc/init.d/rpcd restart && /etc/init.d/uhttpd restart

### 2. Single auto-detect command (opkg vs apk)

    cd /tmp && \
    if command -v apk >/dev/null 2>&1; then \
      echo "Detected apk — OpenWrt 25.12+" && \
      wget -O access-shield.pkg https://github.com/arafatrahmanzami/luci-app-access-shield/releases/download/v1.0.0-r9/luci-app-access-shield-1.0.0-r9.apk && \
      apk add --allow-untrusted access-shield.pkg; \
    else \
      echo "Detected opkg — OpenWrt 24.10 or older" && \
      opkg update && \
      wget -O access-shield.pkg https://github.com/arafatrahmanzami/luci-app-access-shield/releases/download/v1.0.0-r9/luci-app-access-shield_1.0.0-r9_all.ipk && \
      opkg install access-shield.pkg; \
    fi && \
    rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* && \
    /etc/init.d/rpcd restart && /etc/init.d/uhttpd restart

### 3. Offline install (no internet on router)

Copy the `.ipk` / `.apk` to `/tmp` on the router via WinSCP / FileZilla / SCP, then:

**OpenWrt ≤ 24.10 (opkg):**

    cd /tmp
    opkg install luci-app-access-shield_1.0.0-r9_all.ipk
    /etc/init.d/uhttpd restart

**OpenWrt ≥ 25.12 (apk):**

    cd /tmp
    apk --allow-untrusted add /tmp/luci-app-access-shield-1.0.0-r9.apk
    /etc/init.d/uhttpd restart

### 4. Overlay tarball (manual file install)

Use this method when `opkg` / `apk` is not available (offline router,
custom firmware image) or when you prefer manual file placement. The
overlay tarball is attached to the release and contains the final
filesystem layout — `/etc/...`, `/usr/...`, `/www/...` — so extraction
goes directly into `/`.

**Important:** this method bypasses `opkg` / `apk`, so the package's
`postinst` script does not run. The commands below replicate what
`postinst` would have done — seed the config on first install, enable
and start the services, clear the LuCI cache.

    # On PC
    wget https://github.com/arafatrahmanzami/luci-app-access-shield/releases/download/v1.0.0-r9/luci-app-access-shield-1.0.0-r9-overlay.tar.gz
    scp luci-app-access-shield-1.0.0-r9-overlay.tar.gz root@192.168.10.1:/tmp/
    
    # On router
    cd / && tar xzf /tmp/luci-app-access-shield-1.0.0-r9-overlay.tar.gz
    
    # Replicate postinst: seed config on first install only
    [ -f /etc/config/access_shield ] || /etc/uci-defaults/99-access-shield
    
    # Enable + start the services
    for s in access-shield access-shield-block access-shield-shape \
             access-shield-stats access-shield-subnet access-shield-ticketd; do
        /etc/init.d/$s enable
        /etc/init.d/$s start
    done
    
    # Clear LuCI cache so the menu and views are picked up
    rm -f /tmp/luci-indexcache /tmp/luci-modulecache/*
    /etc/init.d/rpcd restart
    /etc/init.d/uhttpd restart

**Uninstall (overlay install):** run the same steps as the
`"Uninstall completely"` section below, but skip the `opkg remove` /
`apk del` step. You will need to delete the files listed in the
"What gets installed" table by hand if you want a full cleanup — an
overlay install leaves no package-manager record for `opkg` / `apk`
to remove.

---

## After Installation

1. Open LuCI: `http://<router-ip>/cgi-bin/luci/`
2. Go to **Network → Access Shield**
3. Follow the **Setup** tab (7-step wizard)
4. If the menu doesn't show, hard-refresh: **Ctrl+Shift+R**

**What gets installed:**

| Path | Purpose |
|---|---|
| `/etc/config/access_shield` | UCI configuration |
| `/etc/init.d/access-shield` | Main enforcement service (procd) |
| `/etc/init.d/access-shield-block` | Per-device internet block |
| `/etc/init.d/access-shield-shape` | Per-device rate limits |
| `/etc/init.d/access-shield-subnet` | Per-subnet aggregate limits |
| `/etc/init.d/access-shield-ticketd` | Ticket expiry daemon (10 s poll) |
| `/usr/bin/access-shield-discover` | Device discovery (DHCP + ARP + IPv6 + WiFi) |
| `/usr/bin/access-shield-traffic` | Per-IP conntrack sampling |
| `/usr/bin/access-shield-migrate` | Import from `luci-app-arpbind` |
| `/usr/libexec/rpcd/luci.access_shield` | RPC backend (30+ methods) |
| `/www/luci-static/resources/view/access_shield/` | 9 LuCI views (JS) |
| `/usr/share/luci/menu.d/luci-app-access-shield.json` | Menu tree |
| `/usr/share/rpcd/acl.d/luci-app-access-shield.json` | ACL permissions |
| `/etc/hotplug.d/iface/99-access-shield` | Reload on interface up |
| `/etc/uci-defaults/99-access-shield` | First-install seeder |

---

## Quick Start

| Role | What to do |
|---|---|
| **Protect one bridge (e.g., `br-lan2`)** | Setup → choose bridge → bind device → enable reply_only → turn on master switch |
| **Block internet for specific devices** | Dashboard → click Block on the row |
| **Temporary access for a guest** | Block the device → click 🎫 Ticket → choose duration |
| **Rate limits** | Dashboard → Edit → set DL/UL |
| **Filter WiFi per SSID** | Wireless tab → select device → check SSIDs to allow |

**The golden rule:** if a device isn't in the Bindings list and the bridge is in `reply_only` mode, it has no network access. Add it before enabling.

---

## Detailed Setup

### Step 1 — Open Setup Wizard

Go to **Network → Access Shield → Setup**. The wizard walks through 7 steps:

1. **Choose Bridge to Protect** — pick `br-lan2` (recommended for IoT/cameras)
2. **Admin Safeguard** — bind your current device (auto-detected)
3. **Static-Only DHCP** — turns off dynamic leases for that bridge
4. **Firewall Zone Rules** — verifies DHCP/DNS/LuCI allow rules exist
5. **Enforcement Mode** — sets bridge to `reply_only`
6. **Master Switch** — enables enforcement
7. **Add Devices** — next step is Dashboard

Each step shows a **✓** or **⚠**, with a button to fix issues.

### Step 2 — Add Devices

Go to **Dashboard**:

- Click **Bind** on any discovered device
- Or click **Scan & Bind** to bulk-add devices from ARP + DHCP
- For a device that isn't visible in the list (offline, pre-provisioning,
  or dropped by the shield before DHCP on a `reply_only` bridge), click
  **+ Add Device by MAC** at the top and enter MAC / name / IP / iface.
- Each binding shows: Name, IP, MAC, Interface, Link, Status, Access

### Step 3 — Verify Enforcement

Open a terminal and check:

    nft list table inet access_shield_fw
    # Should show: <bridge>_shield chain with accept rules + default drop

### Step 4 — Confirm from a Device

Test from an unbound device (change MAC):

- Try to reach the router — **should fail**
- Try to reach the internet — **should fail**

Test from a bound device:

- Should work normally

---

## Per-Device Internet Block

The block feature denies forwarding to WAN — the device stays on LAN but can't reach the internet. Perfect for smart TVs that phone home, IoT that shouldn't call out, or stopping a runaway downloader.

**To block:**

1. Dashboard → click **Block** on a device row
2. Badge changes to `blocked`
3. Verify: `nft list table inet access_shield_block` shows a drop rule for that MAC

**To unblock:**

- Dashboard → click **Allow**
- Rule removed immediately

**Scoped per bridge:** blocks use `iifname` matching, so a device blocked on `br-lan2` still works if it moves to `br-lan`. This is intentional — the block is per-segment, not global.

---

## Rate Limits

### Per-Device Limits

Dashboard → Edit → set **Download Limit** and **Upload Limit** with unit (Mbps / MBps / Kbps / KBps).

Rules apply via `nftables limit rate over <bytes>/second drop`.

Verify:

    nft list table inet access_shield_shape

### Per-Subnet Limits

**Traffic** tab → **Per-Subnet Bandwidth Limits** section → set DL/UL per bridge.

Applies to **all traffic across the subnet** — but individual device limits still take precedence (tighter drop wins).

Verify:

    nft list table inet access_shield_subnet

---

## Tickets — Temporary Access

Grant a blocked device **time-limited internet access**.

**To issue a ticket:**

1. Dashboard → find a blocked device (shows 🎫 Ticket button)
2. Click 🎫 → choose duration (15m / 1h / 4h / 1d / custom)
3. Badge appears: `🎫 59m 43s` (orange, countdown)

**Behind the scenes:**

- Ticket chain runs at nftables priority 1, block chain at priority 5
- Both rules coexist — ticket `accept` matches first, packet bypasses the drop
- When ticket expires, accept rule is removed → block re-engages

**Auto-expiry:** the `access-shield-ticketd` daemon checks every 10 seconds and removes expired tickets automatically. No user action needed.

**To cancel early:** click the orange badge → confirm → ticket revoked immediately.

**Important design note:** `accept` in nftables is not terminal across chains. So both ticket and block rules live in the **same chain**, ordered so ticket rules come first. This is what makes ticket-bypass work correctly.

---

## Wireless MAC Filter

Per-SSID allow/deny list, managed via hostapd.

**To enable:**

1. **Wireless** tab → select a device from the dropdown
2. Check the box for each SSID you want to allow
3. Click **Apply Changes**
4. WiFi reloads (existing clients briefly reconnect)

**To allow a device by hand:** select "Custom MAC Address..." and type the MAC.

**Behind the scenes:** this sets `macfilter=allow` + `maclist` on the `wifi-iface` section, then runs `wifi reload`.

**Note:** when ARP reply-only is enabled on a bridge, MAC filtering is redundant — the whitelist already isolates unlisted devices. Use Wireless MAC filter only when enforcement is off, or for additional isolation across SSIDs.

---

## Device Aliases

Give devices friendly names instead of seeing MAC addresses or auto-assigned names.

**Priority for a device's displayed name:**

1. **Alias** (highest — your custom name)
2. **Binding name** (from Dashboard binding)
3. **DHCP hostname** (from the client's DHCP request)
4. **"Unknown"**

**Example:** "Front Door Cam" always wins over "Camera-128" or "TP-LINK-device".

**To set an alias:**

- Dashboard → Edit → **Alias** field → Save

Aliases persist across reboots and are stored in `access_shield.*.alias` UCI sections.

---

## Working with Devices

**Enable / disable a binding:** Dashboard → toggle checkbox on row → Save & Apply

**Rename a device:** Dashboard → Edit → change Alias field → Save

**Change a binding's interface:** Dashboard → Edit → change Interface → Save

**Remove a binding:** Dashboard → Unbind

**Find a device's MAC:** Dashboard shows it; or check **Network → DHCP and DNS → Active Leases**

**Migrate from `luci-app-arpbind`:**

    # From the router
    ubus call luci.access_shield migrate_scan "{}"   # preview
    ubus call luci.access_shield migrate_import "{}" # import

Or use the **Settings** tab → **Migration from legacy arpbind** section.

---

## Adding a device that isn't visible yet

On a strictly-enforced bridge (`reply_only` + `default_drop=1`), devices
that are **not yet in the whitelist** get their IPv4 packets dropped at
the prerouting hook — before they can reach dnsmasq for a DHCP lease.
That is the whole point of the shield. But it also means such devices
**do not appear in the Dashboard inventory at all** — the discovery
script reads DHCP leases, ARP, IPv6 neighbors, and WiFi associations,
and an unbound device on a protected bridge never shows up in any of
them.

The **+ Add Device by MAC** button at the top of the Dashboard solves
this. It opens a modal that binds a device by MAC, IP, interface, and
name, using the same `bind_device` RPC that the per-row Bind button
uses. The device does not need to be visible, online, or even powered
on.

Typical uses:

- **Pre-provisioning** — add cameras / IoT before they arrive, so the
  first time they boot they get a lease and are whitelisted.
- **Post-reinstall** — device was unbound and disappeared from the
  inventory; re-add it with the same MAC and it comes back.
- **Offline device** — bind a device that's currently switched off.
- **Recovery** — if a device can't DHCP on a `reply_only` bridge and
  therefore can't be seen, add it manually, then it can DHCP.

The modal refuses MACs that are already bound — use **Edit** on the
device row to change an existing binding. `bind_device` resets the
`block_internet` flag, so re-adding an already-blocked device would
silently unblock it; the duplicate guard prevents that.

Leave **IP address** blank to bind with a placeholder `0.0.0.0`. The
device will obtain a real DHCP lease on next connect (as long as
`dhcp_allow` is on for that bridge).

---

## Multi-Bridge Support

Access Shield protects **any number of bridges simultaneously**. Each binding specifies its own interface.

**Example setup:**

| Bridge | Purpose | Mode |
|---|---|---|
| `br-lan` | Main LAN | `disabled` (unprotected) |
| `br-lan2` | Cameras / IoT | `reply_only` |
| `br-lan3` | Secondary LAN | `loose` |
| `br-guest` | Guest WiFi | `reply_only` |

Each bridge gets its own nftables chain within `access_shield_fw`. Rules are per-bridge — a device bound to `br-lan2` has no effect on `br-lan`.

**To add a new bridge after setup:**

1. Go to **Interfaces** tab
2. The bridge appears automatically in **Unmanaged bridges** if it's a
   Linux bridge (with or without an IP)
3. Type a label, click **Adopt** — it moves to **Managed Bridges** with
   mode `disabled` and enforcement OFF
4. Set mode to `reply_only` and turn on **Enable** when ready
5. Bind devices on **Dashboard** choosing the new interface

**If auto-discovery misses a bridge** (rare), use **+ Add Interface by
Name** at the top of the Interfaces tab. Accepts any existing bridge or
a `br-*` name for pre-provisioning — a `br-*` name that does not yet
exist in the kernel is accepted and appears in Managed Bridges with a
`\u26a0 missing` badge until the kernel interface is created.

**Orphaned sections** — if a kernel bridge is deleted but its UCI section
remains, the Interfaces tab shows a warning table with a **Remove**
button. Enforcement already skips orphans safely; the button just cleans
up the leftover config.

### Per-bridge toggles — and why they sometimes appear to do nothing

Each bridge has two toggles in the **Interfaces** tab:

| Toggle | Meaning | Observable when |
|---|---|---|
| **Allow DHCP** (`dhcp_allow`) | When ON, DHCP packets (UDP 67) from devices on this bridge are accepted at the shield chain. When OFF, the accept rule is not emitted — devices cannot reach dnsmasq to obtain a lease. | dnsmasq has `dynamicdhcp=1` on this bridge's DHCP section. With `dynamicdhcp=0`, dnsmasq ignores unlisted MACs anyway — the toggle is masked. |
| **Default drop IPv4** (`default_drop`) | When ON, the shield chain ends with a catch-all `meta nfproto ipv4 drop`. Non-whitelisted IPv4 dies at prerouting. When OFF, non-whitelisted IPv4 falls through to fw4's forward hook. | The firewall zone's forward policy is ACCEPT or a custom allowlist. With the OpenWrt default (`forward=REJECT`), fw4 already drops — the toggle is masked. |

**Why does the toggle sometimes seem to do nothing?** Because enforcement
is layered:

1. `access_shield_fw` (prerouting, priority -150) — whitelist + toggles
2. `access_shield_block` (forward, priority +5) — per-device block
3. `access_shield_shape` (forward, priority +10) — rate limits
4. `access_shield_subnet` (forward, priority +15) — subnet caps
5. fw4 (forward, priority filter = 0) — zone policy
6. dnsmasq (userspace) — DHCP server

If an earlier layer already blocks traffic, later layers never see it. The
toggles in `access_shield_fw` only matter when the layer above them (fw4
or dnsmasq) is permissive.

**Decision guide:**

| Goal | dhcp_allow | default_drop | Requires |
|---|---|---|---|
| Strict isolation (recommended for cameras / IoT) | 1 | 1 | — |
| Monitoring — log unknowns, don't hard-block | 1 | 0 | Zone forward != REJECT |
| Zero DHCP to unknowns | 0 | 1 | — |
| Whitelist as allow-only (permissive) | 0 | 0 | Zone forward != REJECT; devices need static leases |

---

## Compatibility with Other Systems

Access Shield writes to its own isolated nftables tables. It **never touches**:

- `/etc/config/firewall` (fw4)
- `/etc/config/network`
- Any other nftables table

**Detected legacy systems:** on the Setup page, if any of the following are detected, a warning appears:

- `luci-app-arpbind` (legacy config)
- `luci-app-client-manager`
- `luci-app-trafficctl`

The wizard's **Migration** button imports arpbind bindings without disturbing the other systems.

**Coexistence testing:**

    # Verify Access Shield tables
    nft list tables | grep access_shield
    
    # Verify firewall not affected
    nft list table inet fw4 | head

---

## Troubleshooting

### "Device can't get an IP on br-lan2"

- Make sure the device's MAC is bound in Dashboard
- br-lan2 uses **static-lease-only** — unlisted devices get no DHCP lease
- Verify: `uci show dhcp | grep dynamicdhcp` — should be `0` for LAN2

### "Device can't get internet, but shows as allowed"

- Check block chain: `nft list table inet access_shield_block | grep <mac>`
- If a drop rule exists but UCI shows allowed → reload:

      /etc/init.d/access-shield-block reload

### "Device doesn't appear in the Dashboard"

This is expected on a strictly-enforced bridge (`reply_only` +
`default_drop=1`). Unbound devices are dropped at prerouting before
they can DHCP, so they show up in none of the discovery sources
(DHCP leases, ARP, IPv6 neighbors, WiFi associations).

Fix: click **+ Add Device by MAC** at the top of the Dashboard and
enter the MAC, name, IP (optional), and interface. The device does
not need to be visible or online to be bound.

See [Adding a device that isn't visible yet](#adding-a-device-that-isnt-visible-yet)
for details.

### "Ticket was issued but device still has no internet"

- Verify accept rule exists: `nft list table inet access_shield_block | grep accept`
- Check daemon log: `logread | grep access-shield-ticketd | tail`
- Ensure accept rule appears **above** drop rule for the same MAC

### "Lost access to the router after enabling reply_only"

Recovery options, in order of preference:

1. **Connect via another bridge** (e.g., WiFi on br-lan — always unprotected)
2. **Physical reboot** — services reload from config; admin safeguard binds you at next apply
3. **Failsafe mode** — power off, hold reset, wait for blinking LED, connect LAN, SSH to `192.168.1.1`, run `mount_root` then edit `/etc/config/access_shield` to set `enabled '0'`

### "Rate limit not working"

- Verify shape service: `/etc/init.d/access-shield-shape status`
- Check rules: `nft list table inet access_shield_shape`
- Confirm counter increments: `nft list table inet access_shield_shape | grep packets`

### "Menu doesn't show"

- Hard refresh: **Ctrl+Shift+R**
- Clear LuCI cache:

      rm -f /tmp/luci-*cache*
      /etc/init.d/rpcd restart

- Check ACL: `ls /usr/share/rpcd/acl.d/luci-app-access-shield.json`
- Check menu: `cat /usr/share/luci/menu.d/luci-app-access-shield.json`

### "Rollback entire app (config preserved)"

    # Stop all services
    for s in access-shield access-shield-block access-shield-shape \
             access-shield-subnet access-shield-ticketd; do
        /etc/init.d/$s stop
        /etc/init.d/$s disable
    done
    
    # Delete nftables tables
    for t in fw block shape subnet ticket; do
        nft delete table inet access_shield_$t 2>/dev/null
    done
    
    echo "Rollback complete."
    echo "Re-enable with: /etc/init.d/access-shield enable && /etc/init.d/access-shield start"

### "Uninstall completely"

    # Stop + disable services
    for s in access-shield access-shield-block access-shield-shape \
             access-shield-subnet access-shield-ticketd; do
        /etc/init.d/$s stop 2>/dev/null
        /etc/init.d/$s disable 2>/dev/null
    done
    
    # Delete nftables tables
    for t in fw block shape subnet ticket; do
        nft delete table inet access_shield_$t 2>/dev/null
    done
    
    # Remove package
    # opkg (≤ 24.10)
    opkg remove luci-app-access-shield
    
    # apk (≥ 25.12)
    apk del luci-app-access-shield
    
    # Optional: wipe config
    rm -f /etc/config/access_shield
    
    # Clear LuCI cache
    rm -f /tmp/luci-*cache* /tmp/luci-indexcache
    /etc/init.d/rpcd restart
    /etc/init.d/uhttpd restart

### "App is slow or uses too much CPU"

- Disable **Bandwidth Monitoring** in Settings if you're on a low-RAM router (< 128 MB)
- The ticket daemon checks every 10 seconds — safe to leave enabled
- Traffic page polls every 30 seconds by default — you can set it higher (60s, 120s)

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full history.

### [1.0.0-r7] — 2026-10-07

**Added**

- Interfaces tab: **Orphaned sections** warning table — UCI sections
  whose `device` no longer exists in the kernel are flagged with a
  `\u26a0 missing` badge and a **Remove** button. Enforcement already
  skipped them safely; this makes them visible and cleanable.
- Interfaces tab: **+ Add Interface by Name** button — manually adopt a
  `br-*` bridge before the kernel interface exists (pre-provisioning).
- rpcd: `remove_interface` method with a hard guard — refuses to delete
  any section whose interface still exists. Only true orphans removable.
- rpcd: `add_bridge` relaxed to accept `br-*` names for pre-provisioning
  in addition to existing kernel bridges.

### [1.0.0-r6] — 2026-10-07

**Added**

- Interfaces tab: automatic discovery of new kernel bridges. Any bridge
  present in `/sys/class/net/` but not yet in UCI appears in an
  **Unmanaged bridges** table with an inline label input and an **Adopt**
  button.
- rpcd: `add_bridge` method validates the target is a real kernel bridge,
  refuses duplicates, creates a unique section with safe defaults
  (`mode=disabled`, `enabled=0`).

### [1.0.0-r5] — 2026-10-07

**Added**

- Dashboard **+ Add Device by MAC** button — bind a device by MAC / IP /
  iface / name without it appearing in the discovery list first. Solves
  the case where a strictly-enforced bridge drops an unbound device at
  prerouting before it can DHCP, so it never appears in the inventory.
- Duplicate-MAC guard (refuses to re-bind; `do_bind_device` would
  otherwise reset `block_internet`).
- Client-side MAC + IPv4 validation.

**Fixed**

- Dashboard search input no longer loses focus after each keystroke.
- Dashboard empty-state row no longer throws `ReferenceError: d is not
  defined` when clicked (pre-existing bug, made visible by the new Add
  Device workflow).
- Menu landing page changed from Setup to Dashboard.

### [1.0.0-r4] — 2026-10-07

**Fixed**

- Interfaces tab **Save & Apply** now actually commits to UCI.
- `dhcp_allow` and `default_drop` per-bridge toggles are now read by
  `apply_interface()` — previously they were dead fields.

**Added**

- Layered-enforcement documentation (Help tab + README).

### [1.0.0] — 2026-10-06

**Added**

- Prerouting nftables packet filter with MAC+IP whitelist per bridge
- Per-bridge mode: `disabled` / `loose` / `reply_only`
- Static-only DHCP mirroring (with safety snapshot / rollback on dnsmasq failure)
- Admin self-safeguard (auto-binds managing session)
- Per-device internet block (with per-interface scoping)
- Per-device rate limits (DL / UL, unit selection)
- Per-subnet aggregate bandwidth limits
- Ticket system with 10-second expiry daemon
- Wireless MAC filter (per SSID)
- Device aliases (override DHCP hostnames)
- 7-step Setup wizard + Status dashboard + Help tab
- Migration tool from `luci-app-arpbind`
- Compatibility warnings (detects legacy configs)

**Architecture**

- 5 isolated nftables tables: `fw`, `block`, `shape`, `subnet`, `ticket`
- Priority chain: ticket(1) → block(5) → shape(10) → subnet(15)
- Each service has its own procd init script
- Auto-rollback on dnsmasq failure

**Compatibility**

- OpenWrt / ImmortalWrt 23.05+ / 24.10+
- opkg and apk
- All architectures (`LUCI_PKGARCH:=all`)

**Tested on:** Imou LC-HX3001 (mediatek/filogic, aarch64, ImmortalWrt 24.10.6)

---

## Compile from Source (OpenWrt SDK)

### Step 1 — Setup OpenWrt SDK

    git clone https://git.openwrt.org/openwrt/openwrt.git
    cd openwrt
    ./scripts/feeds update -a
    ./scripts/feeds install -a

### Step 2 — Add Access Shield

    cd package
    git clone https://github.com/arafatrahmanzami/luci-app-access-shield.git
    cd ..

### Step 3 — Compile

    make menuconfig
    # Navigate: LuCI → Applications → luci-app-access-shield → <M>
    
    make package/luci-app-access-shield/compile V=s
    # Output: bin/packages/<arch>/base/luci-app-access-shield_1.0.0-r9_all.ipk

**Short version (all in one):**

    git clone https://github.com/arafatrahmanzami/luci-app-access-shield.git package/luci-app-access-shield
    make menuconfig       # LuCI → Applications → luci-app-access-shield → M
    make package/luci-app-access-shield/compile V=s

---

## Credits

**Current maintainer:** Arafat Rahman Zami Mondol — [@arafatrahmanzami](https://github.com/arafatrahmanzami) · [open an issue](https://github.com/arafatrahmanzami/luci-app-access-shield/issues)

**Inspiration & references:**

| Project | Author | What we borrowed |
|---|---|---|
| `luci-app-arpbind` | OpenWrt community | Original MAC+IP binding app; migration source |
| `luci-app-client-manager` | [nightcodex7](https://github.com/nightcodex7) | Unified device dashboard UI patterns |
| `luci-app-trafficctl` | [YusDyr](https://github.com/YusDyr) | Device aliases, per-subnet limits |
| `luci-access-control` | [securecrt](https://github.com/securecrt) | Ticket / temporary-access mechanism |
| `luci-app-easymesh` | [arafatrahmanzami](https://github.com/arafatrahmanzami) | README structure, install patterns, glossary |

**Special thanks:**

- The OpenWrt and ImmortalWrt maintainers
- Everyone who filed issues, tested, and reported bugs
- The nftables project for a modern packet filter

---

## See Also

- [CHANGELOG.md](CHANGELOG.md) — Full version history
- [LICENSE](LICENSE) — Apache-2.0
- [GitHub Issues](https://github.com/arafatrahmanzami/luci-app-access-shield/issues) — Bug reports, feature requests

---

## Glossary

Terms used in this README that may be unfamiliar, especially if you're new to OpenWrt or networking.

### Network fundamentals

| Term | Full form | Meaning |
|---|---|---|
| LAN | Local Area Network | The network inside your home or office. |
| WAN | Wide Area Network | The broader network — usually your ISP connection. |
| AP | Access Point | Broadcasts WiFi that devices can connect to. |
| IP | Internet Protocol | Each device's network address (e.g., `192.168.1.1`). |
| MAC | Media Access Control | Each network card's unique hardware ID (e.g., `74:fe:ce:4e:1d:1a`). |
| DHCP | Dynamic Host Configuration Protocol | Service that assigns IP addresses automatically. |
| DNS | Domain Name System | Translates domain names to IP addresses. |
| SSID | Service Set Identifier | The WiFi network name you see on your phone. |
| VLAN | Virtual LAN | Technique to create multiple logical networks on one physical network. |
| VPN | Virtual Private Network | Encrypted connection over the internet. |

### Access control & firewall

| Term | Meaning |
|---|---|
| Whitelist | List of allowed devices (MAC+IP pairs). Devices not on it are blocked. |
| Reply-only | Mode where the router only replies to whitelisted MAC+IP pairs. |
| Prerouting | nftables hook that runs before routing decisions. |
| Forward hook | nftables hook that runs on traffic passing through the router (LAN → WAN). |
| Rate limit | Maximum bandwidth a device/subnet can consume. |
| Drop / Reject | nftables actions. `drop` = silent discard; `reject` = send error back. |
| Ticket | Temporary access — grants time-limited whitelist bypass. |
| Rogue DHCP | Unauthorized DHCP server that tries to hand out bad leases. |
| Binding | A MAC+IP pair that's allowed on a protected bridge. |
| Alias | Friendly name that overrides the auto-detected name. |
| Master Switch | Top-level toggle — nothing enforces until it's ON. |

### OpenWrt ecosystem

| Term | Meaning |
|---|---|
| OpenWrt | Open-source router firmware, Linux-based. |
| ImmortalWrt | Fork of OpenWrt with extra packages. |
| LuCI | OpenWrt's web-based configuration interface. |
| UCI | Unified Configuration Interface — all config in `/etc/config/`. |
| opkg | Package manager used by OpenWrt 24.10 and older (`.ipk`). |
| apk | Newer package manager used by OpenWrt 25.12+ (`.apk`). |
| procd | OpenWrt's service manager. |
| rpcd | Service that processes LuCI web requests. |
| uhttpd | Lightweight HTTP server serving LuCI pages. |
| nftables | Modern Linux packet filter (replaces iptables). |
| dnsmasq | DNS + DHCP daemon used by OpenWrt. |
| Dropbear | Lightweight SSH server used by OpenWrt. |

### Interface naming

| Name | Meaning |
|---|---|
| `eth0`, `eth1` | Ethernet interfaces (wired). |
| `lan1`, `lan2`, `lan3` | LAN physical ports. |
| `wan` | WAN port — for ISP connection. |
| `br-lan`, `br-lan2`, `br-lan3` | Bridge interfaces combining multiple ports. |
| `br-guest` | Guest network bridge. |
| `br-iot` | IoT network bridge. |
| `phy0`, `phy1` | Wireless radio hardware identifiers. |
| `radio0`, `radio1` | OpenWrt's names for radios. |
| `wlan0`, `wlan1` | Wireless client / AP interfaces. |

### Shell commands

| Command | Meaning |
|---|---|
| `uci set` | Set a UCI value. |
| `uci get` | Read a UCI value. |
| `uci commit` | Save changes permanently. |
| `uci show` | Display current config. |
| `nft list table` | Show nftables rules. |
| `ip neigh` | Show ARP/neighbor table. |
| `logread` | Read the system log. |
| `opkg install` | Install with opkg. |
| `apk add` | Install with apk. |
| `chmod +x` | Make a file executable. |
| `reboot` | Restart the router. |

### UI & setup terms

| Term | Meaning |
|---|---|
| Binding | A MAC+IP pair that's allowed on a protected bridge. |
| Alias | Friendly name that overrides the auto-detected name. |
| Save & Apply | Button to save and apply changes. |
| Master Switch | Top-level toggle — nothing enforces until it's ON. |
| Reply-only mode | Enforcement mode on a bridge. |
| Loose mode | No enforcement, but the interface is tracked. |
| Admin safeguard | Auto-binds your session before applying rules. |
| Scan & Bind | Bulk-import discovered devices. |

### Units & measurements

| Unit | Meaning |
|---|---|
| bit | Smallest unit of digital information (0 or 1). |
| Byte | 8 bits. Written with capital B. |
| Kbit/s | Kilobits per second. |
| Mbit | Megabit = 1000 kilobits. |
| Mbps | Megabits per second. |
| ms | Millisecond = 1/1000 of a second. |

### Platform

| Term | Meaning |
|---|---|
| Git | Version control system — tracks changes to code. |
| GitHub | Git repository hosting platform. |
| Repository (Repo) | A collection of code and files. |
| Commit | A saved snapshot of code changes. |
| Branch | A parallel version of the code. |
| Fork | Your own copy of someone else's project. |
| Release | A specific version published for users. |
| Tag | A named marker for a commit (e.g. `v1.0.0`). |
| Linux | The open-source operating system kernel — foundation of OpenWrt. |

---

## License

Apache-2.0 — see [LICENSE](LICENSE)

Copyright (c) 2026 Arafat Rahman Zami Mondol
