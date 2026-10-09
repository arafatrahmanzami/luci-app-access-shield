'use strict';
'require view';
'require uci';
'require ui';
'require rpc';
'require poll';

var callListDevices = rpc.declare({ object: 'luci.access_shield', method: 'list_devices' });
var callTraffic     = rpc.declare({ object: 'luci.access_shield', method: 'traffic_stats' });
var callGetLimits   = rpc.declare({ object: 'luci.access_shield', method: 'get_speed_limits' });
var callListSubnets = rpc.declare({ object: 'luci.access_shield', method: 'list_subnets' });
var callSetSubnetLimit = rpc.declare({ object: 'luci.access_shield', method: 'set_subnet_limit', params: ['cidr','device','label','dl_val','dl_unit','ul_val','ul_unit'] });

function unwrap(d, k) {
    if (!d) return [];
    if (Array.isArray(d)) return d;
    if (typeof d === 'object' && Array.isArray(d[k])) return d[k];
    if (typeof d === 'string') { try { var p = JSON.parse(d); return p[k] || []; } catch(e) {} }
    return [];
}

function fmtRate(bps) {
    bps = parseInt(bps, 10) || 0;
    if (bps < 1000) return bps + ' B/s';
    if (bps < 1000000) return (bps / 1000).toFixed(1) + ' KB/s';
    if (bps < 1000000000) return (bps / 1000000).toFixed(2) + ' MB/s';
    return (bps / 1000000000).toFixed(2) + ' GB/s';
}

function normMac(m) {
    return (m || '').toLowerCase().replace(/:/g, '');
}

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('access_shield'),
            callListDevices(),
            callTraffic(),
            callGetLimits(),
            callListSubnets()
        ]);
    },

    render: function(data) {
        var container = E('div', { 'id': 'traffic-page' });
        var liveContainer = E('div');   // rebuilt on each poll; do NOT put config inputs here
        var devices = unwrap(data[1], 'devices');
        var traffic = data[2] || {};
        var limits  = unwrap(data[3], 'limits');
        var subnets = unwrap(data[4], 'subnets');
        var pollInterval = 2;

        function lookupRate(mac) {
            var target = normMac(mac);
            var list = unwrap(traffic, 'devices');
            for (var i = 0; i < list.length; i++) {
                if (list[i].mac === target) return list[i];
            }
            return { up_bps: 0, down_bps: 0, total_bps: 0 };
        }

        function limitFor(mac) {
            var target = (mac || '').toLowerCase();
            var l = limits.find(function(x) { return (x.mac || '').toLowerCase() === target; });
            if (!l) return 'Unlimited';
            var dl = parseFloat(l.dl_val) > 0 ? l.dl_val + ' ' + l.dl_unit : '∞';
            var ul = parseFloat(l.ul_val) > 0 ? l.ul_val + ' ' + l.ul_unit : '∞';
            return '⬇ ' + dl + ' / ⬆ ' + ul;
        }

        function buildDeviceTable() {
            var rows = [
                E('tr', { 'class': 'tr table-titles' }, [
                    E('th', { 'class': 'th' }, _('Device')),
                    E('th', { 'class': 'th' }, _('IP')),
                    E('th', { 'class': 'th' }, _('Upload')),
                    E('th', { 'class': 'th' }, _('Download')),
                    E('th', { 'class': 'th' }, _('Total')),
                    E('th', { 'class': 'th' }, _('Speed Limit'))
                ])
            ];

            var active = devices.filter(function(d) { return d.mac && d.ipv4; });
            active.sort(function(a, b) {
                var aR = lookupRate(a.mac).total_bps || 0;
                var bR = lookupRate(b.mac).total_bps || 0;
                return bR - aR;
            });

            active.forEach(function(d) {
                var r = lookupRate(d.mac);
                var activeBar = r.total_bps > 0 ? '🟢' : '⚪';
                rows.push(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td' }, [ activeBar + ' ' + (d.hostname || d.mac) ]),
                    E('td', { 'class': 'td' }, [ d.ipv4 ]),
                    E('td', { 'class': 'td' }, [ fmtRate(r.up_bps) ]),
                    E('td', { 'class': 'td' }, [ fmtRate(r.down_bps) ]),
                    E('td', { 'class': 'td', 'style': 'font-weight:bold' }, [ fmtRate(r.total_bps) ]),
                    E('td', { 'class': 'td', 'style': 'font-size:12px' }, [ limitFor(d.mac) ])
                ]));
            });

            return E('table', { 'class': 'table' }, rows);
        }

        function buildSubnetSection() {
            if (!subnets.length) return null;

            var rows = [
                E('tr', { 'class': 'tr table-titles' }, [
                    E('th', { 'class': 'th' }, _('Bridge')),
                    E('th', { 'class': 'th' }, _('Subnet')),
                    E('th', { 'class': 'th' }, _('Download Limit')),
                    E('th', { 'class': 'th' }, _('Upload Limit')),
                    E('th', { 'class': 'th' }, '')
                ])
            ];

            subnets.forEach(function(s) {
                var dlv = E('input', { 'type': 'number', 'min': '0', 'step': 'any',
                    'value': s.dl_val || '', 'placeholder': _('Unlimited'),
                    'style': 'width:100px;padding:4px' });
                var dlu = E('select', { 'style': 'margin-left:4px;padding:4px' },
                    ['Mbps','MBps','Kbps','KBps'].map(function(u) {
                        return E('option', { 'value': u, 'selected': (s.dl_unit === u) ? true : null }, u);
                    }));
                var ulv = E('input', { 'type': 'number', 'min': '0', 'step': 'any',
                    'value': s.ul_val || '', 'placeholder': _('Unlimited'),
                    'style': 'width:100px;padding:4px' });
                var ulu = E('select', { 'style': 'margin-left:4px;padding:4px' },
                    ['Mbps','MBps','Kbps','KBps'].map(function(u) {
                        return E('option', { 'value': u, 'selected': (s.ul_unit === u) ? true : null }, u);
                    }));

                rows.push(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td' }, s.bridge),
                    E('td', { 'class': 'td' }, E('code', {}, s.cidr)),
                    E('td', { 'class': 'td' }, [ dlv, dlu ]),
                    E('td', { 'class': 'td' }, [ ulv, ulu ]),
                    E('td', { 'class': 'td' }, [
                        E('button', {
                            'class': 'btn cbi-button-action',
                            'style': 'font-size:11px;padding:3px 8px',
                            'click': ui.createHandlerFn(this, function() {
                                return callSetSubnetLimit(s.cidr, s.bridge, s.bridge, dlv.value, dlu.value, ulv.value, ulu.value)
                                    .then(function() {
                                        ui.addNotification(null, E('p', {}, _('Subnet limit saved.')), 'info');
                                        return new Promise(function(r) { setTimeout(r, 800); });
                                    }).then(function() { window.location.reload(); });
                            })
                        }, _('Save'))
                    ])
                ]));
            });

            return E('div', { 'class': 'cbi-section' }, [
                E('h3', {}, _('Per-Subnet Bandwidth Limits')),
                E('table', { 'class': 'table' }, rows)
            ]);
        }

        function repaint() {
            // Rebuild ONLY the live device table. Config sections (subnet
            // limits, controls) are built once below and must not be wiped
            // by the poll, otherwise in-flight user typing is lost.
            while (liveContainer.firstChild) liveContainer.removeChild(liveContainer.firstChild);
            liveContainer.appendChild(buildDeviceTable());
        }

        function refresh() {
            return Promise.all([ callListDevices(), callTraffic() ]).then(function(r) {
                devices = unwrap(r[0], 'devices');
                traffic = r[1] || {};
                repaint();
            });
        }

        // Static top bar — built once, never touched by poll
        var topBar = E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:12px;display:flex;justify-content:space-between;align-items:center' }, [
            E('div', {}, [
                E('button', {
                    'class': 'btn cbi-button-action',
                    'click': function() { refresh(); }
                }, _('↻ Refresh')),
                ' ',
                _('Auto-refresh:'),
                ' ',
                (function() {
                    var sel = E('select', {
                        'style': 'padding:4px',
                        'change': function(ev) { pollInterval = parseInt(ev.target.value, 10); }
                    }, [
                        E('option', { 'value': '1', 'selected': pollInterval === 1 ? true : null }, '1 s'),
                        E('option', { 'value': '2', 'selected': pollInterval === 2 ? true : null }, '2 s'),
                        E('option', { 'value': '5', 'selected': pollInterval === 5 ? true : null }, '5 s'),
                        E('option', { 'value': '10', 'selected': pollInterval === 10 ? true : null }, '10 s')
                    ]);
                    return sel;
                })()
            ]),
            E('span', { 'style': 'font-size:12px;color:#888' },
                _('Sample: ') + (traffic.interval || 1) + _(' s'))
        ]);

        // Static config section — built once, preserved across polls
        var configSection = buildSubnetSection();

        // Prime the live device table
        liveContainer.appendChild(buildDeviceTable());

        container.appendChild(topBar);
        container.appendChild(liveContainer);
        if (configSection) container.appendChild(configSection);

        poll.add(function() { return refresh(); }, pollInterval);

        return E('div', {}, [
            E('h2', {}, _('Access Shield')),
            E('p', { 'style': 'opacity:0.85;font-size:0.95em;margin-top:-4px;margin-bottom:16px' },
                _('Device Access Control & Traffic Monitor — Live Traffic')),
            container
        ]);
    },

    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});
