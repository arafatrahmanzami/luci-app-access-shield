'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require rpc';
'require fs';

var callSync   = rpc.declare({ object: 'luci.access_shield', method: 'sync',        expect: {} });
var callMigScan= rpc.declare({ object: 'luci.access_shield', method: 'migrate_scan',expect: {} });
var callMigImp = rpc.declare({ object: 'luci.access_shield', method: 'migrate_import', expect: {} });

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('access_shield'),
            fs.read('/tmp/access_shield_admin_safeguard.log').catch(function(){ return ''; })
        ]);
    },

    render: function(data) {
        var adminLog = data[1] || '';
        var m, s, o;

        m = new form.Map('access_shield',
            _('Access Shield'),
            _( 'Device Access Control & Traffic Monitor. ' ) + _('Global configuration. Nothing runs until the master switch is ON.'));

        s = m.section(form.NamedSection, 'settings', 'global', _('Master'));

        o = s.option(form.Flag, 'enabled', _('Enable Access Shield'));
        o.default = '0';
        o.rmempty = false;

        // ── Feature toggles ──────────────────────────────────────
        var f = m.section(form.NamedSection, 'settings', 'global', _('Features'));

        o = f.option(form.Flag, 'arp', _('nftables whitelist (reply-only enforcement)'));
        o.default = '1';

        o = f.option(form.Flag, 'dhcp', _('Static DHCP lease mirroring'));
        o.default = '1';

        o = f.option(form.Flag, 'admin', _('Admin self-safeguard (recommended)'));
        o.default = '1';
        o.readonly = false;
        o.description = _('Auto-binds your current session before applying rules.');

        o = f.option(form.Flag, 'rogue', _('Rogue DHCP shield'));
        o.default = '1';

        o = f.option(form.Flag, 'discovery', _('Live device discovery (Overview page)'));
        o.default = '1';

        o = f.option(form.Flag, 'firewall', _('Per-device internet block (Firewall page)'));
        o.default = '0';

        o = f.option(form.Flag, 'wireless', _('Wireless MAC filter management (Wireless page)'));
        o.default = '0';

        o = f.option(form.Flag, 'bandwidth', _('Bandwidth monitoring (Bandwidth page)'));
        o.default = '0';

        // ── Compatibility ────────────────────────────────────────
        var c = m.section(form.NamedSection, 'settings', 'global', _('Compatibility'));

        o = c.option(form.ListValue, 'compat_mode', _('Compatibility mode'));
        o.value('off',       _('off — silent, ignore other systems'));
        o.value('warn',      _('warn — detect and show panel (default)'));
        o.value('integrate', _('integrate — warn + skip duplicate work where safe'));
        o.default = 'warn';

        // ── Interface defaults ───────────────────────────────────
        var i = m.section(form.NamedSection, 'settings', 'global', _('Defaults'));

        o = i.option(form.Value, 'default_iface', _('Default interface for new bindings'));
        o.placeholder = 'br-lan2';

        o = i.option(form.Value, 'exclude_ifaces', _('Excluded interfaces (space-separated)'));
        o.placeholder = 'bat0 tailscale0 pppoe-wan';

        o = i.option(form.Value, 'scan_interval', _('Discovery refresh (seconds)'));
        o.datatype = 'uinteger';

        o = i.option(form.Value, 'dashboard_interval', _('Dashboard refresh interval (seconds)'));
        o.datatype = 'uinteger';
        o.placeholder = '15';
        o.description = _('How often the Dashboard auto-refreshes. Lower = more responsive ticket timer and device state; higher = less router load. 15 is the default. Set to 0 to disable auto-refresh entirely.');

        o = i.option(form.Value, 'traffic_interval', _('Traffic refresh interval (seconds)'));
        o.datatype = 'uinteger';
        o.placeholder = '2';
        o.description = _('How often the Traffic tab auto-refreshes. This is the poll interval; the "Backend sample" value on the Traffic page is a separate, server-side conntrack sample rate. 2 is the default. Set to 0 to disable auto-refresh entirely.');

        // ── Firewall permission ──────────────────────────────────
        var fw = m.section(form.NamedSection, 'settings', 'global', _('Firewall policy'));
        fw.description = _('Access Shield never writes /etc/config/firewall unless you explicitly allow it here.');

        o = fw.option(form.Flag, 'firewall_write', _('Allow Access Shield to write firewall rules'));
        o.default = '0';
        o.rmempty = false;
        o.description = _('When OFF (recommended), the Setup wizard only verifies firewall rules and points you at Network → Firewall to fix them manually. When ON, the wizard\'s "Add missing rules" button will write the missing allow rules for DHCP/DNS/LuCI into /etc/config/firewall. A snapshot is taken first and restored if fw4 fails to reload.');

        // ── Admin safeguard log ──────────────────────────────────
        var a = m.section(form.NamedSection, 'settings', 'global', _('Admin safeguard log'));
        a.description = _('Auto-bound sessions are recorded here for audit.');

        o = a.option(form.TextValue, '_admin_log_view', _('Recent auto-bindings'));
        o.rows = 8;
        o.readonly = true;
        o.cfgvalue = function() { return adminLog || _('(no auto-bindings logged yet)'); };
        o.write    = function() {};
        o.remove   = function() {};

        // ── Migration ────────────────────────────────────────────
        var mg = m.section(form.NamedSection, 'settings', 'global', _('Migration from legacy arpbind'));
        mg.description = _('Import bindings from /etc/config/arpbind. Nothing is modified until you confirm.');

        o = mg.option(form.Button, '_migrate_scan', _('Scan legacy config'));
        o.inputtitle = _('Scan');
        o.inputstyle = 'apply';
        o.onclick = function() {
            return callMigScan().then(function(r) {
                ui.showModal(_('Legacy entries found'), [
                    E('pre', { 'style': 'max-height:400px;overflow:auto;background:#111;padding:10px;color:#eee' },
                        r.result || _('(nothing)')),
                    E('div', { 'class': 'right' }, [
                        E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close'))
                    ])
                ]);
            });
        };

        o = mg.option(form.Button, '_migrate_import', _('Import selected'));
        o.inputtitle = _('Import all');
        o.inputstyle = 'apply';
        o.onclick = function() {
            return callMigImp().then(function(r) {
                ui.addNotification(null, E('p', {}, r.output || _('Import complete')), 'info');
                return callSync();
            });
        };

        return m.render();
    },

    handleSaveApply: function(ev, mode) {
        return this.handleSave(ev).then(function() {
            return ui.changes.apply(mode == '0');
        }).then(function() {
            return callSync();
        }).then(function() {
            ui.addNotification(null, E('p', {}, _('Settings applied.')), 'info');
        });
    }
});
