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

	callWolpExec: rpc.declare({
		object: 'luci.wolp',
		method: 'exec',
		params: [ 'name', 'args' ],
		expect: { '': {} }
	}),

	callWolpProbe: rpc.declare({
		object: 'luci.wolp',
		method: 'probe',
		params: [ 'host' ],
		expect: { '': {} }
	}),

	parseExecResult: function(res) {
		if (res && !res.code)
			return res;

		throw new Error((res && (res.stderr || res.stdout)) || ('exit code ' + ((res && res.code) || 1)));
	},

	resolveShutdownAddress: function(mac) {
		var host = this.hosts && this.hosts[mac],
			addrs = host ? L.toArray(host.ipaddrs || host.ipv4) : [],
			addr;

		for (var i = 0; i < addrs.length; i++) {
			addr = addrs[i];

			if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(addr))
				return addr;
		}

		return null;
	},

	load: function() {
		return Promise.all([
			L.resolveDefault(this.callWolpStat(), {}),
			this.callHostHints(),
			uci.load('luci-wolp')
		]);
	},

	render: function(data) {
		var stat = data[0] || {},
			has_ewk = !!stat.etherwake,
			has_nc = !!stat.netcat,
			hosts = data[1],
			m, s, o;

		this.formdata.has_ewk = has_ewk;
		this.formdata.has_nc = has_nc;
		this.hosts = hosts;

		m = new form.JSONMap(this.formdata, _('Wake on LAN Plus'),
			_('Wake on LAN Plus is a mechanism to boot and shutdown computers remotely in the local network.'));

		s = m.section(form.NamedSection, 'wol');

		// 操作类型选择
		o = s.option(form.ListValue, 'action', _('Action'),
			_('Choose whether to wake up or shutdown the host'));
		o.value('wake', _('Wake up'));
		o.value('shutdown', _('Shutdown'));
		o.default = 'wake';

		// 网络接口
		if (has_ewk) {
			o = s.option(widgets.DeviceSelect, 'iface', _('Network interface to use'),
				_('Specifies the interface the WoL packet is sent on'));

			o.default = uci.get('luci-wolp', 'defaults', 'interface');
			o.rmempty = false;
			o.noaliases = true;
			o.noinactive = true;
		}

		// 主机选择
		o = s.option(form.Value, 'mac', _('Host to wake up or shutdown'),
			_('Choose the host to control or enter a custom MAC address to use'));

		o.rmempty = false;

		L.sortedKeys(hosts).forEach(function(mac) {
			o.value(mac, E([], [ mac, ' (', E('strong', [
				hosts[mac].name ||
				L.toArray(hosts[mac].ipaddrs || hosts[mac].ipv4)[0] ||
				L.toArray(hosts[mac].ip6addrs || hosts[mac].ipv6)[0] ||
				'?'
			]), ')' ]));
		});

		// 附加数据（仅关机时显示）
		o = s.option(form.Value, 'extra_data', _('Additional Data'),
			_('Enter 6-byte custom data (XX:XX:XX:XX:XX:XX).<br />If not specified for shutdown, defaults to FF:FF:FF:FF:FF:FF.'));
		o.placeholder = 'AA:BB:CC:DD:EE:FF';
		o.default = 'FF:FF:FF:FF:FF:FF';
		o.datatype = 'macaddr';
		o.rmempty = true;
		o.depends('action', 'shutdown');

		// 广播标志（始终显示）
		if (has_ewk) {
			o = s.option(form.Flag, 'broadcast', _('Send to broadcast address'));
		}

		// UDP 端口（用于关机）
		if (has_nc) {
			o = s.option(form.Value, 'udp_port', _('UDP Port for Shutdown'),
				_('UDP port to send shutdown command (default: 9)'));
			o.placeholder = '9';
			o.datatype = 'port';
			o.default = '9';
			o.rmempty = true;
			o.depends('action', 'shutdown');
		}

		return m.render();
	},

	handleWakeup: function(ev) {
		var map = document.querySelector('#maincontent .cbi-map'),
			data = this.formdata;

		return dom.callClassMethod(map, 'save').then(L.bind(function() {
			if (!data.wol.mac)
				return alert(_('No target host specified!'));

			var action = data.wol.action || 'wake';

			if (action === 'wake') {
				// 唤醒操作：使用 etherwake
				if (!data.has_ewk) {
					return alert(_('etherwake is not installed!'));
				}

				var args = ['-D'];

				if (data.wol.iface)
					args.push('-i', data.wol.iface);

				if (data.wol.broadcast == '1')
					args.push('-b');

				args.push(data.wol.mac);

				ui.showModal(_('Waking host'), [
					E('p', { 'class': 'spinning' }, [ _('Starting WoL utility…') ])
				]);

				return this.callWolpExec('/usr/bin/etherwake', args).then(this.parseExecResult).then(function(res) {
					ui.showModal(_('Waking host'), [
						res.stdout ? E('pre', [ res.stdout ]) : E('p', [ _('Command executed successfully') ]),
						res.stderr ? E('pre', { 'style': 'color: red' }, [ res.stderr ]) : '',
						E('div', { 'class': 'right' }, [
							E('button', {
								'class': 'cbi-button cbi-button-primary',
								'click': ui.hideModal
							}, [ _('Dismiss') ])
						])
					]);
				}).catch(function(err) {
					ui.hideModal();
					ui.addNotification(null, [
						E('p', [ _('Waking host failed') + ': ', err.message || err ])
					]);
				});

			} else {
				// 关机操作：使用 netcat
				if (!data.has_nc) {
					return alert(_('netcat is not installed!'));
				}

				var udpPort = data.wol.udp_port || '9';
				var extraData = data.wol.extra_data;

				if (!extraData) {
					extraData = 'FF:FF:FF:FF:FF:FF';
					data.wol.extra_data = extraData;
				}
				var shutdownAddr = this.resolveShutdownAddress(data.wol.mac);

				if (!shutdownAddr) {
					return alert(_('No IPv4 address available for shutdown target. Ensure the host is online or has a host hint entry.'));
				}

				// 构造 WOL 数据包
				var macBytes = data.wol.mac.replace(/:/g, '').match(/.{2}/g);
				var extraBytes = extraData.replace(/:/g, '').match(/.{2}/g);

				var packet = 'FFFFFFFFFFFF';
				for (var i = 0; i < 16; i++) {
					packet += macBytes.join('');
				}
				packet += extraBytes.join('');

				var hexBytes = packet.match(/.{2}/g);

				var cmd = '(printf "' + hexBytes.map(function(b) { return '\\x' + b; }).join('') + '" | /usr/bin/netcat -u -w1 ' + shutdownAddr + ' ' + udpPort + ') >/dev/null 2>&1 &';

				ui.showModal(_('Shutting down host'), [
					E('p', { 'class': 'spinning' }, [ _('Sending shutdown command…') ])
				]);

				return this.callWolpExec('/bin/sh', [ '-c', cmd ]).then(this.parseExecResult).then(function(res) {
					ui.showModal(_('Shutting down host'), [
						E('p', [ _('Shutdown request sent') ]),
						res.stdout ? E('pre', [ res.stdout ]) : '',
						res.stderr ? E('pre', { 'style': 'color: red' }, [ res.stderr ]) : '',
						E('div', { 'class': 'right' }, [
							E('button', {
								'class': 'cbi-button cbi-button-primary',
								'click': ui.hideModal
							}, [ _('Dismiss') ])
						])
					]);
				}).catch(function(err) {
					ui.hideModal();
					ui.addNotification(null, [
						E('p', [ _('Shutting down host failed') + ': ', err.message || err ])
					]);
				});
			}
		}, this));
	},

	addFooter: function() {
		return E('div', { 'class': 'cbi-page-actions' },
			[
				E('button', {
					'class': 'cbi-button cbi-button-save',
					'click': L.ui.createHandlerFn(this, 'handleWakeup')
				}, [ _('Execute') ])
			]
		);
	}
});
