'use strict';
'require view';

function section(title, items) {
    return E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:1.5em' }, [
        E('h3', { 'style': 'margin-bottom:0.5em' }, title),
        E('div', {}, items.map(function(it) {
            return E('div', { 'style': 'margin-bottom:0.8em' }, [
                E('strong', {}, it.k + ': '),
                E('span', { 'style': 'opacity:0.9' }, it.v)
            ]);
        }))
    ]);
}

function step(n, text) {
    return E('div', { 'style': 'margin-bottom:0.4em' }, [
        E('strong', {}, n + '. '),
        text
    ]);
}

function warn(text) {
    return E('div', {
        'style': 'background:rgba(230,126,34,0.1);border-left:3px solid #e67e22;padding:10px;margin:1em 0'
    }, [ E('strong', {}, '⚠ '), text ]);
}

function tip(text) {
    return E('div', {
        'style': 'background:rgba(39,174,96,0.1);border-left:3px solid #27ae60;padding:10px;margin:1em 0'
    }, [ E('strong', {}, '💡 '), text ]);
}

function code(cmd) {
    return E('pre', {
        'style': 'background:#111;color:#eee;padding:10px;border-radius:4px;overflow-x:auto;font-size:12px;margin:0.5em 0'
    }, cmd);
}

return view.extend({
    render: function() {
        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, _('Access Shield')),
            E('p', { 'style': 'opacity:0.85;font-size:0.95em;margin-top:-4px;margin-bottom:24px' },
                _('Device Access Control & Traffic Monitor — Documentation')),

            section('Overview', [
                { k: 'What it does', v: 'Enforces MAC+IP whitelist on protected bridges via nftables packet filtering. Devices not on the whitelist are isolated. Provides device management, traffic monitoring, per-device rate limits, per-subnet limits, and temporary-access tickets.' },
                { k: 'Protection model', v: 'Prerouting packet filter. Every packet entering a protected bridge is checked against a whitelist. Non-matching IPv4 traffic is dropped at the kernel level — before routing, before reaching any service.' },
                { k: 'Admin safeguard', v: 'Your current session is auto-bound to the whitelist before any enforcement rule is applied. Prevents lockout even on single-bridge routers.' }
            ]),

            section('Tabs Overview', [
                { k: 'Setup', v: 'Step-by-step first-time configuration wizard. 7 steps covering bridge, admin binding, DHCP, firewall zone, interface mode, master switch, and adding devices.' },
                { k: 'Status', v: 'At-a-glance check of all 6 environment requirements. Shows ✓ or ⚠ for each with actionable buttons to fix issues.' },
                { k: 'Dashboard', v: 'Unified device inventory. Combines DHCP leases, ARP table, IPv6 neighbors, and WiFi associations. Per-row actions: Edit, Block, Allow, Bind, Unbind, Rename, Issue Ticket.' },
                { k: 'Traffic', v: 'Live per-device upload/download rates from conntrack. Includes per-subnet bandwidth limits section.' },
                { k: 'Interfaces', v: 'Per-bridge mode selection: disabled / loose / reply_only. Bridge labels for friendly names.' },
                { k: 'Wireless', v: 'Per-SSID MAC filtering via hostapd. Allow or deny specific devices per SSID.' },
                { k: 'Firewall', v: 'Per-device internet block toggles. Zone configuration reference (read-only). Chain ordering reference.' },
                { k: 'Settings', v: 'Global feature toggles, admin safeguard, compatibility mode, default interface, migration tools.' },
                { k: 'Help', v: 'This page.' }
            ]),

            section('Feature Reference', [
                { k: 'Aliases', v: 'Friendly names ("Front Door Cam") override DHCP hostnames. Priority: alias > binding name > DHCP hostname > MAC.' },
                { k: 'Speed Limits', v: 'Per-device nftables rate limiting. Units: Mbps / MBps / Kbps / KBps.' },
                { k: 'Subnet Limits', v: 'Aggregate rate caps per bridge. Applies to all traffic forwarded across the subnet.' },
                { k: 'Tickets', v: 'Grant temporary access to a blocked device. Auto-expires after the given duration. Perfect for guests. Priority 1 chain accepts before block drops.' },
                { k: 'Blocks', v: 'Per-device internet denial, scoped by iifname (bridge). Same MAC on a different bridge stays unaffected.' }
            ]),

            section('Interface Toggles — Layered Enforcement', [
                { k: 'dhcp_allow', v: 'Controls whether devices on this bridge can reach dnsmasq to obtain an IP. When 0, the DHCP accept rule (UDP 67) is not added to the shield chain. Effect is only observable when dnsmasq has a dynamic range (dynamicdhcp=1) on this bridge — with dynamicdhcp=0, dnsmasq ignores unlisted MACs anyway, so the toggle is masked.' },
                { k: 'default_drop', v: 'Controls whether the shield chain ends with a catch-all IPv4 drop. When 0, non-whitelisted IPv4 falls through to fw4 forward hook. Effect is only observable when the zone forward policy is not already REJECT/DROP.' },
                { k: 'Why they sometimes appear to do nothing', v: 'Enforcement is layered: access_shield_fw (prerouting, priority -150) runs first, then access_shield_block (forward, +5), shape (+10), subnet (+15), then fw4 (forward, priority filter=0). If an earlier layer already blocks traffic, later layers never see it. On most OpenWrt routers, fw4 forward=REJECT provides what default_drop=1 does, and dynamicdhcp=0 provides what dhcp_allow=0 does. The toggles matter on permissive zones or bridges with dynamic DHCP.' },
                { k: 'Decision guide', v: 'Strict (cameras/IoT): dhcp_allow=1 + default_drop=1. Monitoring: dhcp_allow=1 + default_drop=0 (needs zone forward != REJECT). Zero DHCP to unknowns: dhcp_allow=0 + default_drop=1. Loose whitelist-as-allow-only: 0 + 0 (needs permissive zone + static leases).' }
            ]),

            section('Getting Started', [
                step(1, E('span', {}, ['Open ', E('strong', {}, 'Setup'), ' and follow the wizard through Step 7.'])),
                step(2, E('span', {}, ['Verify with ', E('strong', {}, 'Status'), ' — all 6 checks should be ✓.'])),
                step(3, E('span', {}, ['Go to ', E('strong', {}, 'Dashboard'), ' to add or scan for devices.'])),
                step(4, E('span', {}, ['Use ', E('strong', {}, 'Firewall'), ' for per-device internet on/off.']))
            ]),

            warn('Before enabling reply_only on any bridge, ensure at least one device you can reach the router from is already bound. Otherwise you may lock yourself out.'),

            section('Safety Notes', [
                { k: 'Admin safeguard', v: 'Enabled by default. Before any rule is applied, your current management session is auto-bound. Cannot be disabled via UI.' },
                { k: 'Ticket priority', v: 'Ticket accept rules run at priority 1, before block drops at priority 5. A ticketed device bypasses its block without affecting others.' },
                { k: 'Block scope', v: 'Per-device blocks only apply on the bridge defined in the binding (iifname matching). Same MAC on another bridge is unaffected.' },
                { k: 'Rate limits', v: 'Applied via nftables limit counters. Traffic exceeding the limit is dropped, not shaped.' },
                { k: 'Reboot persistence', v: 'All services are enabled at boot via procd. Enforcement rules are re-applied automatically.' }
            ]),

            section('Chain Ordering', [
                { k: 'priority 1', v: 'access_shield_ticket — temporary access (accepts before any drop)' },
                { k: 'priority 5', v: 'access_shield_block — per-device internet block drops' },
                { k: 'priority 10', v: 'access_shield_shape — per-device rate limits' },
                { k: 'priority 15', v: 'access_shield_subnet — per-subnet aggregate limits' },
                { k: 'prerouting', v: 'access_shield_fw — MAC+IP whitelist enforcement (before routing)' }
            ]),

            section('CLI Reference', [
                { k: 'Main service status', v: code('/etc/init.d/access-shield status') },
                { k: 'Block chain status', v: code('/etc/init.d/access-shield-block status') },
                { k: 'Rate limit status', v: code('/etc/init.d/access-shield-shape status') },
                { k: 'Ticket daemon', v: code('/etc/init.d/access-shield-ticketd status') },
                { k: 'Full enforcement rules', v: code('nft list table inet access_shield_fw') },
                { k: 'Current blocks', v: code('nft list table inet access_shield_block') },
                { k: 'Active tickets', v: code('ubus call luci.access_shield list_tickets "{}"') }
            ]),

            section('Troubleshooting', [
                { k: 'Device can\'t get internet', v: 'Check if it\'s blocked (Dashboard shows "blocked" badge). Click "Allow" or issue a ticket.' },
                { k: 'Device can\'t get an IP', v: 'Verify the MAC is bound in Dashboard. br-lan2 uses static-lease-only — unlisted devices get no DHCP lease.' },
                { k: 'Rate limit not working', v: 'Verify shape service: /etc/init.d/access-shield-shape status. Check rules: nft list table inet access_shield_shape.' },
                { k: 'Ticket expired but device still has internet', v: 'Daemon checks every 10 seconds. Wait 15s, then check: nft list table inet access_shield_block.' },
                { k: 'Lost access to router', v: 'Connect from a different bridge if available. Or reboot — services reload from config. Admin device is bound at next apply.' }
            ]),

            section('Backup & Restore', [
                { k: 'Config backup', v: 'Copy /etc/config/access_shield and /etc/config/dhcp to a safe location.' },
                { k: 'nftables backup', v: code('nft list ruleset > nft-backup.txt') },
                { k: 'Rollback', v: code('for s in access-shield access-shield-block access-shield-shape access-shield-subnet access-shield-ticketd; do /etc/init.d/$s stop; /etc/init.d/$s disable; done') }
            ]),

            tip('Access Shield writes to isolated nft tables. Your existing firewall config (fw4) is never modified.')
        ]);
    },
    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});
