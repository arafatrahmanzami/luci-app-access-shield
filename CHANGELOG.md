# Changelog

All notable changes to Access Shield are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-r9] — 2026-10-09

### Added

**Dashboard — configurable auto-refresh**
- Read `access_shield.settings.dashboard_interval` (default 15s, 0 = off).
- Live override dropdown on the Dashboard (`Refresh: [dropdown]`)
  changes the interval immediately without saving; a page reload picks
  up the Settings value again.
- Replaced LuCI `poll.add` with a module-scope `setInterval` that is
  cleared via `view.unload`. Added 5/10/15/30/60/120s and Off options.

**Wireless tab — per-SSID MAC detail modal**
- Click an SSID name in the per-SSID filtering status table to open a
  modal listing every MAC currently allowed on that SSID with a
  per-MAC Remove button and an Add MAC input. Uses the existing
  `set_mac_filter` RPC (add/remove) — no rpcd changes.

## [1.0.0-r9] — 2026-10-09

### Fixed

**Traffic tab — auto-refresh dropdown did nothing**
- The dropdown's `change` handler updated a local variable that the
  already-registered LuCI poll never re-read. Changing the interval had
  no effect until the page was reloaded manually.
- Replaced the LuCI `poll.add` registration with a module-scope
  `setInterval` that is cleared and re-created whenever the dropdown
  changes. Added a `view.unload` hook so navigating away clears the
  timer. Added 30s and Off options.

### Changed

**Traffic tab — Per-Subnet limits now have one Save All button**
- Removed the per-row Save button. A single **Save All Changes** button
  below the table commits every row in one pass — change multiple
  bridges, click once, one page reload. Previously each row required
  its own Save click and page reload.

### Added

**Settings tab — new global options**
- `dashboard_interval` — Dashboard auto-refresh interval in seconds
  (default 15, `0` disables).
- `firewall_write` — permission flag (default OFF). When off, the
  Setup wizard only verifies firewall rules and points you at
  Network → Firewall. When on, the wizard's “Add missing rules”
  button (added in a follow-up commit) will write the missing
  allow rules into `/etc/config/firewall` with rollback on failure.

## [1.0.0-r8] — 2026-10-09

### Fixed

**Settings tab — Save & Apply**
- `handleSaveApply` was missing `ui.changes.apply()`. Clicking Save &
  Apply staged the changes in the browser but never committed to UCI,
  so the "UNSAVED CHANGES" badge persisted and the only way to commit
  was to open the diff panel and click Save & Apply a second time.
  Same class of bug as the r4 Interfaces-tab fix, in a view that
  hadn't been checked at the time.

**Traffic tab — Per-Subnet Bandwidth Limits input vanished**
- The 2-second poll calls `repaint()`, which wiped the entire page
  container and rebuilt it, including the subnet limit inputs. The
  rebuilt inputs read from the last RPC response, not from what the
  user had typed — so any character entered was lost within 1–2
  seconds.
- Fix: split the render into a `liveContainer` (device table, rebuilt
  every poll) and static content (top bar + subnet config section,
  built once and never touched by the poll). User typing in the
  subnet inputs now survives, and the Save button still triggers a
  page reload after the RPC commits.

### Added

**Wireless tab — per-SSID filtering status table**
- New "Per-SSID filtering status" summary table above the checkbox
  list. Shows for each AP-mode SSID: radio, SSID name, whether hostapd
  MAC filter is `allow` or `disable`, and the current MAC list (up to
  3 shown, `+N more` suffix beyond that).
- The data was already returned by the `wifi_interfaces` RPC; the view
  simply wasn't displaying it.

## [1.0.0-r7] — 2026-10-07

### Added

**Interfaces tab — orphan detection + cleanup**
- The Interfaces tab now compares each `access_shield.*=interface` UCI
  section against the kernel interface list. Sections whose `device`
  no longer exists in `/sys/class/net/` are flagged as orphans and
  shown in a dedicated warning table above the other tables, each with
  a **Remove** button and confirmation modal.
- Enforcement already skipped orphans safely via the `iface_exists`
  guard in `apply_interface()`, but the UI gave no visibility.

**Interfaces tab — "+ Add Interface by Name"**
- Manual add button for bridges that auto-discovery cannot see,
  primarily pre-provisioning a `br-*` name that does not yet exist in
  the kernel. Accepts any existing bridge or a `br-*` name; rejects
  everything else.
- Adopted sections still default to mode `disabled`, `enabled` `0`, so
  a mis-typed name cannot lock anyone out.
- If a section's device does not yet exist in the kernel, the new
  orphan-detection table flags it — the user sees the honest state.

**rpcd — `remove_interface` method**
- New `do_remove_interface` RPC: refuses to delete any section whose
  interface still exists in the kernel. Only true orphans can be
  removed. Hard safety guard, not a UI check — even a direct ubus
  call cannot remove a healthy bridge.

**rpcd — `add_bridge` relaxed for pre-provisioning**
- Previously rejected any name without a `/sys/class/net/<iface>/bridge`
  entry. Now also accepts `br-*` names for pre-provisioning. Non-bridge,
  non-`br-*` names are still refused.

## [1.0.0-r6] — 2026-10-07

### Added

**Interfaces tab — auto-discovery of new kernel bridges**
- The Interfaces tab now calls the existing `list_bridges` RPC and
  renders an "Unmanaged bridges" table above the managed-bridge editor.
  Each kernel bridge not yet tracked in UCI gets a row with its subnet,
  operstate, an inline label input, and an **Adopt** button.
- Adopting a bridge creates a new `access_shield.<name>=interface`
  section with mode `disabled`, `enabled` `0`, `dhcp_allow` `1`, and
  `default_drop` `1`. Enforcement stays OFF until the user explicitly
  turns it on, so a freshly adopted bridge cannot lock anyone out.
- The Unmanaged-bridges table hides itself when every kernel bridge is
  already managed, so the UI is unchanged for existing setups.

**rpcd — `add_bridge` method**
- New `do_add_bridge` RPC: validates the target is a real kernel bridge
  (`/sys/class/net/<iface>/bridge` exists), refuses if already managed,
  generates a unique UCI section name, writes the new interface section,
  commits, and reloads the enforcement service.

## [1.0.0-r5] — 2026-10-07

### Added

**Dashboard — manual "Add Device by MAC"**
- New button at the top of the Dashboard opens a modal to bind a device
  by MAC, IP, interface, and name, without the device needing to appear
  in the discovery list first.
- Essential on strictly-enforced bridges (`reply_only` + `default_drop=1`),
  where unbound devices are dropped at prerouting before they can DHCP,
  so they never appear in `list_devices`. Previously the only way to add
  such a device was to SSH in and edit UCI by hand.
- Refuses MACs that are already bound (`do_bind_device` would otherwise
  reset `block_internet` to 0 and silently unblock the device).
- Validates MAC (`aa:bb:cc:dd:ee:ff`) and IPv4 formats client-side.

### Fixed

**Dashboard — search input lost focus after each keystroke (pre-existing)**
- Typing in the search box called `repaint()`, which rebuilt the entire
  view and replaced the input DOM node. The browser cannot preserve focus
  across a node swap, so users had to click the box again before every
  subsequent character. Focus and cursor position are now saved before
  `repaint()` and restored after the new tree is attached.

**Dashboard — dead click on empty-state row (pre-existing)**
- The "No devices match the current filter" row had a click handler that
  referenced `d.mac`, but `d` was scoped to the preceding `forEach` loop
  and did not exist in the empty-state block. Clicking the row threw
  `ReferenceError: d is not defined` inside the event handler and did
  nothing visible to the user. Handler removed; row is now static.
- More visible in r5 because the new Add Device workflow makes the empty
  state a routinely-hit path.

**Menu — Network → Access Shield landed on Setup instead of Dashboard**
- The parent menu entry uses `action: { type: "firstchild" }`, so the
  landing page is whichever child has the lowest `order` value. Setup
  was `order: 5`, Dashboard was `order: 10` — users landed on Setup.
  Dashboard's order is now `1`, so `firstchild` resolves to Dashboard.

## [1.0.0-r4] — 2026-10-07

### Fixed

**Interfaces tab — Save & Apply**
- `handleSaveApply` now calls `ui.changes.apply()` — the commit step was
  missing. Save & Apply previously staged changes in the browser, called
  the sync RPC to reload services, showed a success notification, but
  never wrote to UCI. The "unsaved changes" badge persisted after every
  save.

**Per-bridge enforcement toggles**
- `dhcp_allow` — now read in `apply_interface()`. When `0`, the DHCP
  accept rule (`udp dport 67`) is not emitted on that bridge's shield
  chain. Devices on this bridge cannot reach dnsmasq to obtain a lease.
- `default_drop` — now read in `apply_interface()`. When `0`, the final
  `meta nfproto ipv4 drop` rule is not emitted. The chain's `policy
  accept` takes over and non-whitelisted IPv4 continues to the forward
  hook.
- Both fields default to `1` when missing — preserves prior behavior for
  existing configurations. Only bridges with an explicit `0` change
  behavior.

### Added

**Layered enforcement documentation** — Help tab and README now describe
how the two toggles combine with the firewall zone forward policy and
dnsmasq's dynamic DHCP setting.

### Notes

Both toggles have been present in the UI since v1.0.0 but were never read
by the init script. On routers where fw4's zone forward policy is REJECT
(the OpenWrt default) and dnsmasq has `dynamicdhcp=0`, the observable
effect is masked by those layers — see Help tab for the decision matrix.

## [1.0.0] — 2026-10-06

### Added

**Core enforcement**
- Prerouting nftables packet filter (`inet access_shield_fw`) with per-bridge MAC+IP whitelist
- Per-bridge ARP mode: `disabled` / `loose` / `reply_only`
- Static-only DHCP mirroring (`allocated_by=access_shield`)
- Rogue DHCP shield (DHCP accept rule per protected bridge)
- Admin self-safeguard — auto-binds current SSH/LuCI session before rule apply

**Device management**
- Unified device discovery (DHCP + ARP + IPv6 neighbor + WiFi association)
- Dashboard with per-row Edit / Block / Allow / Bind / Unbind / Rename / Issue Ticket
- Friendly device aliases override DHCP hostnames
- Search + 4 filters (bound, state, link, access)

**Traffic control**
- Per-device rate limits — nftables `limit rate over` with Mbps/MBps/Kbps/KBps units
- Per-subnet aggregate bandwidth limits (auto-detects bridges)
- Live traffic monitor with per-device upload/download rates (conntrack)
- Speed limit column on Traffic tab

**Temporary access**
- Ticket system — grant time-limited access to blocked devices
- 10-second expiry daemon with auto-revocation
- Ticket accept rules run before block drops (nftables priority 1 vs 5)
- Ticket badge with live countdown on Dashboard

**Wireless**
- Per-SSID MAC filter management (hostapd `macfilter`/`maclist`)
- Device dropdown + custom MAC input
- WiFi reload on apply

**Firewall**
- Per-device internet block toggle
- Firewall zone reference table (read-only)
- Chain ordering documentation

**Setup & docs**
- 7-step setup wizard with progress bar
- Status dashboard (6 environment checks at a glance)
- Help tab with full documentation
- Migration tool from `luci-app-arpbind`

### Architecture

- 5 isolated nftables tables: `fw`, `block`, `shape`, `subnet`, `ticket`
- Each service has its own procd init script
- Priority chain: ticket(1) → block(5) → shape(10) → subnet(15)
- Auto-rollback on dnsmasq failure (snapshot/restore DHCP)
- Never modifies user's firewall (fw4) config

### Compatibility

- OpenWrt 23.05+ / 24.10+
- ImmortalWrt 23.05+ / 24.10+
- opkg and apk
- All architectures (`LUCI_PKGARCH := all`)

### Tested on

- Imou LC-HX3001 (mediatek/filogic, aarch64, ImmortalWrt 24.10.6)

### Known limitations

- IPv6 whitelist enforcement: planned for v1.1 (currently filters IPv4 only)
- Bandwidth monitor accuracy depends on flow offloading state (detected, not auto-changed)
- Wireless MAC filter requires `hostapd`-managed AP-mode interfaces

### Migrated from `luci-app-arpbind`

The v1.0.0 release includes a one-shot migration tool:
- Reads all 21 legacy arpbind bindings
- Imports them into `access_shield` config as `binding` sections
- Preserves per-device names, IPs, MACs, and iface assignments
- Deletes legacy `dhcp.lan2_arpbind_*` entries
- Preserves old `arp_rosd` UCI config as fallback
