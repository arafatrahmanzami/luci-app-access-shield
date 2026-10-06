# luci-app-access-shield

**Access Shield** — Device Access Control & Traffic Monitor for OpenWrt.

A modern replacement for `luci-app-arpbind`, combining kernel-level MAC+IP
whitelist enforcement with device management, per-device and per-subnet
traffic control, and temporary-access tickets.

## Features

### Enforcement
- **Prerouting packet filter** — MAC+IP whitelist enforced via nftables at the
  kernel level. Unauthorized devices are isolated before routing.
- **Static DHCP only mode** — dnsmasq serves leases only to whitelisted MACs.
- **Admin safeguard** — auto-binds the managing session before applying any rule.
  Prevents lockout even on single-bridge routers.
- **Rogue DHCP shield** — blocks unauthorized DHCP servers on protected bridges.

### Management
- **Dashboard** — unified device inventory combining DHCP leases, ARP table,
  IPv6 neighbors, and WiFi associations. Per-row actions: Edit, Block, Allow,
  Bind, Unbind, Rename, Issue Ticket.
- **Device aliases** — friendly names override DHCP hostnames.
  Priority: alias > binding name > DHCP hostname > MAC.
- **Wireless MAC filter** — per-SSID allow/deny lists via hostapd.

### Traffic Control
- **Per-device speed limits** — nftables rate limiting.
  Units: Mbps / MBps / Kbps / KBps.
- **Per-subnet bandwidth limits** — aggregate caps per bridge.
- **Live traffic monitor** — per-device upload/download rates from conntrack.
- **Ticket system** — grant temporary access with auto-expiry.
  Perfect for guests and one-time visitors.

## Architecture

| Layer | Implementation | Config |
|---|---|---|
| Enforcement | `inet access_shield_fw` | `/etc/config/access_shield` |
| Internet block | `inet access_shield_block` | bindings |
| Rate limits | `inet access_shield_shape` | `config limit` |
| Subnet limits | `inet access_shield_subnet` | `config subnet` |
| Tickets | `inet access_shield_ticket` | `config ticket` |
| Device aliases | (no kernel table) | `config alias` |
| DHCP mirror | `/etc/config/dhcp` | tag `allocated_by=access_shield` |

## Safety Model

Every feature writes to its own isolated nftables table. The enforcement
table (`access_shield_fw`) is only managed by the main init script — no other
feature ever touches it.

The init scripts handle dnsmasq reload with health checks and auto-rollback:

1. Snapshot DHCP config before modifying.
2. Write new entries.
3. Reload dnsmasq (not restart).
4. Check `pgrep dnsmasq` — if dead, restore snapshot.
5. If still dead, force start.
6. Log everything to syslog.

## Dependencies

Required:
- `luci-base`
- `nftables`
- `kmod-nft-core`
- `kmod-nft-bridge`

Optional (for bandwidth monitoring):
- `conntrack`
- `kmod-nf-conntrack-netlink`

## Post-Install Behavior

**Nothing runs after install.** All toggles default to OFF. The master switch
must be explicitly enabled via LuCI before any enforcement begins.

## Compatibility

- OpenWrt 23.05+ / 24.10+
- ImmortalWrt 23.05+ / 24.10+
- opkg and apk package managers
- All architectures (LUCI_PKGARCH := all)

## Installation

### From .ipk
    opkg update
    opkg install luci-app-access-shield_*.ipk

### From source (SDK)
    make package/luci-app-access-shield/compile V=s

### Configuration

After install:
1. Open LuCI → **Network → Access Shield**
2. Go to **Settings** → enable master switch
3. Go to **Interfaces** → set `mode=reply_only` on the bridge to protect
4. Go to **Dashboard** → add devices (Bind) or use **Scan & Bind**
5. Click **Save & Apply**

## CLI Reference

    # Check status
    /etc/init.d/access-shield status

    # Trigger sync manually
    /etc/init.d/access-shield reload

    # Ticket daemon status
    /etc/init.d/access-shield-ticketd status

    # Shape (rate limit) status
    /etc/init.d/access-shield-shape status

    # Subnet limit status
    /etc/init.d/access-shield-subnet status

## Reboot Persistence

All services are enabled at boot via procd. Boot order:
- `S95access-shield` — enforcement
- `S96access-shield-block` — per-device block
- `S97access-shield-shape` — rate limits
- `S97access-shield-subnet` — subnet limits
- `S98access-shield-ticket` — ticket rules
- `S99access-shield-ticketd` — expiry daemon

## Rollback

If something breaks:

    # Stop new, restore old
    /etc/init.d/access-shield stop
    nft delete table inet access_shield_fw 2>/dev/null

    # Revert UCI if you kept the backup
    # (restore from your pre-migration backup tarball)
    # ...etc

Or run the RESTORE.sh from any backup tarball in `~/backups/`.

## License

Apache-2.0 — see [LICENSE](LICENSE)

## Author

Arafat Rahman Zami <zamimondol@gmail.com>
GitHub: [@arafatrahmanzami](https://github.com/arafatrahmanzami)

## Contributing

Issues and pull requests welcome at the GitHub repository.
