'use strict';
'require view';
'require dom';
'require uci';
'require fs';
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

	load: function() {
		return Promise.all([
			L.resolveDefault(fs.stat('/usr/bin/etherwake')),
			L.resolveDefault(fs.stat('/usr/bin/nc')),
			this.callHostHints(),
			uci.load('luci-wolp')
		]);
	},

	render: function(data) {
		var has_ewk = data[0],
			has_nc = data[1],
			hosts = data[2],
			m, s, o;

		this.formdata.has_ewk = has_ewk;
		this.formdata.has_nc = has_nc;

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

		// 附加数据（用于关机验证）
		o = s.option(form.Value, 'extra_data', _('Additional Data'),
			_('Enter 6-byte custom data (XX:XX:XX:XX:XX:XX). Required for shutdown operation.'));
		o.placeholder = 'AA:BB:CC:DD:EE:FF';
		o.datatype = 'macaddr';
		o.rmempty = true;
		o.depends('action', 'shutdown');

		// 广播标志
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

	// 构造 WOL Magic Packet (102 字节)
	// 格式: 6字节0xFF + 16次重复MAC地址 + 6字节附加数据
	buildWOLPacket: function(mac, extraData) {
		var macBytes = mac.replace(/:/g, '').match(/.{2}/g);
		var extraBytes = extraData ? extraData.replace(/:/g, '').match(/.{2}/g) : ['00','00','00','00','00','00'];

		// 确保附加数据是6字节
		while (extraBytes.length < 6) {
			extraBytes.push('00');
		}
		extraBytes = extraBytes.slice(0, 6);

		// 构造数据包: FF*6 + MAC*16 + Extra*6
		var packet = 'FFFFFFFFFFFF';
		for (var i = 0; i < 16; i++) {
			packet += macBytes.join('');
		}
		packet += extraBytes.join('');

		return packet;
	},

	handleWakeup: function(ev) {
		var map = document.querySelector('#maincontent .cbi-map'),
			data = this.formdata;

		return dom.callClassMethod(map, 'save').then(L.bind(function() {
			if (!data.wol.mac)
				return alert(_('No target host specified!'));

			var action = data.wol.action || 'wake';

			if (action === 'wake') {
				// 唤醒操作：使用 etherwake 发送原始套接字
				if (!data.has_ewk) {
					return alert(_('etherwake is not installed!'));
				}

				var bin = '/usr/bin/etherwake';
				var args = ['-D', '-i', data.wol.iface];

				if (data.wol.broadcast == '1')
					args.push('-b');

				// 如果有附加数据，添加到 WOL 包中
				if (data.wol.extra_data) {
					args.push('-p', data.wol.extra_data);
				}

				args.push(data.wol.mac);

				ui.showModal(_('Waking host'), [
					E('p', { 'class': 'spinning' }, [ _('Starting WoL utility…') ])
				]);

				return fs.exec(bin, args).then(function(res) {
					ui.showModal(_('Waking host'), [
						res.stdout ? E('p', [ res.stdout ]) : '',
						res.stderr ? E('pre', [ res.stderr ]) : '',
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
						E('p', [ _('Waking host failed') + ': ', err ])
					]);
				});

			} else {
				// 关机操作：使用 netcat 发送 UDP 数据包
				if (!data.has_nc) {
					return alert(_('netcat is not installed!'));
				}

				// 关机操作必须有附加数据
				if (!data.wol.extra_data) {
					return alert(_('Additional data is required for shutdown operation!'));
				}

				var udpPort = data.wol.udp_port || '9';
				var packet = this.buildWOLPacket(data.wol.mac, data.wol.extra_data);

				// 使用 printf 生成二进制数据并通过 netcat 发送
				var cmd = 'printf "' + packet.match(/.{2}/g).map(function(b) {
					return '\\x' + b;
				}).join('') + '" | nc -u -w1 -b 255.255.255.255 ' + udpPort;

				ui.showModal(_('Shutting down host'), [
					E('p', { 'class': 'spinning' }, [ _('Sending shutdown command…') ])
				]);

				return fs.exec('/bin/sh', ['-c', cmd]).then(function(res) {
					ui.showModal(_('Shutting down host'), [
						E('p', [ _('Shutdown command sent successfully') ]),
						res.stdout ? E('pre', [ res.stdout ]) : '',
						res.stderr ? E('pre', [ res.stderr ]) : '',
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
						E('p', [ _('Shutting down host failed') + ': ', err ])
					]);
				});
			}
		}, this));
	},

	addFooter: function() {
		var action = this.formdata.wol.action || 'wake';
		var btnText = action === 'wake' ? _('Wake up host') : _('Shutdown host');
		var btnClass = action === 'wake' ? 'cbi-button-save' : 'cbi-button-reset';

		return E('div', { 'class': 'cbi-page-actions' },
			[
				E('button', {
					'class': 'cbi-button ' + btnClass,
					'click': L.ui.createHandlerFn(this, 'handleWakeup')
				}, [ btnText ])
			]
		);
	}
});
