'use strict';
'require view';
'require uci';
'require ui';
'require rpc';

var callScan  = rpc.declare({ object: 'luci.access_shield', method: 'setup_scan' });
var callApply = rpc.declare({ object: 'luci.access_shield', method: 'setup_apply', params: ['step'] });

return view.extend({
    load: function() {
        return Promise.all([ uci.load('access_shield'), callScan() ]);
    },

    render: function(data) {
        var container = E('div');
        var scan = data[1] || {};
        var current = 0;
        var busy = false;

        function buildAllSteps() {
            var list = [];
            var s = scan.target_state || {};
            var admin = scan.admin_binding || {};

            // Step 1 — pick bridge
            var bridgeSel = E('select', { 'style': 'padding:6px;min-width:280px;font-size:14px' },
                (scan.bridges || []).map(function(b) {
                    return E('option', {
                        'value': b.name,
                        'selected': b.name === scan.target_bridge ? true : null
                    }, b.name + ' (' + b.subnet + ')');
                }));

            list.push({
                title: _('Choose Bridge to Protect'),
                body: E('div', {}, [
                    E('p', {}, _('Which bridge should enforce the whitelist?')),
                    E('ul', { 'style': 'margin-left:20px;color:#aaa' }, [
                        E('li', {}, _('br-lan2 — IoT / camera network (typical)')),
                        E('li', {}, _('br-lan — main LAN (higher risk)')),
                        E('li', {}, _('br-lan3 / br-guest — secondary networks'))
                    ]),
                    E('p', { 'style': 'margin-top:12px' }, [
                        E('label', {}, _('Target bridge: ')), bridgeSel
                    ])
                ]),
                action: {
                    label: _('Save & Continue'),
                    run: function() {
                        if (bridgeSel.value === scan.target_bridge) return Promise.resolve({ ok: 1 });
                        return callApply({ step: 'set_default_iface', iface: bridgeSel.value });
                    }
                }
            });

            // Step 2 — admin safeguard
            var aBody, aAction = null;
            if (admin.bound) {
                aBody = E('div', {}, [
                    E('p', { 'style': 'color:#27ae60;font-weight:bold' }, '✓ ' + _('Your device is already bound.')),
                    E('p', {}, _('Name: ') + (admin.name || '?') + ' · ' + _('Interface: ') + (admin.iface || '?'))
                ]);
            } else if (scan.admin_ip && scan.admin_mac) {
                aBody = E('div', {}, [
                    E('p', { 'style': 'color:#e67e22;font-weight:bold' }, '⚠ ' + _('Not yet bound.')),
                    E('p', {}, scan.admin_ip + ' · ' + scan.admin_mac + ' · ' + (scan.admin_iface || '?'))
                ]);
                aAction = {
                    label: _('Bind my device'),
                    run: function() {
                        return callApply({
                            step: 'bind_admin',
                            mac: scan.admin_mac,
                            ip: scan.admin_ip,
                            iface: scan.admin_iface || scan.target_bridge,
                            name: 'Admin-Safeguard'
                        });
                    }
                };
            } else {
                aBody = E('div', {}, [
                    E('p', { 'style': 'color:#e74c3c;font-weight:bold' }, '✗ ' + _('Cannot detect your session.')),
                    E('p', {}, _('Bind your device manually in Dashboard first.'))
                ]);
            }
            list.push({ title: _('Admin Safeguard'), body: aBody, action: aAction });

            // Step 3 — DHCP static-only
            var dhcpSec = s.dhcp_section || '';
            var dhcpDyn = s.dhcp_dynamic || '';
            var dBody, dAction = null;
            if (!dhcpSec) {
                dBody = E('p', { 'style': 'color:#e67e22' }, '⚠ ' + _('No DHCP section found.'));
            } else if (dhcpDyn === '0') {
                dBody = E('p', { 'style': 'color:#27ae60;font-weight:bold' }, '✓ ' + _('DHCP is static-only.'));
            } else {
                dBody = E('div', {}, [
                    E('p', { 'style': 'color:#e67e22;font-weight:bold' }, '⚠ ' + _('DHCP serves dynamic leases.')),
                    E('p', {}, _('Recommended: static-only so unlisted devices get no IP.'))
                ]);
                dAction = {
                    label: _('Make static-only'),
                    run: function() { return callApply({ step: 'ensure_dhcp_static', section: dhcpSec }); }
                };
            }
            list.push({ title: _('Static-Only DHCP'), body: dBody, action: dAction });

            // Step 4 — firewall zone
            var zn = s.firewall_zone_name || '';
            var ad = s.zone_allows_dhcp, an = s.zone_allows_dns, al = s.zone_allows_luci;
            var zBody, zAction = null;
            if (!zn) {
                zBody = E('p', { 'style': 'color:#e67e22' }, '⚠ ' + _('No firewall zone found.'));
            } else if (ad && an && al) {
                zBody = E('p', { 'style': 'color:#27ae60;font-weight:bold' }, '✓ ' + _('Zone "') + zn + _('" allows DHCP, DNS and LuCI.'));
            } else {
                var missing = [];
                if (!ad) missing.push('DHCP');
                if (!an) missing.push('DNS');
                if (!al) missing.push('LuCI');
                zBody = E('div', {}, [
                    E('p', { 'style': 'color:#e67e22;font-weight:bold' }, '⚠ ' + _('Missing in zone "') + zn + _('": ') + missing.join(', ')),
                    E('p', {}, _('Devices may fail to reach the router.'))
                ]);
                zAction = {
                    label: _('Add missing rules'),
                    run: function() {
                        return callApply({
                            step: 'ensure_zone_rules',
                            zone: zn,
                            dhcp: !ad ? '1' : '0',
                            dns:  !an ? '1' : '0',
                            luci: !al ? '1' : '0'
                        });
                    }
                };
            }
            list.push({ title: _('Firewall Zone Rules'), body: zBody, action: zAction });

            // Step 5 — interface mode
            var mode = s.interface_mode || 'disabled';
            var iBody, iAction = null;
            if (mode === 'reply_only') {
                iBody = E('p', { 'style': 'color:#27ae60;font-weight:bold' }, '✓ ' + _('Bridge is reply_only — enforcement active.'));
            } else {
                iBody = E('p', { 'style': 'color:#e67e22;font-weight:bold' }, '⚠ ' + _('Current mode: ') + mode);
                iAction = {
                    label: _('Set reply_only'),
                    run: function() { return callApply({ step: 'set_interface_mode', mode: 'reply_only' }); }
                };
            }
            list.push({ title: _('Enforcement Mode'), body: iBody, action: iAction });

            // Step 6 — master switch
            var on = scan.master && scan.master.enabled === '1';
            list.push({
                title: _('Master Switch'),
                body: E('p', { 'style': on ? 'color:#27ae60;font-weight:bold' : 'color:#e67e22;font-weight:bold' },
                    on ? '✓ ' + _('Running.') : '⚠ ' + _('Currently OFF.')),
                action: {
                    label: on ? _('Turn OFF') : _('Turn ON'),
                    run: function() { return callApply({ step: on ? 'disable_master' : 'enable_master' }); }
                }
            });

            // Step 7 — add devices
            var bcount = uci.sections('access_shield', 'binding').length;
            list.push({
                title: _('Add Devices'),
                body: E('div', {}, [
                    E('p', {}, _('Setup complete. ') + bcount + _(' device(s) bound.')),
                    E('p', {}, _('Use Dashboard to add more or scan the network.'))
                ]),
                action: null,
                final: true
            });

            return list;
        }

        function paint() {
            while (container.firstChild) container.removeChild(container.firstChild);

            var list = buildAllSteps();
            var st = list[current];
            var pct = Math.round(((current + 1) / list.length) * 100);

            var progress = E('div', { 'style': 'margin-bottom:20px' }, [
                E('div', { 'style': 'display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px' }, [
                    E('span', {}, _('Step ') + (current + 1) + _(' of ') + list.length),
                    E('span', { 'style': 'opacity:0.7' }, pct + '%')
                ]),
                E('div', { 'style': 'background:#333;height:6px;border-radius:3px' }, [
                    E('div', { 'style': 'background:#4a9eff;height:100%;width:' + pct + '%;border-radius:3px' })
                ])
            ]);

            var card = E('div', {
                'style': 'background:rgba(74,158,255,0.05);border:1px solid rgba(74,158,255,0.3);border-radius:6px;padding:20px;margin-bottom:16px'
            }, [
                E('h2', { 'style': 'margin-top:0;margin-bottom:12px' }, st.title),
                st.body
            ]);

            var back = current > 0 ? E('button', {
                'class': 'cbi-button',
                'click': function() { current--; paint(); }
            }, _('← Back')) : null;

            var act = st.action ? E('button', {
                'class': 'cbi-button cbi-button-action',
                'style': 'margin-left:8px',
                'disabled': busy ? 'disabled' : null,
                'click': function() {
                    if (busy) return;
                    busy = true;
                    st.action.run().then(function(r) {
                        busy = false;
                        if (r && r.ok) ui.addNotification(null, E('p', {}, _('Applied.')), 'info');
                        else ui.addNotification(null, E('p', {}, _('Failed: ') + (r.error || '?')), 'error');
                        return new Promise(function(x) { setTimeout(x, 500); });
                    }).then(callScan).then(function(ns) {
                        scan = ns || {};
                        paint();
                    }).catch(function(e) {
                        busy = false;
                        ui.addNotification(null, E('p', {}, String(e)), 'error');
                    });
                }
            }, st.action.label) : null;

            var next = st.final ? E('button', {
                'class': 'cbi-button cbi-button-apply',
                'style': 'margin-left:8px',
                'click': function() { window.location.href = L.url('admin/network/access_shield/dashboard'); }
            }, _('Go to Dashboard →')) : E('button', {
                'class': 'cbi-button cbi-button-apply',
                'style': 'margin-left:8px',
                'click': function() { current++; paint(); }
            }, _('Next →'));

            container.appendChild(E('div', {}, [
                progress, card,
                E('div', { 'style': 'display:flex;justify-content:flex-end;margin-top:16px' }, [
                    back || '', act || '', next
                ])
            ]));
        }

        paint();

        return E('div', {}, [
            E('h2', {}, _('Access Shield')),
            E('p', { 'style': 'opacity:0.85;font-size:0.95em;margin-top:-4px;margin-bottom:16px' },
                _('Device Access Control & Traffic Monitor — Setup Wizard')),
            container
        ]);
    },

    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});
