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

	callHostHints: rpc.declare({
		object: 'luci-rpc',
		method: 'getHostHints',
		expect: { '': {} }
	}),

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

	callWolpControl: rpc.declare({
		object: 'luci.wolp',
		method: 'control',
		params: [ 'action', 'host', 'port', 'mac', 'secret' ],
		expect: { '': {} }
	}),

	parseExecResult: function(res) {
		if (res && !res.code)
			return res;

		throw new Error((res && (res.stderr || res.stdout)) || ('exit code ' + ((res && res.code) || 1)));
	},

	parseControlResult: function(res) {
		this.parseExecResult(res);

		try {
			return JSON.parse(res.stdout || '{}');
		}
		catch (err) {
			throw new Error(_('Invalid response from WOLP control helper'));
		}
	},

	normalizeMac: function(value) {
		var clean = String(value || '').trim().replace(/-/g, ':').toUpperCase();
		return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(clean) ? clean : null;
	},

	resolveShutdownAddress: function(mac) {
		var keys = Object.keys(this.hosts || {}),
			normalized = this.normalizeMac(mac),
			host,
			addrs,
			addr,
			i,
			j;

		for (i = 0; i < keys.length; i++) {
			if (this.normalizeMac(keys[i]) !== normalized)
				continue;

			host = this.hosts[keys[i]];
			addrs = L.toArray(host.ipaddrs || host.ipv4);
			for (j = 0; j < addrs.length; j++) {
				addr = String(addrs[j] || '').trim();
				if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(addr))
					return addr;
			}
		}

		return null;
	},

	controlTarget: function(data) {
		var mac = this.normalizeMac(data.wol.mac),
			host = String(data.wol.host || '').trim() || this.resolveShutdownAddress(mac),
			port = String(data.wol.control_port || '').trim(),
			secret = String(data.wol.control_secret || '').trim();

		if (!mac)
			throw new Error(_('A valid target MAC address is required'));
		if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))
			throw new Error(_('No IPv4 address is available for the control target'));
		if (!/^\d{4,5}$/.test(port) || +port < 1024 || +port > 65535)
			throw new Error(_('Control UDP port must be between 1024 and 65535'));
		if (!/^[0-9A-Fa-f]{64}$/.test(secret))
			throw new Error(_('Control secret must be a 64-character hexadecimal value'));

		return {
			mac: mac,
			host: host,
			port: port,
			secret: secret
		};
	},

	requestControl: function(action, target) {
		return this.callWolpControl(action, target.host, target.port, target.mac, target.secret)
			.then(L.bind(this.parseControlResult, this));
	},

	saveControlDefaults: function(target) {
		uci.set('luci-wolp', 'defaults', 'control_port', target.port);
		uci.set('luci-wolp', 'defaults', 'control_secret', target.secret);
		return uci.save();
	},

	load: function() {
		return Promise.all([
			L.resolveDefault(this.callWolpStat(), {}),
			L.resolveDefault(this.callHostHints(), {}),
			uci.load('luci-wolp')
		]);
	},

	render: function(data) {
		var stat = data[0] || {},
			hosts = data[1] || {},
			m,
			s,
			o;

		this.formdata.has_ewk = !!stat.etherwake;
		this.formdata.has_control = !!stat.control;
		this.hosts = hosts;

		m = new form.JSONMap(this.formdata, _('Wake on LAN Plus'),
			_('Use standard Wake-on-LAN for wake requests. Shutdown is sent only after an authenticated Client status acknowledgement.'));
		s = m.section(form.NamedSection, 'wol');

		o = s.option(form.ListValue, 'action', _('Action'));
		o.value('wake', _('Wake up'));
		o.value('shutdown', _('Shutdown'));
		o.default = 'wake';

		if (this.formdata.has_ewk) {
			o = s.option(widgets.DeviceSelect, 'iface', _('Network interface to use'));
			o.default = uci.get('luci-wolp', 'defaults', 'interface') || 'br-lan';
			o.rmempty = false;
			o.noaliases = true;
			o.noinactive = true;

			o = s.option(form.Flag, 'broadcast', _('Send wake request to broadcast address'));
		}

		o = s.option(form.Value, 'mac', _('Target MAC address'));
		o.rmempty = false;
		o.datatype = 'macaddr';
		L.sortedKeys(hosts).forEach(function(mac) {
			o.value(mac, E([], [ mac, ' (', E('strong', [
				hosts[mac].name || L.toArray(hosts[mac].ipaddrs || hosts[mac].ipv4)[0] || '?'
			]), ')' ]));
		});

		o = s.option(form.Value, 'host', _('Client IPv4 address'));
		o.placeholder = _('Resolved automatically from OpenWrt host hints when left empty');
		o.datatype = 'ip4addr';
		o.rmempty = true;
		o.depends('action', 'shutdown');

		o = s.option(form.Value, 'control_port', _('Control UDP port'));
		o.default = uci.get('luci-wolp', 'defaults', 'control_port') || '20250';
		o.placeholder = '20250';
		o.datatype = 'port';
		o.rmempty = false;
		o.depends('action', 'shutdown');

		o = s.option(form.Value, 'control_secret', _('Control secret'));
		o.default = uci.get('luci-wolp', 'defaults', 'control_secret') || '';
		o.placeholder = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
		o.rmempty = false;
		o.password = true;
		o.depends('action', 'shutdown');

		return m.render();
	},

	handleAction: function() {
		var map = document.querySelector('#maincontent .cbi-map'),
			data = this.formdata,
			self = this;

		return dom.callClassMethod(map, 'save').then(function() {
			var action = data.wol.action || 'wake';

			if (action === 'wake') {
				var mac = self.normalizeMac(data.wol.mac),
					iface = String(data.wol.iface || '').trim();

				if (!data.has_ewk)
					throw new Error(_('etherwake is not installed'));
				if (!mac || !iface)
					throw new Error(_('A target MAC address and network interface are required'));

				ui.showModal(_('Waking host'), [ E('p', { 'class': 'spinning' }, [ _('Sending standard Wake-on-LAN packet…') ]) ]);
				return self.callWolpWake(mac, iface, data.wol.broadcast === '1').then(self.parseExecResult).then(function() {
					ui.showModal(_('Wake request sent'), [
						E('p', [ _('The packet was transmitted. The device state will remain unconfirmed until its Client responds.') ]),
						E('div', { 'class': 'right' }, [ E('button', { 'class': 'cbi-button cbi-button-primary', 'click': ui.hideModal }, [ _('Dismiss') ]) ])
					]);
				});
			}

			if (!data.has_control)
				throw new Error(_('The WOLP control helper or its dependencies are not installed'));

			var target = self.controlTarget(data);
			ui.showModal(_('Checking Client status'), [ E('p', { 'class': 'spinning' }, [ _('Waiting for an authenticated Client acknowledgement…') ]) ]);

			return self.saveControlDefaults(target).then(function() {
				return self.requestControl('status', target);
			}).then(function(status) {
				if (!status.ack || status.state !== 'RUNNING')
					throw new Error(_('The Client did not confirm that it is running') + ': ' + (status.error || _('no acknowledgement')));

				ui.showModal(_('Scheduling shutdown'), [ E('p', { 'class': 'spinning' }, [ _('Client is running. Sending authenticated shutdown request…') ]) ]);
				return self.requestControl('shutdown', target);
			}).then(function(result) {
				if (!result.ack || (result.state !== 'SCHEDULED' && result.state !== 'ALREADY_SCHEDULED'))
					throw new Error(_('The Client did not accept the shutdown request') + ': ' + (result.error || _('no acknowledgement')));

				ui.showModal(_('Shutdown acknowledged'), [
					E('p', [ result.state === 'SCHEDULED' ? _('The Client scheduled shutdown in ') + result.delay + _(' seconds.') : _('The Client already has a shutdown scheduled.') ]),
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
