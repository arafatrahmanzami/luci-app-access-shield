'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require rpc';

var callSync        = rpc.declare({ object: 'luci.access_shield', method: 'sync',         expect: {} });
var callListBridges = rpc.declare({ object: 'luci.access_shield', method: 'list_bridges', expect: { bridges: [] } });
var callAddBridge   = rpc.declare({ object: 'luci.access_shield', method: 'add_bridge',   params: ['iface', 'label'] });

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('access_shield'),
            callListBridges()
        ]);
    },

    render: function(data) {
        var raw = data[1];
        var kernelList = Array.isArray(raw) ? raw
                       : (raw && Array.isArray(raw.bridges)) ? raw.bridges
                       : [];
        var container = E('div', {});

        // Collect UCI-managed devices
        var managedDevices = {};
        var sections = uci.sections('access_shield', 'interface') || [];
        sections.forEach(function(s) {
            if (s.device) managedDevices[s.device] = s;
        });

        // Kernel bridges not yet managed
        var unmanaged = kernelList.filter(function(b) {
            return b && b.name && !managedDevices[b.name];
        });

        if (unmanaged.length > 0) {
            var rows = [
                E('tr', { 'class': 'tr table-titles' }, [
                    E('th', { 'class': 'th' }, _('Bridge')),
                    E('th', { 'class': 'th' }, _('Subnet')),
                    E('th', { 'class': 'th' }, _('State')),
                    E('th', { 'class': 'th' }, _('Label')),
                    E('th', { 'class': 'th' }, _('Action'))
                ])
            ];

            unmanaged.forEach(function(b) {
                var labelInput = E('input', {
                    'type': 'text',
                    'placeholder': b.name,
                    'style': 'padding:4px;width:180px'
                });

                rows.push(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td' }, [ E('code', {}, b.name) ]),
                    E('td', { 'class': 'td' }, [ b.subnet || '\u2014' ]),
                    E('td', { 'class': 'td' }, [ b.state  || '\u2014' ]),
                    E('td', { 'class': 'td' }, [ labelInput ]),
                    E('td', { 'class': 'td' }, [
                        E('button', {
                            'class': 'btn cbi-button-action',
                            'click': function() {
                                var label = labelInput.value.trim() || b.name;
                                callAddBridge(b.name, label).then(function(res) {
                                    if (res && res.ok) {
                                        ui.addNotification(null,
                                            E('p', {}, _('Bridge %s adopted. Reloading...').format(b.name)),
                                            'info');
                                        setTimeout(function() { window.location.reload(); }, 800);
                                    } else {
                                        var err = (res && res.error) ? res.error : _('unknown error');
                                        ui.addNotification(null,
                                            E('p', {}, _('Failed: %s').format(err)),
                                            'error');
                                    }
                                });
                            }
                        }, _('Adopt'))
                    ])
                ]));
            });

            container.appendChild(E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:1.5em' }, [
                E('h3', {}, _('Unmanaged bridges')),
                E('p', { 'style': 'font-size:12px;color:#888' },
                    _('Kernel bridges not yet tracked by Access Shield. Adopt one to manage its enforcement mode below. ' +
                      'New bridges default to mode disabled with enforcement OFF.')),
                E('table', { 'class': 'table' }, rows)
            ]));
        }

        // Existing form.Map -- edit managed bridges
        var m = new form.Map('access_shield', _('Managed Bridges'),
            _('Select mode per bridge. reply_only enforces nftables whitelist. loose does nothing. ' +
              'The Label is your friendly name; the Device is the actual kernel bridge.'));

        var s = m.section(form.GridSection, 'interface', _('Bridges'));
        s.addremove = false;
        s.sortable  = false;

        var o;
        o = s.option(form.Value, 'label', _('Label'));
        o.rmempty = false;
        o.placeholder = _('e.g. Camera Network');

        o = s.option(form.Value, 'device', _('Device'));
        o.rmempty = false;
        o.readonly = true;

        o = s.option(form.ListValue, 'mode', _('Mode'));
        o.value('disabled',   _('disabled \u2014 no action'));
        o.value('loose',      _('loose \u2014 do nothing'));
        o.value('reply_only', _('reply_only \u2014 whitelist enforcement'));

        o = s.option(form.Flag, 'enabled',      _('Enable'));
        o = s.option(form.Flag, 'dhcp_allow',   _('Allow DHCP'));
        o = s.option(form.Flag, 'default_drop', _('Default drop IPv4'));

        var rendered = m.render();
        if (rendered && typeof rendered.then === 'function') {
            return rendered.then(function(formEl) {
                container.appendChild(formEl);
                return container;
            });
        }
        container.appendChild(rendered);
        return container;
    },

    handleSaveApply: function(ev, mode) {
        return this.handleSave(ev).then(function() {
            return ui.changes.apply(mode == '0');
        }).then(function() {
            return callSync();
        }).then(function() {
            ui.addNotification(null, E('p', {}, _('Interface modes applied.')), 'info');
        });
    }
});
