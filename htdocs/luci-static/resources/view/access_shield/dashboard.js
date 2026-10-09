'use strict';
'require view';
'require uci';
'require ui';
'require rpc';
'require poll';

// Module-scope dashboard poll scheduler.
// Sequential: waits for refresh() to resolve before scheduling the next
// tick, so slow RPC calls never stack up (LuCI's poll.add has the same
// property; setInterval does not).
var dashboardPollTimer = null;
var dashboardPollInterval = 15;
var dashboardRefreshFn = null;
function stopDashboardPoll() {
    if (dashboardPollTimer) { clearTimeout(dashboardPollTimer); dashboardPollTimer = null; }
}
function scheduleDashboardRefresh() {
    stopDashboardPoll();
    if (dashboardPollInterval <= 0 || !dashboardRefreshFn) return;
    var tick = function() {
        if (dashboardPollInterval <= 0) return;
        var done = function() {
            if (dashboardPollInterval > 0) {
                dashboardPollTimer = setTimeout(tick, dashboardPollInterval * 1000);
            }
        };
        dashboardRefreshFn().then(done, done);
    };
    dashboardPollTimer = setTimeout(tick, dashboardPollInterval * 1000);
}
'require dom';

function ensureArray(data, key) {
    if (data == null) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === 'object' && Array.isArray(data[key])) return data[key];
    if (typeof data === 'string') {
        try {
            var parsed = JSON.parse(data);
            if (Array.isArray(parsed)) return parsed;
            if (parsed && Array.isArray(parsed[key])) return parsed[key];
        } catch (e) {}
    }
    return [];
}


var callListDevices  = rpc.declare({ object: 'luci.access_shield', method: 'list_devices',  expect: { devices: [] } });
var callListBindings = rpc.declare({ object: 'luci.access_shield', method: 'list_bindings', expect: { bindings: [] } });
var callBindDevice   = rpc.declare({ object: 'luci.access_shield', method: 'bind_device',   params: ['mac','ip','iface','name'] });
var callUnbindDevice = rpc.declare({ object: 'luci.access_shield', method: 'unbind_device', params: ['mac'] });
var callRenameDevice = rpc.declare({ object: 'luci.access_shield', method: 'rename_device', params: ['mac','name'] });
var callSetBlock     = rpc.declare({ object: 'luci.access_shield', method: 'set_block',     params: ['mac','block'] });
var callGetLimits    = rpc.declare({ object: 'luci.access_shield', method: 'get_speed_limits' });
var callListAliases  = rpc.declare({ object: 'luci.access_shield', method: 'list_aliases' });
var callListTickets  = rpc.declare({ object: 'luci.access_shield', method: 'list_tickets' });
var callIssueTicket  = rpc.declare({ object: 'luci.access_shield', method: 'issue_ticket',  params: ['mac','duration','label','note'] });
var callRevokeTicket = rpc.declare({ object: 'luci.access_shield', method: 'revoke_ticket', params: ['mac'] });
var callSetAlias     = rpc.declare({ object: 'luci.access_shield', method: 'set_alias', params: ['ip','name','mac'] });
var callSetLimit     = rpc.declare({ object: 'luci.access_shield', method: 'set_speed_limit', params: ['mac','ip','dl_val','dl_unit','ul_val','ul_unit'] });

function signalIcon(sig) {
    if (sig === null || sig === undefined || sig === '') return '';
    var n = parseInt(sig, 10);
    if (n >= -50) return '▂▄▆█';
    if (n >= -60) return '▂▄▆░';
    if (n >= -70) return '▂▄░░';
    return '▂░░░';
}

function ipToLong(ip) {
    if (!ip) return 999999999999;
    var p = ip.split('.');
    if (p.length === 4) return (+p[0] * 16777216) + (+p[1] * 65536) + (+p[2] * 256) + (+p[3]);
    return 999999999999;
}

function badge(text, bg) {
    return E('span', { 'style': 'display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;background:' + bg + ';color:#fff;' }, text);
}

return view.extend({
    load: function() {
        return Promise.all([ uci.load('access_shield'), callListDevices(), callListBindings(), callGetLimits(), callListAliases(), callListTickets() ]);
    },

    render: function(data) {
        var container = E('div', { 'id': 'access-shield-dashboard' });
        var deviceList = ensureArray(data[1], 'devices');
        var bindingList = ensureArray(data[2], 'bindings');

        var state = {
            search: '',
            bound: 'all',
            online: 'all',
            conn: 'all',
            blocked: 'all'
        };

        // Build lookup by MAC
        var limitsCache = [];
        var aliasesCache = [];
        var ticketsCache = {};
        var bindingByMac = {};

        // Configured poll interval (UCI setting, default 15s, 0 = off)
        var configuredInterval = parseInt(uci.get('access_shield', 'settings', 'dashboard_interval'), 10);
        if (isNaN(configuredInterval) || configuredInterval < 0) configuredInterval = 15;

        // Live override dropdown
        var refreshSel = E('select', {
            'style': 'padding:4px;margin-left:6px',
            'change': function(ev) {
                var v = parseInt(ev.target.value, 10);
                if (isNaN(v) || v < 0) v = 15;
                dashboardPollInterval = v;
                scheduleDashboardRefresh();
            }
        }, [
            E('option', { 'value': '5',   'selected': configuredInterval === 5   ? true : null }, '5 s'),
            E('option', { 'value': '10',  'selected': configuredInterval === 10  ? true : null }, '10 s'),
            E('option', { 'value': '15',  'selected': configuredInterval === 15  ? true : null }, '15 s'),
            E('option', { 'value': '30',  'selected': configuredInterval === 30  ? true : null }, '30 s'),
            E('option', { 'value': '60',  'selected': configuredInterval === 60  ? true : null }, '60 s'),
            E('option', { 'value': '120', 'selected': configuredInterval === 120 ? true : null }, '120 s'),
            E('option', { 'value': '0',   'selected': configuredInterval === 0   ? true : null }, _('Off'))
        ]);

        var refreshRow = E('div', { 'style': 'font-size:12px;margin-bottom:8px;color:#aaa' }, [
            _('Auto-refresh:'), ' ', refreshSel,
            ' ',
            E('span', { 'style': 'color:#888' },
                _('(Default from Settings; changes here apply immediately but are not saved.)'))
        ]);
        bindingList.forEach(function(b) {
            bindingByMac[(b.mac || '').toLowerCase()] = b;
        });

        function mergedDevices() {
            var result = [];
            deviceList.forEach(function(d) {
                var mac = (d.mac || '').toLowerCase();
                var b = bindingByMac[mac];
                result.push({
                    mac: d.mac,
                    ipv4: d.ipv4 || (b ? b.ip : ''),
                    ipv6: d.ipv6 || '',
                    hostname: d.hostname || (b ? b.name : 'Unknown'),
                    iface: d.iface || (b ? b.iface : ''),
                    ssid: d.ssid || '',
                    state: d.state,
                    online: d.online,
                    connection: d.connection,
                    bound: !!b,
                    block: b ? (b.block === '1') : false,
                    section: b ? b.section : ''
                });
            });

            // Also add bindings whose devices aren't currently visible
            bindingList.forEach(function(b) {
                var mac = (b.mac || '').toLowerCase();
                if (!deviceList.some(function(d) { return (d.mac || '').toLowerCase() === mac; })) {
                    result.push({
                        mac: b.mac,
                        ipv4: b.ip,
                        ipv6: '',
                        hostname: b.name,
                        iface: b.iface,
                        ssid: '',
                        state: 'STALE',
                        online: false,
                        connection: 'wired',
                        bound: true,
                        block: b.block === '1',
                        section: b.section
                    });
                }
            });

            // Sort by IP
            result.sort(function(a, b) {
                return ipToLong(a.ipv4) - ipToLong(b.ipv4);
            });
            return result;
        }

        function applyFilters(list) {
            return list.filter(function(d) {
                if (state.bound === 'bound'   && !d.bound) return false;
                if (state.bound === 'unbound' &&  d.bound) return false;
                if (state.online === 'online'  && !d.online) return false;
                if (state.online === 'offline' &&  d.online) return false;
                if (state.conn !== 'all' && d.connection !== state.conn) return false;
                if (state.blocked === 'blocked' && !d.block) return false;
                if (state.blocked === 'allowed' &&  d.block) return false;
                if (state.search) {
                    var q = state.search.toLowerCase();
                    var hay = (d.hostname + ' ' + d.ipv4 + ' ' + d.mac + ' ' + d.ssid).toLowerCase();
                    if (hay.indexOf(q) < 0) return false;
                }
                return true;
            });
        }

        function openRenameModal(d) {
            var input = E('input', { 'type': 'text', 'value': d.hostname, 'style': 'width:100%;padding:6px;' });
            ui.showModal(_('Rename Device'), [
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Name')),
                    E('div', { 'class': 'cbi-value-field' }, [ input ])
                ]),
                E('p', { 'style': 'font-size:12px;color:#888' }, _('MAC: ') + d.mac),
                E('div', { 'class': 'right' }, [
                    E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
                    ' ',
                    E('button', {
                        'class': 'btn cbi-button-action',
                        'click': function() {
                            var newName = input.value.trim();
                            ui.hideModal();
                            callRenameDevice(d.mac, newName).then(function() {
                                ui.addNotification(null, E('p', {}, _('Renamed to "') + newName + '"'), 'info');
                                return refresh();
                            });
                        }
                    }, _('Save'))
                ])
            ]);
        }

        function fmtDuration(secs) {
    secs = parseInt(secs, 10) || 0;
    if (secs <= 0) return _('expired');
    var h = Math.floor(secs / 3600);
    var m = Math.floor((secs % 3600) / 60);
    var s = secs % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
}

function openIssueTicketModal(d) {
    var durSelect = E('select', { 'style': 'width:100%;padding:6px' }, [
        E('option', { 'value': '15' }, _('15 minutes')),
        E('option', { 'value': '60', 'selected': true }, _('1 hour')),
        E('option', { 'value': '240' }, _('4 hours')),
        E('option', { 'value': '1440' }, _('1 day')),
        E('option', { 'value': 'custom' }, _('Custom...'))
    ]);
    var customDur = E('input', { 'type': 'number', 'min': '1',
        'placeholder': _('minutes'), 'style': 'display:none;width:100%;padding:6px;margin-top:6px' });

    durSelect.addEventListener('change', function() {
        customDur.style.display = (this.value === 'custom') ? 'block' : 'none';
    });

    var labelIn = E('input', { 'type': 'text', 'value': d.hostname || '',
        'style': 'width:100%;padding:6px' });

    ui.showModal(_('Issue Ticket'), [
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Device')),
            E('div', { 'class': 'cbi-value-field' }, [ E('strong', {}, d.hostname || d.mac) ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Duration')),
            E('div', { 'class': 'cbi-value-field' }, [ durSelect, customDur ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Label')),
            E('div', { 'class': 'cbi-value-field' }, [ labelIn ])
        ]),
        E('p', { 'style': 'font-size:12px;color:#888' },
            _('The device is temporarily allowed to bypass the block until the ticket expires.')),
        E('div', { 'class': 'right', 'style': 'margin-top:1em' }, [
            E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
            ' ',
            E('button', {
                'class': 'btn cbi-button-action',
                'click': function() {
                    var minutes = durSelect.value === 'custom' ? parseInt(customDur.value, 10) : parseInt(durSelect.value, 10);
                    if (!minutes || minutes <= 0) { alert(_('Enter valid minutes')); return; }
                    ui.hideModal();
                    callIssueTicket(d.mac, String(minutes), labelIn.value.trim(), '').then(function() {
                        ui.addNotification(null, E('p', {}, _('Ticket issued for %s minutes.').format(minutes)), 'info');
                        return new Promise(function(r) { setTimeout(r, 800); });
                    }).then(refresh);
                }
            }, _('Issue Ticket'))
        ])
    ]);
}

function openDetailsModal(d) {
    var macLc = (d.mac || '').toLowerCase();

    function infoRow(k, v) {
        return E('tr', { 'class': 'tr' }, [
            E('td', { 'class': 'td', 'style': 'width:200px;font-weight:bold' }, k),
            E('td', { 'class': 'td' }, v)
        ]);
    }

    var signalText = d.connection === 'wireless' ? (d.state || '') : _('Wired Connection');

    var infoTable = E('table', { 'class': 'table' }, [
        infoRow(_('MAC Address'), E('code', {}, d.mac)),
        infoRow(_('IPv4 Address'), d.ipv4 || '—'),
        infoRow(_('IPv6 Address'), d.ipv6 || '—'),
        infoRow(_('Hostname'), d.hostname || '—'),
        infoRow(_('Interface'), d.iface || '—'),
        infoRow(_('Connection'), (d.connection || '—') + (d.ssid ? ' (' + d.ssid + ')' : '')),
        infoRow(_('Signal'), signalText),
        infoRow(_('Status'), d.online ? 'Online' : 'Offline'),
        infoRow(_('Bound'), d.bound ? 'Yes' : 'No'),
        infoRow(_('Internet Access'), d.block ? 'Blocked' : 'Allowed')
    ]);

    var limit = (limitsCache || []).find(function(l) { return (l.mac || '').toLowerCase() === macLc; }) || {};
    var dlv = limit.dl_val || '';
    var dlu = limit.dl_unit || 'Mbps';
    var ulv = limit.ul_val || '';
    var ulu = limit.ul_unit || 'Mbps';

    var dlIn = E('input', { 'type': 'number', 'min': '0', 'step': 'any',
        'value': (parseFloat(dlv) > 0) ? dlv : '', 'placeholder': _('Unlimited'),
        'class': 'cbi-input-text', 'style': 'width:120px' });
    var dlUnit = E('select', { 'class': 'cbi-input-select', 'style': 'margin-left:8px' },
        ['Mbps', 'MBps', 'Kbps', 'KBps'].map(function(u) {
            return E('option', { 'value': u, 'selected': dlu === u ? true : null }, u);
        }));
    var ulIn = E('input', { 'type': 'number', 'min': '0', 'step': 'any',
        'value': (parseFloat(ulv) > 0) ? ulv : '', 'placeholder': _('Unlimited'),
        'class': 'cbi-input-text', 'style': 'width:120px' });
    var ulUnit = E('select', { 'class': 'cbi-input-select', 'style': 'margin-left:8px' },
        ['Mbps', 'MBps', 'Kbps', 'KBps'].map(function(u) {
            return E('option', { 'value': u, 'selected': ulu === u ? true : null }, u);
        }));

    ui.showModal(_('Device: ') + (d.hostname || d.mac), [
        infoTable,
        E('h3', { 'style': 'margin-top:1em' }, _('Bandwidth Speed Limiter')),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Download Limit')),
            E('div', { 'class': 'cbi-value-field' }, [ dlIn, dlUnit ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Upload Limit')),
            E('div', { 'class': 'cbi-value-field' }, [ ulIn, ulUnit ])
        ]),
        E('div', { 'class': 'right', 'style': 'margin-top:1em' }, [
            E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close')),
            ' ',
            E('button', {
                'class': 'btn cbi-button-action',
                'click': function() {
                    ui.hideModal();
                    callSetLimit(d.mac, d.ipv4 || '', dlIn.value || '0', dlUnit.value, ulIn.value || '0', ulUnit.value)
                        .then(function() {
                            ui.addNotification(null, E('p', {}, _('Speed limit saved.')), 'info');
                            return new Promise(function(r) { setTimeout(r, 800); });
                        }).then(refresh);
                }
            }, _('Save Speed Limit'))
        ])
    ]);
}

function openEditModal(d, limits) {
    var macLc0 = (d.mac || '').toLowerCase();
    var existingAlias = (aliasesCache || []).find(function(a) { return (a.ip === d.ipv4); }) || {};
    var aliasIn = E('input', { 'type': 'text', 'value': existingAlias.name || '', 'placeholder': _('Custom alias (e.g. Front Door Cam)'), 'style': 'width:100%;padding:6px' });
    var nameIn = E('input', { 'type': 'text', 'value': d.hostname || '', 'style': 'width:100%;padding:6px' });
    var ipIn = E('input', { 'type': 'text', 'value': d.ipv4 || '', 'style': 'width:100%;padding:6px' });
    var ifaceSel = E('select', { 'style': 'width:100%;padding:6px' }, [
        E('option', { 'value': 'br-lan',  'selected': d.iface === 'br-lan'  ? true : null }, 'br-lan'),
        E('option', { 'value': 'br-lan2', 'selected': d.iface === 'br-lan2' ? true : null }, 'br-lan2'),
        E('option', { 'value': 'br-lan3', 'selected': d.iface === 'br-lan3' ? true : null }, 'br-lan3')
    ]);
    var leaseSel = E('select', { 'style': 'width:100%;padding:6px' }, [
        E('option', { 'value': '',         'selected': (!d.lease || d.lease === '') ? true : null }, 'inherit (infinite)'),
        E('option', { 'value': '5m',       'selected': d.lease === '5m' ? true : null }, '5 minutes'),
        E('option', { 'value': '30m',      'selected': d.lease === '30m' ? true : null }, '30 minutes'),
        E('option', { 'value': '1h',       'selected': d.lease === '1h' ? true : null }, '1 hour'),
        E('option', { 'value': '12h',      'selected': d.lease === '12h' ? true : null }, '12 hours'),
        E('option', { 'value': '7d',       'selected': d.lease === '7d' ? true : null }, '7 days'),
        E('option', { 'value': 'infinite', 'selected': d.lease === 'infinite' ? true : null }, 'infinite')
    ]);
    var notesIn = E('input', { 'type': 'text', 'value': d.notes || '', 'style': 'width:100%;padding:6px' });

    // Look up existing speed limit for this MAC
    var macLc = (d.mac || '').toLowerCase();
    var limit = (limits || []).find(function(l) { return (l.mac || '').toLowerCase() === macLc; }) || {};
    var dlv = limit.dl_val || '';
    var dlu = limit.dl_unit || 'Mbps';
    var ulv = limit.ul_val || '';
    var ulu = limit.ul_unit || 'Mbps';

    var dlIn = E('input', { 'type': 'number', 'min': '0', 'step': 'any',
        'value': (parseFloat(dlv) > 0) ? dlv : '', 'placeholder': _('Unlimited'),
        'style': 'width:120px;padding:6px' });
    var dlUnit = E('select', { 'style': 'margin-left:8px;padding:6px' },
        ['Mbps', 'MBps', 'Kbps', 'KBps'].map(function(u) {
            return E('option', { 'value': u, 'selected': dlu === u ? true : null }, u);
        }));
    var ulIn = E('input', { 'type': 'number', 'min': '0', 'step': 'any',
        'value': (parseFloat(ulv) > 0) ? ulv : '', 'placeholder': _('Unlimited'),
        'style': 'width:120px;padding:6px' });
    var ulUnit = E('select', { 'style': 'margin-left:8px;padding:6px' },
        ['Mbps', 'MBps', 'Kbps', 'KBps'].map(function(u) {
            return E('option', { 'value': u, 'selected': ulu === u ? true : null }, u);
        }));

    ui.showModal(_('Edit Device'), [
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('MAC')),
            E('div', { 'class': 'cbi-value-field' }, [ E('code', {}, d.mac) ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title', 'style': 'font-weight:bold' }, _('Alias')),
            E('div', { 'class': 'cbi-value-field' }, [ aliasIn ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Binding Name')),
            E('div', { 'class': 'cbi-value-field' }, [ nameIn ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('IP address')),
            E('div', { 'class': 'cbi-value-field' }, [ ipIn ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Interface')),
            E('div', { 'class': 'cbi-value-field' }, [ ifaceSel ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Lease')),
            E('div', { 'class': 'cbi-value-field' }, [ leaseSel ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Notes')),
            E('div', { 'class': 'cbi-value-field' }, [ notesIn ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title', 'style': 'font-weight:bold' }, _('Download Limit')),
            E('div', { 'class': 'cbi-value-field' }, [ dlIn, dlUnit ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title', 'style': 'font-weight:bold' }, _('Upload Limit')),
            E('div', { 'class': 'cbi-value-field' }, [ ulIn, ulUnit ])
        ]),
        E('p', { 'style': 'font-size:12px;color:#888;margin:6px 0' },
            _('Speed limits apply to forwarded traffic. Use "0" or leave empty for unlimited.')),
        E('div', { 'class': 'right' }, [
            E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
            ' ',
            E('button', {
                'class': 'btn cbi-button-action',
                'click': function() {
                    ui.hideModal();
                    var ip = ipIn.value.trim();
                    var name = nameIn.value.trim();
                    var iface = ifaceSel.value;

                    // Update binding: unbind + rebind
                    callUnbindDevice(d.mac).then(function() {
                        return callBindDevice(d.mac, ip, iface, name);
                    }).then(function() {
                        // Save alias if changed
                        var aliasVal = aliasIn.value.trim();
                        if (aliasVal) {
                            return callSetAlias(d.ipv4 || ip, aliasVal, d.mac);
                        }
                        return Promise.resolve();
                    }).then(function() {
                        // Update speed limit
                        return callSetLimit(d.mac, ip, dlIn.value || '0', dlUnit.value, ulIn.value || '0', ulUnit.value);
                    }).then(function() {
                        ui.addNotification(null, E('p', {}, _('Device saved.')), 'info');
                        return new Promise(function(r) { setTimeout(r, 1500); });
                    }).then(refresh);
                }
            }, _('Save'))
        ])
    ]);
}

function openBindModal(d) {
            var ipInput = E('input', { 'type': 'text', 'value': d.ipv4 || '', 'placeholder': '192.168.200.x', 'style': 'width:100%;padding:6px;' });
            var nameInput = E('input', { 'type': 'text', 'value': d.hostname || '', 'style': 'width:100%;padding:6px;' });
            var ifaceSelect = E('select', { 'style': 'width:100%;padding:6px;' }, [
                E('option', { 'value': 'br-lan',  'selected': d.iface === 'br-lan'  ? true : null }, 'br-lan'),
                E('option', { 'value': 'br-lan2', 'selected': d.iface === 'br-lan2' ? true : null }, 'br-lan2'),
                E('option', { 'value': 'br-lan3', 'selected': d.iface === 'br-lan3' ? true : null }, 'br-lan3')
            ]);

            ui.showModal(_('Bind Device'), [
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('MAC')),
                    E('div', { 'class': 'cbi-value-field' }, [ E('code', {}, d.mac) ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Name')),
                    E('div', { 'class': 'cbi-value-field' }, [ nameInput ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('IP address')),
                    E('div', { 'class': 'cbi-value-field' }, [ ipInput ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Interface')),
                    E('div', { 'class': 'cbi-value-field' }, [ ifaceSelect ])
                ]),
                E('div', { 'class': 'right' }, [
                    E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
                    ' ',
                    E('button', {
                        'class': 'btn cbi-button-action',
                        'click': function() {
                            ui.hideModal();
                            callBindDevice(d.mac, ipInput.value.trim(), ifaceSelect.value, nameInput.value.trim())
                                .then(function() {
                                    ui.addNotification(null, E('p', {}, _('Device bound.')), 'info');
                                    return new Promise(function(r) { setTimeout(r, 1500); });
                                })
                                .then(refresh);
                        }
                    }, _('Bind'))
                ])
            ]);
        }

        function openAddModal() {
            var macInput  = E('input', { 'type': 'text', 'placeholder': 'aa:bb:cc:dd:ee:ff', 'style': 'width:100%;padding:6px;font-family:monospace' });
            var nameInput = E('input', { 'type': 'text', 'placeholder': _('e.g. Front Door Cam'), 'style': 'width:100%;padding:6px' });
            var ipInput   = E('input', { 'type': 'text', 'placeholder': '192.168.200.x', 'style': 'width:100%;padding:6px' });
            var ifaceSelect = E('select', { 'style': 'width:100%;padding:6px' }, [
                E('option', { 'value': 'br-lan2', 'selected': true }, 'br-lan2'),
                E('option', { 'value': 'br-lan' }, 'br-lan'),
                E('option', { 'value': 'br-lan3' }, 'br-lan3')
            ]);

            ui.showModal(_('Add Device by MAC'), [
                E('p', { 'style': 'font-size:12px;color:#888;margin:0 0 8px 0' },
                    _('For devices that are not visible in the Dashboard yet - offline, pre-provisioning, or dropped by the shield before DHCP.')),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('MAC')),
                    E('div', { 'class': 'cbi-value-field' }, [ macInput ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Name')),
                    E('div', { 'class': 'cbi-value-field' }, [ nameInput ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('IP address')),
                    E('div', { 'class': 'cbi-value-field' }, [ ipInput ])
                ]),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Interface')),
                    E('div', { 'class': 'cbi-value-field' }, [ ifaceSelect ])
                ]),
                E('p', { 'style': 'font-size:12px;color:#888' },
                    _('Leave IP blank for 0.0.0.0 (device will DHCP after being whitelisted).')),
                E('div', { 'class': 'right' }, [
                    E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
                    ' ',
                    E('button', {
                        'class': 'btn cbi-button-action',
                        'click': function() {
                            var mac = macInput.value.trim().toLowerCase();
                            var nm  = nameInput.value.trim();
                            var ip  = ipInput.value.trim();
                            var ifc = ifaceSelect.value;

                            if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
                                ui.addNotification(null, E('p', {}, _('Invalid MAC. Use aa:bb:cc:dd:ee:ff format.')), 'error');
                                return;
                            }
                            if (bindingByMac[mac]) {
                                ui.addNotification(null, E('p', {}, _('MAC already bound. Use Edit on the device row to change it.')), 'warning');
                                return;
                            }
                            if (ip && !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
                                ui.addNotification(null, E('p', {}, _('Invalid IP address.')), 'error');
                                return;
                            }

                            ui.hideModal();
                            callBindDevice(mac, ip, ifc, nm)
                                .then(function() {
                                    ui.addNotification(null, E('p', {}, _('Device added.')), 'info');
                                    return new Promise(function(r) { setTimeout(r, 1500); });
                                })
                                .then(refresh);
                        }
                    }, _('Add'))
                ])
            ]);
        }

        function buildView() {
            var all = mergedDevices();
            var list = applyFilters(all);

            var total   = all.length;
            var online  = all.filter(function(d) { return d.online; }).length;
            var bound   = all.filter(function(d) { return d.bound; }).length;
            var blocked = all.filter(function(d) { return d.block; }).length;
            var unbound = total - bound;

            var stats = E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:1em' }, [
                E('strong', {}, _('Devices: ')), String(total), ' | ',
                E('strong', {}, _('Online: ')),  String(online), ' | ',
                E('strong', {}, _('Bound: ')),   String(bound), ' | ',
                E('strong', {}, _('Unbound: ')), String(unbound), ' | ',
                E('strong', {}, _('Blocked: ')), String(blocked)
            ]);

            var addRow = E('div', { 'class': 'cbi-section' }, [
                E('button', {
                    'class': 'btn cbi-button-action',
                    'click': function() { openAddModal(); }
                }, '+ ' + _('Add Device by MAC'))
            ]);

            var searchInput = E('input', {
                'type': 'text', 'placeholder': _('Search name / IP / MAC / SSID'),
                'value': state.search, 'style': 'padding:4px;width:250px',
                'input': function(ev) {
                    state.search = ev.target.value;
                    state._searchCursor = ev.target.selectionStart;
                    state._refocusSearch = true;
                    repaint();
                }
            });

            state._searchInputRef = searchInput;

            function mkSelect(label, key, options) {
                return E('select', {
                    'style': 'padding:4px',
                    'change': function(ev) { state[key] = ev.target.value; repaint(); }
                }, options.map(function(o) {
                    return E('option', { 'value': o.v, 'selected': state[key] === o.v ? true : null }, o.t);
                }));
            }

            var filterRow = E('div', { 'class': 'cbi-section' }, [
                searchInput, ' ',
                mkSelect(_('Bound'), 'bound', [
                    { v: 'all', t: _('All devices') },
                    { v: 'bound', t: _('Bound only') },
                    { v: 'unbound', t: _('Unbound only') }
                ]), ' ',
                mkSelect(_('State'), 'online', [
                    { v: 'all', t: _('Any state') },
                    { v: 'online', t: _('Online') },
                    { v: 'offline', t: _('Offline') }
                ]), ' ',
                mkSelect(_('Link'), 'conn', [
                    { v: 'all', t: _('Any link') },
                    { v: 'wired', t: _('Wired') },
                    { v: 'wireless', t: _('Wireless') }
                ]), ' ',
                mkSelect(_('Access'), 'blocked', [
                    { v: 'all', t: _('Any access') },
                    { v: 'allowed', t: _('Allowed') },
                    { v: 'blocked', t: _('Blocked') }
                ])
            ]);

            var rows = [
                E('tr', { 'class': 'tr table-titles' }, [
                    E('th', { 'class': 'th', 'style': 'width:36px' }, ''),
                    E('th', { 'class': 'th' }, _('Name')),
                    E('th', { 'class': 'th' }, _('IP Address')),
                    E('th', { 'class': 'th' }, _('MAC')),
                    E('th', { 'class': 'th' }, _('Interface')),
                    E('th', { 'class': 'th' }, _('Signal')),
                    E('th', { 'class': 'th' }, _('Status')),
                    E('th', { 'class': 'th' }, _('Access')),
                    E('th', { 'class': 'th' }, _('Actions'))
                ])
            ];

            if (list.length === 0) {
                // empty state: static, no device to open - do NOT add a click handler referencing d
                rows.push(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td', 'colspan': 9, 'style': 'text-align:center;padding:20px;color:#888' },
                        _('No devices match the current filter.'))
                ]));
            }

            list.forEach(function(d) {
                var icon = d.connection === 'wireless' ? '📶' : '🔌';
                if (!d.online) icon = '💤';

                var nameCell = E('span', {}, [
                    E('strong', {}, d.hostname || d.ipv4 || d.mac),
                    d.bound ? ' ' : '',
                    d.bound ? badge(_('bound'), '#1e88e5') : badge(_('unbound'), '#e67e22')
                ]);

                var statusCell = d.online
                    ? badge(_('online'), '#2a9d3e')
                    : badge(_('offline'), '#888');

                var accessCell = d.block
                    ? badge(_('blocked'), '#e74c3c')
                    : badge(_('allowed'), '#27ae60');

                var signalCell = d.connection === 'wireless'
                    ? E('span', { 'title': d.state }, signalIcon(d.ssid ? -60 : -70))
                    : '—';

                var ticket = ticketsCache[(d.mac || '').toLowerCase()];

                var actions = E('div', { 'style': 'white-space:nowrap' }, [
                    d.bound ? E('button', {
                        'class': 'btn cbi-button',
                        'style': 'font-size:11px;padding:2px 6px',
                        'click': function(ev) { ev.stopPropagation(); openEditModal(d, limitsCache); }
                    }, _('Edit')) : '',

                    d.bound ? ' ' : '',
                    d.bound ? E('button', {
                        'class': 'btn cbi-button-negative',
                        'style': 'font-size:11px;padding:2px 6px',
                        'click': function(ev) {
                            ev.stopPropagation();
                            callUnbindDevice(d.mac).then(function() {
                                ui.addNotification(null, E('p', {}, _('Unbound.')), 'info');
                                return refresh();
                            });
                        }
                    }, _('Unbind')) : E('button', {
                        'class': 'btn cbi-button-action',
                        'style': 'font-size:11px;padding:2px 6px',
                        'click': function(ev) { ev.stopPropagation(); openBindModal(d); }
                    }, _('Bind')),

                    d.bound ? ' ' : '',
                    d.bound ? E('button', {
                        'class': 'btn cbi-button',
                        'style': 'font-size:11px;padding:2px 6px;background:' + (d.block ? '#27ae60' : '#e74c3c') + ';color:#fff',
                        'click': function(ev) {
                            ev.stopPropagation();
                            callSetBlock(d.mac, d.block ? '0' : '1').then(function() {
                                ui.addNotification(null, E('p', {}, d.block ? _('Internet allowed.') : _('Internet blocked.')), 'info');
                                return refresh();
                            });
                        }
                    }, d.block ? _('Allow') : _('Block')) : '',
                    d.block && !ticket ? E('button', {
                        'class': 'btn cbi-button-action',
                        'style': 'font-size:11px;padding:2px 6px',
                        'title': _('Issue temporary access ticket'),
                        'click': function(ev) {
                            ev.stopPropagation();
                            openIssueTicketModal(d);
                        }
                    }, _('🎫 Ticket')) : '',
                    ticket ? E('span', {
                        'class': 'btn cbi-button',
                        'style': 'font-size:11px;padding:2px 6px;background:#f39c12;color:#fff;cursor:pointer',
                        'title': _('Click to cancel ticket'),
                        'click': function(ev) {
                            ev.stopPropagation();
                            if (!confirm(_('Cancel active ticket?'))) return;
                            callRevokeTicket(d.mac).then(function() {
                                ui.addNotification(null, E('p', {}, _('Ticket cancelled.')), 'info');
                                return new Promise(function(r) { setTimeout(r, 500); });
                            }).then(refresh);
                        }
                    }, _('🎫 ') + fmtDuration(ticket.seconds_left)) : ''
                ]);

                rows.push(E('tr', {
                    'class': 'tr',
                    'style': 'cursor:pointer',
                    'click': function(ev) {
                        if (ev.target.tagName === 'BUTTON') return;
                        openDetailsModal(d);
                    }
                }, [
                    E('td', { 'class': 'td', 'style': 'text-align:center;font-size:1.2em' }, icon),
                    E('td', { 'class': 'td' }, [ nameCell ]),
                    E('td', { 'class': 'td' }, [ d.ipv4 || '—' ]),
                    E('td', { 'class': 'td', 'style': 'font-family:monospace;font-size:11px' }, [ d.mac ]),
                    E('td', { 'class': 'td' }, [ d.iface + (d.ssid ? ' (' + d.ssid + ')' : '') ]),
                    E('td', { 'class': 'td' }, [ signalCell ]),
                    E('td', { 'class': 'td' }, [ statusCell ]),
                    E('td', { 'class': 'td' }, [ accessCell ]),
                    E('td', { 'class': 'td' }, [ actions ])
                ]));
            });

            return E('div', {}, [
                stats,
                addRow,
                filterRow,
                E('table', { 'class': 'table' }, rows),
                E('p', { 'style': 'margin-top:1em;font-size:12px;color:#888' },
                    _('One unified view of all devices. Bind to whitelist, block to deny internet, rename to label. ' +
                      'Changes apply immediately via the enforcement script.'))
            ]);
        }

        function repaint() {
            var wantFocus = state._refocusSearch;
            var cursorPos = state._searchCursor;
            state._refocusSearch = false;
            while (container.firstChild) container.removeChild(container.firstChild);
            container.appendChild(buildView());
            if (wantFocus && state._searchInputRef) {
                state._searchInputRef.focus();
                try { state._searchInputRef.setSelectionRange(cursorPos, cursorPos); } catch(e) {}
            }
        }

        function refresh() {
            return Promise.all([ callListDevices(), callListBindings(), callGetLimits(), callListAliases(), callListTickets() ]).then(function(r) {
                deviceList = ensureArray(r[0], 'devices');
                bindingList = ensureArray(r[1], 'bindings');
                bindingByMac = {};
                bindingList.forEach(function(b) { bindingByMac[(b.mac || '').toLowerCase()] = b; });
                limitsCache = (function(d) { if (!d) return []; if (Array.isArray(d)) return d; if (typeof d === 'object' && Array.isArray(d.limits)) return d.limits; return []; })(r[2]);
                aliasesCache = (function(d) { if (!d) return []; if (Array.isArray(d)) return d; if (typeof d === 'object' && Array.isArray(d.aliases)) return d.aliases; return []; })(r[3]);
                var ticketsList = (function(d) {
                    if (!d) return [];
                    if (Array.isArray(d)) return d;
                    if (typeof d === 'object' && Array.isArray(d.tickets)) return d.tickets;
                    if (typeof d === 'string') { try { var p = JSON.parse(d); return p.tickets || []; } catch(e) {} }
                    return [];
                })(r[4]);
                ticketsCache = {};
                ticketsList.forEach(function(t) { ticketsCache[(t.mac || '').toLowerCase()] = t; });
                repaint();
            });
        }

        repaint();

        dashboardPollInterval = configuredInterval;
        dashboardRefreshFn = refresh;
        scheduleDashboardRefresh();

        return E('div', {}, [
            E('h2', {}, _('Access Shield')),
            E('p', { 'style': 'opacity:0.85;font-size:0.95em;margin-top:-4px;margin-bottom:16px' }, _('Device Access Control & Traffic Monitor')),
            refreshRow,
            container
        ]);
    },

    handleSave: null,
    handleSaveApply: null,
    handleReset: null,

    unload: function() {
        dashboardPollInterval = 0;
        stopDashboardPoll();
    }
});
