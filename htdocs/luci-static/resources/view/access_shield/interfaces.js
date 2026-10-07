'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require rpc';

var callSync = rpc.declare({ object: 'luci.access_shield', method: 'sync', expect: {} });

return view.extend({
    load: function() {
        return uci.load('access_shield');
    },

    render: function() {
        var m, s, o;

        m = new form.Map('access_shield', _('Access Shield'),
            _('Select mode per bridge. reply_only enforces nftables whitelist. loose does nothing. ' +
              'The Label is your friendly name — the Device is the actual kernel bridge.'));

        s = m.section(form.GridSection, 'interface', _('Bridges'));
        s.addremove = false;
        s.sortable  = false;

        // ── Friendly label (editable by user) ─────────────────
        o = s.option(form.Value, 'label', _('Label'));
        o.rmempty = false;
        o.placeholder = _('e.g. Camera Network');

        // ── Device (readonly — bound to the kernel bridge name) ──
        o = s.option(form.Value, 'device', _('Device'));
        o.rmempty = false;
        o.readonly = true;

        // ── Mode ──────────────────────────────────────────────
        o = s.option(form.ListValue, 'mode', _('Mode'));
        o.value('disabled',   _('disabled — no action'));
        o.value('loose',      _('loose — do nothing'));
        o.value('reply_only', _('reply_only — whitelist enforcement'));

        // ── Toggles ───────────────────────────────────────────
        o = s.option(form.Flag, 'enabled',      _('Enable'));
        o = s.option(form.Flag, 'dhcp_allow',   _('Allow DHCP'));
        o = s.option(form.Flag, 'default_drop', _('Default drop IPv4'));

        return m.render();
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
