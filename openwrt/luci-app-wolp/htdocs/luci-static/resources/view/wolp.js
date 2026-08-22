'use strict';
'require view';
'require dom';
'require uci';
'require ui';
'require rpc';
'require form';
'require tools.widgets as widgets';

return view.extend({
	formdata: { wol: {} },
	devices: [],

	callWolpStat: rpc.declare({
		object: 'luci.wolp',
		method: 'stat',
		expect: { '': {} }
	}),

	callWolpWake: rpc.declare({
		object: 'luci.wolp',
		method: 'wake',
		params: [ 'mac', 'interface', 'broadcast' ],
		expect: { '': {} }
	}),

	callWolpShutdown: rpc.declare({
		object: 'luci.wolp',
		method: 'shutdown',
		params: [ 'mac', 'interface', 'broadcast', 'extra_data' ],
		expect: { '': {} }
	}),

	callWolpDevices: rpc.declare({
		object: 'luci.wolp',
		method: 'devices',
		expect: { '': {} }
	}),

	parseExecResult: function(res) {
		if (res && !res.code)
			return res;

		throw new Error((res && (res.stderr || res.stdout)) || ('exit code ' + ((res && res.code) || 1)));
	},

	normalizeMac: function(value) {
		var clean = String(value || '').trim().replace(/-/g, ':').toUpperCase();
		return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(clean) ? clean : null;
	},

	deviceLabel: function(device) {
		var details = [],
			name = device.name || _('Unnamed device');

		if (device.online)
			details.push(_('Online'));
		else if (device.source === 'static')
			details.push(_('Static DHCP'));
		else
			details.push(_('Known device'));

		if (device.ip)
			details.push(device.ip);
		details.push(device.mac);

		return name + ' - ' + details.join(' - ');
	},

	load: function() {
		return Promise.all([
			L.resolveDefault(this.callWolpStat(), {}),
			L.resolveDefault(this.callWolpDevices(), {}),
			uci.load('luci-wolp')
		]);
	},

	render: function(data) {
		var stat = data[0] || {},
			devices = (data[1] || {}).devices || [],
			m,
			s,
			o;

		this.formdata.has_ewk = !!stat.etherwake;
		this.devices = devices.filter(function(device) {
			return device && device.mac;
		}).sort(function(a, b) {
			var aName = String(a.name || a.mac).toLowerCase(),
				bName = String(b.name || b.mac).toLowerCase();

			if (!!a.online !== !!b.online)
				return a.online ? -1 : 1;

			return aName.localeCompare(bName);
		});

		m = new form.JSONMap(this.formdata, _('Wake on LAN Plus'));
		s = m.section(form.NamedSection, 'wol');
		s.tab('target', _('Target device'), _('Choose a device already known to this router before sending a wake or shutdown frame.'));
		s.tab('send', _('Send frame'));

		o = s.taboption('target', form.ListValue, 'target_mode', _('Target source'));
		o.value('router', _('Choose a device known to this router'));
		o.value('manual', _('Enter a MAC address manually'));
		o.default = this.devices.length ? 'router' : 'manual';
		o.rmempty = false;

		o = s.taboption('target', form.ListValue, 'target', _('Router device'));
		if (this.devices.length) {
			this.devices.forEach(function(device) {
				o.value(device.mac, this.deviceLabel(device));
			}, this);
			o.default = this.devices[0].mac;
		}
		else {
			o.value('', _('No router devices were found'));
		}
		o.depends('target_mode', 'router');
		o.rmempty = false;

		o = s.taboption('target', form.Value, 'mac', _('Target MAC address'));
		o.description = _('Use this only when the target is not listed above.');
		o.datatype = 'macaddr';
		o.rmempty = false;
		o.depends('target_mode', 'manual');

		o = s.taboption('target', form.Button, 'refresh_devices', _('Device list'));
		o.inputtitle = _('Refresh');
		o.inputstyle = 'action';
		o.onclick = function() {
			window.location.reload();
		};

		o = s.taboption('send', form.ListValue, 'action', _('Action'));
		o.value('wake', _('Wake up'));
		o.value('shutdown', _('Shutdown'));
		o.default = 'wake';

		o = s.taboption('send', widgets.DeviceSelect, 'iface', _('Network interface to use'));
		o.default = uci.get('luci-wolp', 'defaults', 'interface') || 'br-lan';
		o.rmempty = false;
		o.noaliases = true;
		o.noinactive = true;

		o = s.taboption('send', form.Flag, 'broadcast', _('Send to broadcast address'));

		o = s.taboption('send', form.Value, 'extra_data', _('Shutdown discriminator'));
		o.default = uci.get('luci-wolp', 'defaults', 'extra_data') || 'FF:FF:FF:FF:FF:FF';
		o.placeholder = 'FF:FF:FF:FF:FF:FF';
		o.datatype = 'macaddr';
		o.rmempty = false;
		o.depends('action', 'shutdown');

		return m.render();
	},

	handleAction: function() {
		var map = document.querySelector('#maincontent .cbi-map'),
			data = this.formdata,
			self = this;

		return dom.callClassMethod(map, 'save').then(function() {
			var action = data.wol.action || 'wake',
				targetMode = data.wol.target_mode || (self.devices.length ? 'router' : 'manual'),
				mac = self.normalizeMac(targetMode === 'manual' ? data.wol.mac : data.wol.target),
				iface = String(data.wol.iface || '').trim(),
				broadcast = data.wol.broadcast === '1';

			if (!data.has_ewk)
				throw new Error(_('etherwake is not installed'));
			if (!mac || !iface)
				throw new Error(_('A target MAC address and network interface are required'));

			if (action === 'wake') {
				ui.showModal(_('Waking host'), [ E('p', { 'class': 'spinning' }, [ _('Sending Ethernet wake frame…') ]) ]);
				return self.callWolpWake(mac, iface, broadcast).then(self.parseExecResult).then(function() {
					ui.showModal(_('Wake frame sent'), [
						E('div', { 'class': 'right' }, [ E('button', { 'class': 'cbi-button cbi-button-primary', 'click': ui.hideModal }, [ _('Dismiss') ]) ])
					]);
				});
			}

			var extraData = self.normalizeMac(data.wol.extra_data);
			if (!extraData)
				throw new Error(_('Shutdown discriminator must be a 6-byte hexadecimal value'));

			uci.set('luci-wolp', 'defaults', 'extra_data', extraData);
			ui.showModal(_('Shutting down host'), [ E('p', { 'class': 'spinning' }, [ _('Sending Ethernet shutdown frame…') ]) ]);
			return uci.save().then(function() {
				return self.callWolpShutdown(mac, iface, broadcast, extraData);
			}).then(self.parseExecResult).then(function() {
				ui.showModal(_('Shutdown frame sent'), [
					E('div', { 'class': 'right' }, [ E('button', { 'class': 'cbi-button cbi-button-primary', 'click': ui.hideModal }, [ _('Dismiss') ]) ])
				]);
			});
		}).catch(function(err) {
			ui.hideModal();
			ui.addNotification(null, [ E('p', [ _('Operation failed') + ': ' + (err.message || err) ]) ]);
		});
	},

	addFooter: function() {
		return E('div', { 'class': 'cbi-page-actions' }, [
			E('button', {
				'class': 'cbi-button cbi-button-apply',
				'click': L.ui.createHandlerFn(this, 'handleAction')
			}, [ _('Execute') ])
		]);
	}
});
