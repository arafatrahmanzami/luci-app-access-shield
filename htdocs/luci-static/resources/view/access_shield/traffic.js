'use strict';
'require view';
'require uci';
'require ui';
'require rpc';
'require poll';

var callListDevices = rpc.declare({ object: 'luci.access_shield', method: 'list_devices',       expect: {} });
var callTraffic     = rpc.declare({ object: 'luci.access_shield', method: 'traffic_per_device', expect: {} });
var callGetLimits   = rpc.declare({ object: 'luci.access_shield', method: 'get_speed_limits' });
var callListSubnets = rpc.declare({ object: 'luci.access_shield', method: 'list_subnets' });
var callSetSubnetLimit = rpc.declare({ object: 'luci.access_shield', method: 'set_subnet_limit', params: ['cidr','device','label','dl_val','dl_unit','ul_val','ul_unit'] });

function fmtRate(bps) {
    bps = parseInt(bps, 10) || 0;
    if (bps < 1000) return bps + ' B/s';
    if (bps < 1000000) return (bps / 1000).toFixed(1) + ' KB/s';
    if (bps < 1000000000) return (bps / 1000000).toFixed(2) + ' MB/s';
    return (bps / 1000000000).toFixed(2) + ' GB/s';
}


function unwrapList(d, k) {
    if (!d) return [];
    if (Array.isArray(d)) return d;
    if (typeof d === 'object' && Array.isArray(d[k])) return d[k];
    if (typeof d === 'string') { try { var p = JSON.parse(d); return p[k] || []; } catch(e) {} }
    return [];
}

function fmtBytes(bps, interval) {
    var bytes = bps * interval;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
}

return view.extend({
    load: function() {
        return Promise.all([ uci.load('access_shield'), callListDevices(), callTraffic(), callGetLimits(), callListSubnets() ]);
    },

    render: function(data) {
        var container = E('div', { 'id': 'access-shield-traffic' });
        var interval = 5;
        var currentDevices = (data[1] && data[1].devices) || [];
        var currentTraffic = (data[2] && data[2].devices) || [];
        var trafficInterval = (data[2] && data[2].interval) || 1;
        var limits = unwrapList(data[3], 'limits');

        function limitForDevice(mac) {
            var m = (mac || '').toLowerCase();
            var l = limits.find(function(x) { return (x.mac || '').toLowerCase() === m; });
            if (!l) return 'Unlimited';
            var dl = parseFloat(l.dl_val) > 0 ? l.dl_val + ' ' + l.dl_unit : '∞';
            var ul = parseFloat(l.ul_val) > 0 ? l.ul_val + ' ' + l.ul_unit : '∞';
            return '⬇ ' + dl + ' / ⬆ ' + ul;
        }

        function deviceForIp(ip) {
            for (var i = 0; i < currentDevices.length; i++) {
                if (currentDevices[i].ipv4 === ip) return currentDevices[i];
            }
            return null;
        }

        function buildView() {
            // Build rate map by IP
            var rates = {};
            currentTraffic.forEach(function(t) {
                rates[t.ip] = t;
            });

            // Only show devices we know about (skip external IPs)
            var rows = [
                E('tr', { 'class': 'tr table-titles' }, [
                    E('th', { 'class': 'th' }, _('Device')),
                    E('th', { 'class': 'th' }, _('IP Address')),
                    E('th', { 'class': 'th' }, _('MAC')),
                    E('th', { 'class': 'th' }, _('Upload')),
                    E('th', { 'class': 'th' }, _('Download')),
                    E('th', { 'class': 'th' }, _('Total')),
                    E('th', { 'class': 'th' }, _('Speed Limit'))
                ])
            ];

            var shown = 0;
            currentDevices.forEach(function(d) {
                var r = rates[d.ipv4] || { up_bps: 0, down_bps: 0, total_bps: 0 };

                rows.push(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td' }, [ d.hostname || '—' ]),
                    E('td', { 'class': 'td' }, [ d.ipv4 ]),
                    E('td', { 'class': 'td', 'style': 'font-family:monospace;font-size:11px' }, [ d.mac ]),
                    E('td', { 'class': 'td' }, [ fmtRate(r.up_bps) ]),
                    E('td', { 'class': 'td' }, [ fmtRate(r.down_bps) ]),
                    E('td', { 'class': 'td' }, [ fmtRate(r.total_bps) ]),
                    E('td', { 'class': 'td', 'style': 'font-size:12px' }, [ limitForDevice(d.mac) ])
                ]));
                shown++;
            });

            if (shown === 0) {
                rows.push(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td', 'colspan': 7, 'style': 'text-align:center;padding:20px;color:#888' },
                        _('No client devices found. Check the Clients tab first.'))
                ]));
            }

            return E('div', {}, [
                E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:1em' }, [
                    E('button', {
                        'class': 'btn cbi-button cbi-button-action',
                        'click': function() { refresh(); }
                    }, [ _('Refresh') ]),
                    ' ',
                    _('Refresh interval:'),
                    ' ',
                    E('select', {
                        'style': 'padding:4px',
                        'change': function(ev) { interval = parseInt(ev.target.value, 10); }
                    }, [
                        E('option', { 'value': '3',  'selected': interval === 3  }, '3 s'),
                        E('option', { 'value': '5',  'selected': interval === 5  }, '5 s'),
                        E('option', { 'value': '10', 'selected': interval === 10 }, '10 s'),
                        E('option', { 'value': '30', 'selected': interval === 30 }, '30 s')
                    ])
                ]),
                E('table', { 'class': 'table' }, rows),
                E('p', { 'style': 'margin-top:1em;font-size:12px;color:#888' },
                    _('Byte rates calculated from conntrack deltas. First view may show 0 until a second sample is taken. ' +
                      'Speed limits are not yet enforced — coming in a future phase.'))
            ]);
        }

        function refresh() {
            return Promise.all([ callListDevices(), callTraffic() ]).then(function(r) {
                currentDevices = (r[0] && r[0].devices) || [];
                currentTraffic = (r[1] && r[1].devices) || [];
                trafficInterval = (r[1] && r[1].interval) || 1;
                while (container.firstChild) container.removeChild(container.firstChild);
                container.appendChild(buildView());
            });
        }

        // Initial paint
        container.appendChild(buildView());

        // Auto refresh
        poll.add(function() {
            return refresh();
        }, 5);

        var subnetContainer = E('div', { 'id': 'access-shield-subnets' });

        function buildSubnetView(subs) {
            var rows = [
                E('tr', { 'class': 'tr table-titles' }, [
                    E('th', { 'class': 'th' }, _('Bridge')),
                    E('th', { 'class': 'th' }, _('Subnet (CIDR)')),
                    E('th', { 'class': 'th' }, _('Download Limit')),
                    E('th', { 'class': 'th' }, _('Upload Limit')),
                    E('th', { 'class': 'th' }, '')
                ])
            ];

            subs.forEach(function(s) {
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
                            'click': function() {
                                callSetSubnetLimit(s.cidr, s.bridge, s.bridge, dlv.value, dlu.value, ulv.value, ulu.value)
                                    .then(function() {
                                        ui.addNotification(null, E('p', {}, _('Subnet limit saved.')), 'info');
                                        return new Promise(function(r) { setTimeout(r, 800); });
                                    }).then(function() { window.location.reload(); });
                            }
                        }, _('Save'))
                    ])
                ]));
            });

            if (subs.length === 0) {
                rows.push(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td', 'colspan': 5, 'style': 'text-align:center;padding:20px;color:#888' },
                        _('No IPv4 bridges detected.'))
                ]));
            }

            return E('table', { 'class': 'table' }, rows);
        }

        container.parentNode && (function() {
            var subs = unwrapList(data[4], 'subnets');
            subnetContainer.appendChild(buildSubnetView(subs));
        })();

        // Lazy-load subnets after the main view is built
        setTimeout(function() {
            callListSubnets().then(function(r) {
                var subs = unwrapList(r, 'subnets');
                while (subnetContainer.firstChild) subnetContainer.removeChild(subnetContainer.firstChild);
                subnetContainer.appendChild(buildSubnetView(subs));
            });
        }, 100);

        return E('div', {}, [
            E('h2', {}, _('Access Shield')),
            E('p', { 'style': 'opacity:0.85;font-size:0.95em;margin-top:-4px;margin-bottom:16px' }, _('Device Access Control & Traffic Monitor')),
            E('p', {}, _('Per-device upload/download rates from conntrack. Auto-refreshes every 5 seconds.')),
            container,
            E('h3', { 'style': 'margin-top:2em' }, _('Per-Subnet Bandwidth Limits')),
            E('p', { 'style': 'font-size:12px;color:#888' },
                _('Aggregate caps per bridge. Applies to all traffic forwarded across the subnet. Individual device limits take precedence.')),
            subnetContainer
        ]);
    },

    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});
