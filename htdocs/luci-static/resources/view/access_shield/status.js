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
        var container = E('div', { 'id': 'setup-wizard' });
        var scan = data[1] || {};
        var applying = false;

        function step(name, title, status, body, action) {
            var statusClass = {
                'ok':      'background:rgba(39,174,96,0.1);border-left:3px solid #27ae60;',
                'warn':    'background:rgba(230,126,34,0.1);border-left:3px solid #e67e22;',
                'missing': 'background:rgba(231,76,60,0.1);border-left:3px solid #e74c3c;',
                'skip':    'background:rgba(136,136,136,0.1);border-left:3px solid #888;'
            }[status] || '';

            var icon = { 'ok': '✓', 'warn': '⚠', 'missing': '✗', 'skip': '—' }[status] || '·';

            return E('div', {
                'class': 'cbi-section',
                'style': statusClass + 'padding:12px;margin-bottom:12px'
            }, [
                E('h3', { 'style': 'margin-top:0' }, icon + ' ' + title),
                E('div', { 'style': 'font-size:13px;color:#ccc;margin-bottom:8px' }, body),
                action ? E('div', {}, [ action ]) : ''
            ]);
        }

        function applyStep(stepName, params) {
            if (applying) return;
            applying = true;

            var payload = Object.assign({}, params || {});
            payload.step = stepName;

            return callApply(payload).then(function(r) {
                applying = false;
                if (r && r.ok) {
                    ui.addNotification(null, E('p', {}, _('Step applied successfully.')), 'info');
                } else {
                    ui.addNotification(null, E('p', {}, _('Step failed: ') + (r.error || 'unknown')), 'error');
                }
                return new Promise(function(res) { setTimeout(res, 1000); });
            }).then(function() {
                return callScan();
            }).then(function(newScan) {
                scan = newScan || {};
                repaint();
            }).catch(function(e) {
                applying = false;
                ui.addNotification(null, E('p', {}, String(e)), 'error');
            });
        }

        function buildSteps() {
            var steps = [];

            var has_bridge = scan.target_state && scan.target_state.exists;
            var master = scan.master && scan.master.enabled === '1';
            var admin = scan.admin_binding || {};
            var target = scan.target_bridge || 'br-lan2';
            var bridge_info = '';

            if (scan.bridges && scan.bridges.length) {
                bridge_info = scan.bridges.map(function(b) {
                    return b.name + ' (' + b.subnet + ')';
                }).join(' · ');
            }

            // ── Step 1 — Environment ────────────────────────────
            var step1_status = has_bridge ? 'ok' : 'missing';
            var step1_body = has_bridge
                ? _('Target bridge: ') + target + ' · IP: ' + (scan.target_state.ip || '—') + ' · Other bridges: ' + bridge_info
                : _('Target bridge ') + target + _(' not found. Configure one in Network → Interfaces.');

            steps.push(step(1, _('Target Bridge'), step1_status, step1_body, null));

            // ── Step 2 — Admin binding (safety) ────────────────
            var step2_status = admin.bound ? 'ok' : 'warn';
            var step2_body;
            var step2_action;

            if (admin.bound) {
                step2_body = _('Your session (') + (scan.admin_ip || '?') + _(', on ') + (scan.admin_iface || '?') + _(') is bound as "') + (admin.name || '?') + _('". Enforcement will not lock you out.');
            } else if (scan.admin_ip && scan.admin_mac) {
                step2_body = _('Your session is at ') + scan.admin_ip + _(' (MAC ') + scan.admin_mac + _(', on ') + scan.admin_iface + _('). It is not yet bound.');

                step2_action = E('button', {
                    'class': 'cbi-button cbi-button-action',
                    'click': function() {
                        applyStep('bind_admin', {
                            mac: scan.admin_mac,
                            ip: scan.admin_ip,
                            iface: scan.admin_iface || target,
                            name: 'Admin-Safeguard'
                        });
                    }
                }, _('Bind my device now (recommended)'));
            } else {
                step2_body = _('Could not detect your session MAC — please use Dashboard to bind manually.');
                step2_status = 'warn';
            }

            steps.push(step(2, _('Admin Safeguard'), step2_status, step2_body, step2_action));

            // ── Step 3 — DHCP static-only ──────────────────────
            var dhcp_sec = scan.target_state && scan.target_state.dhcp_section;
            var dhcp_dynamic = scan.target_state && scan.target_state.dhcp_dynamic;
            var step3_status = 'ok';
            var step3_body = '';
            var step3_action = null;

            if (!dhcp_sec) {
                step3_status = 'warn';
                step3_body = _('No DHCP section found for ') + target + _(', or interface not bridged to a network. Configure DHCP in Network → DHCP and DNS.');
            } else if (dhcp_dynamic === '0') {
                step3_body = _('DHCP is static-only on ') + target + _(', which is required for enforcement.');
            } else {
                step3_status = 'warn';
                step3_body = _('DHCP on ') + target + _(' still serves dynamic leases. For enforcement to work as intended, it should be static-only.');
                step3_action = E('button', {
                    'class': 'cbi-button cbi-button-action',
                    'click': function() {
                        if (!confirm(_('Set dynamicdhcp=0 and force=1 on ') + dhcp_sec + _('? Existing static leases are unaffected, but new unlisted devices will stop getting IPs on this bridge.'))) return;
                        applyStep('ensure_dhcp_static', { section: dhcp_sec });
                    }
                }, _('Make DHCP static-only'));
            }
            steps.push(step(3, _('Static-Only DHCP'), step3_status, step3_body, step3_action));

            // ── Step 4 — Firewall zone ─────────────────────────
            var zone_name = scan.target_state && scan.target_state.firewall_zone_name;
            var zone_input = scan.target_state && scan.target_state.firewall_input;
            var allows_dhcp = scan.target_state && scan.target_state.zone_allows_dhcp;
            var allows_dns  = scan.target_state && scan.target_state.zone_allows_dns;
            var allows_luci = scan.target_state && scan.target_state.zone_allows_luci;

            var step4_status = 'ok';
            var step4_body = '';

            if (!zone_name) {
                step4_status = 'warn';
                step4_body = _('No firewall zone found for ') + target + _('. Create one in Network → Firewall. Rules needed: allow DHCP (UDP 67-68), DNS (UDP 53), LuCI (TCP 80, 443).');
            } else {
                var missing = [];
                if (!allows_dhcp) missing.push('DHCP');
                if (!allows_dns)  missing.push('DNS');
                if (!allows_luci) missing.push('LuCI');

                if (missing.length === 0) {
                    step4_body = _('Zone "') + zone_name + _('" (input=') + zone_input + _(') already allows DHCP, DNS, and LuCI.');
                } else {
                    step4_status = 'warn';
                    step4_body = _('Zone "') + zone_name + _('" is missing allow rules for: ') + missing.join(', ') + _('. Add these rules in Network → Firewall for reliable management.');
                }
            }
            steps.push(step(4, _('Firewall Zone'), step4_status, step4_body, null));

            // ── Step 5 — Interface mode ────────────────────────
            var mode = scan.target_state && scan.target_state.interface_mode;
            var step5_status = 'ok';
            var step5_body = '';
            var step5_action = null;

            if (mode === 'reply_only') {
                step5_body = _('Bridge ') + target + _(' is in reply_only mode — enforcement active.');
            } else {
                step5_status = 'missing';
                step5_body = _('Bridge ') + target + _(' is currently "') + (mode || 'disabled') + _('". Set it to reply_only to enable enforcement.');
                step5_action = E('button', {
                    'class': 'cbi-button cbi-button-action',
                    'click': function() {
                        if (!confirm(_('Enable reply_only mode on ') + target + _('? Devices not in the whitelist will be blocked from this bridge.'))) return;
                        applyStep('set_interface_mode', { mode: 'reply_only' });
                    }
                }, _('Enable reply_only mode'));
            }
            steps.push(step(5, _('Interface Mode'), step5_status, step5_body, step5_action));

            // ── Step 6 — Master switch ─────────────────────────
            var step6_status = master ? 'ok' : 'missing';
            var step6_body = master
                ? _('Master switch is ON — Access Shield is enforcing.')
                : _('Master switch is OFF — nothing is enforced yet.');
            var step6_action = E('button', {
                'class': 'cbi-button ' + (master ? 'cbi-button-negative' : 'cbi-button-apply'),
                'click': function() {
                    if (master) {
                        if (!confirm(_('Turn OFF Access Shield? Enforcement will stop.'))) return;
                        applyStep('disable_master', {});
                    } else {
                        if (!confirm(_('Turn ON Access Shield? Enforcement begins immediately. Make sure your device is bound (Step 2).'))) return;
                        applyStep('enable_master', {});
                    }
                }
            }, master ? _('Turn OFF') : _('Turn ON'));
            steps.push(step(6, _('Master Switch'), step6_status, step6_body, step6_action));

            return steps;
        }

        function repaint() {
            while (container.firstChild) container.removeChild(container.firstChild);

            var warnings = (scan.warnings || []);
            var warn_box = null;
            if (warnings.length > 0) {
                warn_box = E('div', {
                    'style': 'background:rgba(230,126,34,0.15);border:1px solid #e67e22;padding:12px;margin-bottom:16px;border-radius:4px'
                }, [
                    E('strong', {}, _('Compatibility warnings:')),
                    E('ul', { 'style': 'margin:6px 0 0 20px' },
                        warnings.map(function(w) { return E('li', {}, w); }))
                ]);
            }

            container.appendChild(E('div', {}, [
                warn_box || '',
                E('p', { 'style': 'font-size:13px;color:#888' },
                    _('This wizard scans your environment and tells you exactly what\'s required for Access Shield to work correctly. Each step is verified after applying.')),
                E('div', {}, buildSteps())
            ]));
        }

        repaint();

        return E('div', {}, [
            E('h2', {}, _('Access Shield')),
            E('p', { 'style': 'opacity:0.85;font-size:0.95em;margin-top:-4px;margin-bottom:16px' },
                _('Device Access Control & Traffic Monitor — Status Dashboard')),
            container
        ]);
    },

    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});
