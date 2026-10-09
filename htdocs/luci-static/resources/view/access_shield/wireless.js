'use strict';
'require view';
'require uci';
'require ui';
'require rpc';

var callListDevices  = rpc.declare({ object: 'luci.access_shield', method: 'list_devices' });
var callWifiIfaces   = rpc.declare({ object: 'luci.access_shield', method: 'wifi_interfaces' });
var callSetMacFilter = rpc.declare({ object: 'luci.access_shield', method: 'set_mac_filter', params: ['section','mac','action'] });

function unwrap(d, k) {
    if (!d) return [];
    if (Array.isArray(d)) return d;
    if (typeof d === 'object' && Array.isArray(d[k])) return d[k];
    if (typeof d === 'string') { try { var p = JSON.parse(d); return p[k] || []; } catch(e) {} }
    return [];
}

return view.extend({
    load: function() {
        return Promise.all([ uci.load('access_shield'), callListDevices(), callWifiIfaces() ]);
    },

    render: function(data) {
        var devices = unwrap(data[1], 'devices');
        var ifaces  = unwrap(data[2], 'interfaces');

        // Only AP-mode interfaces
        ifaces = ifaces.filter(function(i) { return i.mode === 'ap'; });

        // Device dropdown
        var macSelect = E('select', { 'style': 'min-width:320px;padding:6px;font-size:1em' });
        macSelect.appendChild(E('option', { 'value': '' }, _('— Select a device —')));
        devices.forEach(function(d) {
            var label = (d.hostname || _('Unknown')) + ' (' + d.mac + ')';
            macSelect.appendChild(E('option', { 'value': d.mac }, label));
        });
        macSelect.appendChild(E('option', { 'value': 'custom' }, _('✏️ Custom MAC Address...')));

        var customMac = E('input', {
            'type': 'text',
            'placeholder': 'AA:BB:CC:DD:EE:FF',
            'style': 'display:none;width:220px;margin-left:10px;padding:5px;font-family:monospace',
            'maxlength': '17'
        });

        // Group interfaces by radio
        var byRadio = {};
        ifaces.forEach(function(i) {
            var r = i.device || 'unknown';
            (byRadio[r] = byRadio[r] || []).push(i);
        });

        var ifaceContainer = E('div');

        Object.keys(byRadio).sort().forEach(function(radio) {
            var fieldset = E('fieldset', { 'class': 'cbi-section' }, [
                E('legend', { 'style': 'font-size:1.1em;font-weight:bold' }, radio)
            ]);

            byRadio[radio].forEach(function(i) {
                var row = E('div', {
                    'class': 'cbi-value',
                    'data-section': i.section,
                    'data-maclist': JSON.stringify(i.maclist || [])
                }, [
                    E('label', { 'class': 'cbi-value-title', 'style': 'font-weight:600' },
                        i.ssid || i.section),
                    E('div', { 'class': 'cbi-value-field' }, [
                        E('input', { 'type': 'checkbox', 'class': 'cm-cb', 'data-section': i.section,
                            'style': 'transform:scale(1.3);margin-right:6px;vertical-align:middle' }),
                        E('span', { 'style': 'vertical-align:middle' },
                            _('Filter: ') + i.macfilter)
                    ])
                ]);
                fieldset.appendChild(row);
            });
            ifaceContainer.appendChild(fieldset);
        });

        // ── Per-SSID summary table ────────────────────────────────
        var summaryRows = [
            E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th' }, _('Radio')),
                E('th', { 'class': 'th' }, _('SSID')),
                E('th', { 'class': 'th' }, _('Filter')),
                E('th', { 'class': 'th' }, _('Allowed MACs'))
            ])
        ];

        ifaces.forEach(function(i) {
            var macs = i.maclist || [];
            var filterState = (i.macfilter || '').toLowerCase();
            var filterBadge = filterState === 'allow'
                ? E('span', { 'style': 'display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;background:#27ae60;color:#fff' }, _('allow'))
                : E('span', { 'style': 'display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;background:#888;color:#fff' }, _('disable'));

            var macsDisplay;
            if (macs.length === 0) {
                macsDisplay = E('span', { 'style': 'color:#888;font-style:italic' }, _('(none)'));
            } else if (macs.length <= 3) {
                macsDisplay = E('span', { 'style': 'font-family:monospace;font-size:11px' }, macs.join(', '));
            } else {
                macsDisplay = E('span', {}, [
                    E('span', { 'style': 'font-family:monospace;font-size:11px' }, macs.slice(0, 3).join(', ')),
                    ' ',
                    E('span', { 'style': 'color:#888' }, _('+%d more').format(macs.length - 3))
                ]);
            }

            summaryRows.push(E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td' }, [ E('code', {}, i.device || '\u2014') ]),
                E('td', { 'class': 'td' }, [ i.ssid || i.section || '\u2014' ]),
                E('td', { 'class': 'td' }, [ filterBadge ]),
                E('td', { 'class': 'td' }, [ macsDisplay ])
            ]));
        });

        var summaryTable = E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:1.5em' }, [
            E('h3', {}, _('Per-SSID filtering status')),
            E('p', { 'style': 'font-size:12px;color:#888' },
                _('Current hostapd MAC filter state per SSID. Filter must be "allow" for the checkbox list below to have any effect.')),
            E('table', { 'class': 'table' }, summaryRows)
        ]);

        function getActiveMac() {
            if (macSelect.value === 'custom') return (customMac.value || '').trim().toUpperCase();
            return (macSelect.value || '').trim().toUpperCase();
        }

        function updateCheckboxes() {
            var mac = getActiveMac();
            var valid = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac);
            ifaceContainer.querySelectorAll('.cm-cb').forEach(function(cb) {
                if (!valid) { cb.disabled = true; cb.checked = false; return; }
                cb.disabled = false;
                var row = cb.closest('[data-maclist]');
                var list = [];
                try { list = JSON.parse(row.getAttribute('data-maclist')).map(function(m){ return m.toUpperCase(); }); } catch(e) {}
                cb.checked = list.indexOf(mac) > -1;
            });
        }

        macSelect.addEventListener('change', function() {
            if (this.value === 'custom') { customMac.style.display = 'inline-block'; customMac.focus(); }
            else { customMac.style.display = 'none'; }
            updateCheckboxes();
        });
        customMac.addEventListener('input', updateCheckboxes);

        var applyBtn = E('button', {
            'class': 'cbi-button cbi-button-save',
            'click': function() {
                var mac = getActiveMac();
                if (!/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac)) {
                    ui.addNotification(null, E('p', {}, _('Enter a valid MAC address.')), 'warning');
                    return;
                }
                var promises = [];
                ifaceContainer.querySelectorAll('.cm-cb').forEach(function(cb) {
                    var sec = cb.getAttribute('data-section');
                    var row = cb.closest('[data-maclist]');
                    var list = [];
                    try { list = JSON.parse(row.getAttribute('data-maclist')).map(function(m){ return m.toUpperCase(); }); } catch(e) {}
                    var was = list.indexOf(mac) > -1;
                    var now = cb.checked;
                    if (now && !was) promises.push(callSetMacFilter(sec, mac, 'add'));
                    else if (!now && was) promises.push(callSetMacFilter(sec, mac, 'remove'));
                });
                if (promises.length === 0) {
                    ui.addNotification(null, E('p', {}, _('No changes to apply.')), 'info');
                    return;
                }
                Promise.all(promises).then(function() {
                    ui.addNotification(null, E('p', {}, _('MAC filter updated for %s. WiFi reloading…').format(mac)), 'info');
                    setTimeout(function() { window.location.reload(); }, 3000);
                });
            }
        }, _('Apply Changes'));

        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, _('Access Shield')),
            E('p', { 'style': 'opacity:0.85;font-size:0.95em;margin-top:-4px;margin-bottom:16px' }, _('Device Access Control & Traffic Monitor')),
            E('p', { 'class': 'cbi-map-descr' },
                _('Manage which SSIDs a device is allowed to connect to using hostapd MAC filtering.')),
            summaryTable,
            E('div', { 'class': 'cbi-section' }, [
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Device')),
                    E('div', { 'class': 'cbi-value-field' }, [ macSelect, customMac ])
                ])
            ]),
            ifaceContainer,
            E('div', { 'class': 'cbi-page-actions' }, [ applyBtn ])
        ]);
    },

    handleSave: null,
    handleSaveApply: null,
    handleReset: null
});
