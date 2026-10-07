'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require rpc';

var callSync        = rpc.declare({ object: 'luci.access_shield', method: 'sync',         expect: {} });
var callListBridges = rpc.declare({ object: 'luci.access_shield', method: 'list_bridges', expect: { bridges: [] } });
var callAddBridge   = rpc.declare({ object: 'luci.access_shield', method: 'add_bridge',   params: ['iface', 'label'] });
var callRemoveIface = rpc.declare({ object: 'luci.access_shield', method: 'remove_interface', params: ['iface'] });

function openAddIfaceModal() {
    var nameInput = E('input', { 'type': 'text', 'placeholder': 'br-iot', 'style': 'width:100%;padding:6px;font-family:monospace' });
    var labelInput = E('input', { 'type': 'text', 'placeholder': _('e.g. IoT Network'), 'style': 'width:100%;padding:6px' });

    ui.showModal(_('Add Interface by Name'), [
        E('p', { 'style': 'font-size:12px;color:#888;margin:0 0 8px 0' },
            _('For bridges that are not yet visible above — typically pre-provisioning a bridge you plan to create soon, or a manual override for auto-discovery.')),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Interface')),
            E('div', { 'class': 'cbi-value-field' }, [ nameInput ])
        ]),
        E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title' }, _('Label')),
            E('div', { 'class': 'cbi-value-field' }, [ labelInput ])
        ]),
        E('p', { 'style': 'font-size:12px;color:#888' },
            _('Only kernel Linux bridges (or br-* names for pre-provisioning) are supported in this release. ' +
              'VLAN, WiFi AP, bond, and veth support is planned for a future release.')),
        E('p', { 'style': 'font-size:12px;color:#888' },
            _('Adopted bridges default to mode disabled with enforcement OFF. Turn on Enable on the Managed Bridges table when ready.')),
        E('div', { 'class': 'right' }, [
            E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
            ' ',
            E('button', {
                'class': 'btn cbi-button-action',
                'click': function() {
                    var iface = nameInput.value.trim();
                    var label = labelInput.value.trim() || iface;
                    if (!iface) {
                        ui.addNotification(null, E('p', {}, _('Interface name required.')), 'error');
                        return;
                    }
                    if (!/^[a-zA-Z0-9._:-]+$/.test(iface)) {
                        ui.addNotification(null, E('p', {}, _('Invalid interface name. Use letters, digits, dot, colon, dash, underscore.')), 'error');
                        return;
                    }
                    ui.hideModal();
                    callAddBridge(iface, label).then(function(res) {
                        if (res && res.ok) {
                            ui.addNotification(null, E('p', {}, _('Interface %s adopted.').format(iface)), 'info');
                            setTimeout(function() { window.location.reload(); }, 800);
                        } else {
                            var err = (res && res.error) ? res.error : _('unknown error');
                            ui.addNotification(null, E('p', {}, _('Failed: %s').format(err)), 'error');
                        }
                    });
                }
            }, _('Add'))
        ])
    ]);
}

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

        // Detect orphans: UCI sections whose device no longer exists in kernel
        var kernelSet = {};
        kernelList.forEach(function(b) { if (b && b.name) kernelSet[b.name] = true; });
        var orphans = sections.filter(function(s) {
            return s.device && !kernelSet[s.device];
        });

        if (orphans.length > 0) {
            var orphanRows = [
                E('tr', { 'class': 'tr table-titles' }, [
                    E('th', { 'class': 'th' }, _('Section')),
                    E('th', { 'class': 'th' }, _('Device')),
                    E('th', { 'class': 'th' }, _('Label')),
                    E('th', { 'class': 'th' }, _('Status')),
                    E('th', { 'class': 'th' }, _('Action'))
                ])
            ];

            orphans.forEach(function(s) {
                orphanRows.push(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td' }, [ E('code', {}, s['.name'] || '') ]),
                    E('td', { 'class': 'td' }, [ E('code', {}, s.device) ]),
                    E('td', { 'class': 'td' }, [ s.label || '\u2014' ]),
                    E('td', { 'class': 'td' }, [
                        E('span', {
                            'style': 'display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;background:#e67e22;color:#fff'
                        }, _('\u26a0 missing'))
                    ]),
                    E('td', { 'class': 'td' }, [
                        E('button', {
                            'class': 'btn cbi-button-negative',
                            'click': function() {
                                if (!confirm(_('Remove section "%s" for device %s?\n\nThe interface no longer exists in the kernel. This action deletes the UCI section.').format(s['.name'] || '', s.device))) return;
                                callRemoveIface(s.device).then(function(res) {
                                    if (res && res.ok) {
                                        ui.addNotification(null,
                                            E('p', {}, _('Removed %s.').format(s.device)),
                                            'info');
                                        setTimeout(function() { window.location.reload(); }, 800);
                                    } else {
                                        var err = (res && res.error) ? res.error : _('unknown error');
                                        ui.addNotification(null,
                                            E('p', {}, _('Remove failed: %s').format(err)),
                                            'error');
                                    }
                                });
                            }
                        }, _('Remove'))
                    ])
                ]));
            });

            container.appendChild(E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:1.5em;border-left:3px solid #e67e22;padding-left:1em' }, [
                E('h3', { 'style': 'color:#e67e22' }, _('\u26a0 Orphaned sections')),
                E('p', { 'style': 'font-size:12px;color:#888' },
                    _('These UCI sections reference kernel interfaces that no longer exist. ' +
                      'Enforcement safely skips them (iface_exists guard), but they clutter the config. ' +
                      'Remove to clean up.')),
                E('table', { 'class': 'table' }, orphanRows)
            ]));
        }

        // Manual Add button
        container.appendChild(E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:1em' }, [
            E('button', {
                'class': 'btn cbi-button-action',
                'click': function() { openAddIfaceModal(); }
            }, '+ ' + _('Add Interface by Name'))
        ]));

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
