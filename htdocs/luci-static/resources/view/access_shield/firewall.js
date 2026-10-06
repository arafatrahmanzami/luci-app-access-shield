'use strict';
'require view';
'require uci';
'require ui';
'require rpc';

var callListBindings = rpc.declare({ object: 'luci.access_shield', method: 'list_bindings' });
var callSetBlock     = rpc.declare({ object: 'luci.access_shield', method: 'set_block', params: ['mac','block'] });

function unwrap(d, k) {
    if (!d) return [];
    if (Array.isArray(d)) return d;
    if (typeof d === 'object' && Array.isArray(d[k])) return d[k];
    if (typeof d === 'string') { try { var p = JSON.parse(d); return p[k] || []; } catch(e) {} }
    return [];
}

return view.extend({
    load: function() {
        return Promise.all([ uci.load('access_shield'), uci.load('firewall'), callListBindings() ]);
    },

    render: function(data) {
        var container = E('div', { 'id': 'fw-page' });
        var bindings = unwrap(data[2], 'bindings');

        function reload() {
            return callListBindings().then(function(r) {
                bindings = unwrap(r, 'bindings');
                repaint();
            });
        }

        function badge(text, bg) {
            return E('span', { 'style': 'display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;background:' + bg + ';color:#fff' }, text);
        }

        function buildBindingsTable() {
            var rows = [ E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th' }, _('Device')),
                E('th', { 'class': 'th' }, _('IP')),
                E('th', { 'class': 'th' }, _('MAC')),
                E('th', { 'class': 'th' }, _('Interface')),
                E('th', { 'class': 'th' }, _('Access')),
                E('th', { 'class': 'th' }, _('Action'))
            ]) ];

            if (bindings.length === 0) {
                rows.push(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td', 'colspan': 6, 'style': 'text-align:center;padding:16px;color:#888' },
                        _('No devices bound. Add via Dashboard first.'))
                ]));
            }

            bindings.forEach(function(b) {
                var blocked = b.block === '1';
                var enabled = b.enabled === '1';

                var accessCell = blocked
                    ? badge(_('⛔ Blocked'), '#e74c3c')
                    : badge(_('✓ Allowed'), '#27ae60');

                var action = !enabled
                    ? E('span', { 'style': 'color:#888;font-size:12px' }, _('(disabled)'))
                    : E('button', {
                        'class': blocked ? 'cbi-button cbi-button-apply' : 'cbi-button cbi-button-negative',
                        'style': 'font-size:12px',
                        'click': ui.createHandlerFn(this, function() {
                            return callSetBlock(b.mac, blocked ? '0' : '1').then(function() {
                                ui.addNotification(null, E('p', {}, blocked ? _('Allowed.') : _('Blocked.')), 'info');
                                return new Promise(function(r) { setTimeout(r, 500); });
                            }).then(reload);
                        })
                    }, blocked ? _('🔓 Allow') : _('⛔ Block'));

                rows.push(E('tr', { 'class': 'tr', 'style': enabled ? '' : 'opacity:0.5' }, [
                    E('td', { 'class': 'td' }, [ E('strong', {}, b.name || '(unnamed)') ]),
                    E('td', { 'class': 'td' }, [ b.ip || '—' ]),
                    E('td', { 'class': 'td', 'style': 'font-family:monospace;font-size:11px' }, [ b.mac ]),
                    E('td', { 'class': 'td' }, [ b.iface || '—' ]),
                    E('td', { 'class': 'td' }, [ accessCell ]),
                    E('td', { 'class': 'td' }, [ action ])
                ]));
            });

            return E('table', { 'class': 'table' }, rows);
        }

        function buildZoneTable() {
            var rows = [ E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th' }, _('Zone')),
                E('th', { 'class': 'th' }, _('Networks')),
                E('th', { 'class': 'th' }, _('Input')),
                E('th', { 'class': 'th' }, _('Forward')),
                E('th', { 'class': 'th' }, _('Output'))
            ]) ];

            uci.sections('firewall', 'zone').forEach(function(z) {
                rows.push(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td' }, [ E('strong', {}, z.name || '') ]),
                    E('td', { 'class': 'td', 'style': 'font-size:12px' }, [
                        Array.isArray(z.network) ? z.network.join(', ') : (z.network || '—')
                    ]),
                    E('td', { 'class': 'td' }, [ z.input || '—' ]),
                    E('td', { 'class': 'td' }, [ z.forward || '—' ]),
                    E('td', { 'class': 'td' }, [ z.output || '—' ])
                ]));
            });

            return E('table', { 'class': 'table' }, rows);
        }

        function repaint() {
            while (container.firstChild) container.removeChild(container.firstChild);

            var enabled = bindings.filter(function(b) { return b.enabled === '1'; });
            var blocked = enabled.filter(function(b) { return b.block === '1'; });
            var allowed = enabled.length - blocked.length;

            container.appendChild(E('div', {}, [
                E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:16px' }, [
                    E('strong', {}, _('Devices: ')), String(enabled.length), '  |  ',
                    E('strong', { 'style': 'color:#27ae60' }, _('Allowed: ')), String(allowed), '  |  ',
                    E('strong', { 'style': 'color:#e74c3c' }, _('Blocked: ')), String(blocked.length)
                ]),

                E('div', { 'class': 'cbi-section' }, [
                    E('h3', {}, _('Per-Device Internet Access')),
                    E('p', { 'style': 'font-size:13px;color:#888;margin-top:-8px;margin-bottom:12px' },
                        _('Toggle internet for each bound device. Changes apply immediately.')),
                    buildBindingsTable()
                ]),

                E('div', { 'class': 'cbi-section' }, [
                    E('h3', {}, _('Firewall Zones (read-only)')),
                    E('p', { 'style': 'font-size:13px;color:#888;margin-top:-8px;margin-bottom:12px' },
                        _('Access Shield does not modify zones. Edit them in Network → Firewall.')),
                    buildZoneTable()
                ]),

                E('div', { 'class': 'cbi-section' }, [
                    E('h3', {}, _('Chain Order (priority)')),
                    E('pre', {
                        'style': 'background:#111;color:#eee;padding:12px;border-radius:4px;font-size:12px;line-height:1.6;overflow-x:auto'
                    },
                        'priority 1   access_shield_ticket  ← temporary access (bypasses blocks)\n' +
                        'priority 5   access_shield_block   ← per-device internet block\n' +
                        'priority 10  access_shield_shape   ← per-device rate limits\n' +
                        'priority 15  access_shield_subnet  ← per-subnet aggregate limits\n' +
                        'prerouting   access_shield_fw      ← MAC+IP whitelist enforcement'
                    )
                ])
            ]));
        }

        repaint();

        return E('div', {}, [
            E('h2', {}, _('Access Shield')),
            E('p', { 'style': 'opacity:0.85;font-size:0.95em;margin-top:-4px;margin-bottom:16px' },
                _('Device Access Control & Traffic Monitor')),
            container
        ]);
    },

    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});
