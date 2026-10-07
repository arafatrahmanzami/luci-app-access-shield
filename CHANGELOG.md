# Changelog

All notable changes to Access Shield are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

