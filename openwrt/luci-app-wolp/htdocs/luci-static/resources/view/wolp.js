'use strict';
'require view';
'require uci';
'require ui';
'require rpc';

return view.extend({
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

	normalizeMac: function(value) {
		if (!value)
			return null;

		var clean = String(value).trim().replace(/-/g, ':').toUpperCase();

		if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(clean))
			return null;

		return clean;
	},

	isValidIPv4: function(value) {
		var parts = String(value || '').trim().split('.'),
			i,
			part,
			num;

		if (parts.length !== 4)
			return false;

		for (i = 0; i < parts.length; i++) {
			part = parts[i];

			if (!/^\d{1,3}$/.test(part))
				return false;

			num = +part;

			if (num < 0 || num > 255)
				return false;
		}

		return true;
	},

	isValidPort: function(value) {
		if (value === null || value === undefined || value === '')
			return true;

		var port = +value;
		return String(port) === String(value).trim() && port >= 1 && port <= 65535;
	},

	trimmedValue: function(value) {
		var str = String(value || '').trim();
		return str ? str : null;
	},

	replaceRootContent: function(children) {
		var child;

		while (this.root.firstChild)
			this.root.removeChild(this.root.firstChild);

		for (var i = 0; i < children.length; i++) {
			child = children[i];

			if (child)
				this.root.appendChild(child);
		}
	},

	ensureDefaultsSection: function() {
		var sections = uci.sections('luci-wolp', 'wol');

		if (sections.length)
			return sections[0]['.name'];

		return uci.add('luci-wolp', 'wol', 'defaults');
	},

	readDefaults: function() {
		var sections = uci.sections('luci-wolp', 'wol'),
			defaults = sections.length ? sections[0] : {};

		return {
			section: defaults['.name'] || 'defaults',
			interface: String(defaults.interface || ''),
			udp_port: String(defaults.udp_port || '9'),
			extra_data: String(defaults.extra_data || 'FF:FF:FF:FF:FF:FF')
		};
	},

	buildHostIndex: function(hosts) {
		var index = {},
			keys = Object.keys(hosts || {}),
			mac,
			i;

		for (i = 0; i < keys.length; i++) {
			mac = this.normalizeMac(keys[i]);

			if (mac)
				index[mac] = hosts[keys[i]];
		}

		return index;
	},

	firstIPv4: function(host) {
		var addrs = host ? L.toArray(host.ipaddrs || host.ipv4) : [],
			i,
			addr;

		for (i = 0; i < addrs.length; i++) {
			addr = String(addrs[i] || '').trim();

			if (this.isValidIPv4(addr))
				return addr;
		}

		return null;
	},

	collectDevices: function(defaults, hosts) {
		var hostIndex = this.buildHostIndex(hosts),
			sections = uci.sections('luci-wolp', 'device'),
			devices = [],
			section,
			mac,
			hint,
			host,
			i;

		for (i = 0; i < sections.length; i++) {
			section = sections[i];
			mac = this.normalizeMac(section.mac);
			hint = mac ? hostIndex[mac] : null;
			host = this.trimmedValue(section.host) || this.firstIPv4(hint);

			devices.push({
				id: section['.name'],
				name: this.trimmedValue(section.name) || (hint && hint.name) || section['.name'],
				mac: mac || String(section.mac || ''),
				host: host,
				interface: this.trimmedValue(section.interface) || null,
				resolvedInterface: this.trimmedValue(section.interface) || this.trimmedValue(defaults.interface),
				udp_port: this.trimmedValue(section.udp_port) || this.trimmedValue(defaults.udp_port) || '9',
				extra_data: this.trimmedValue(section.extra_data) || this.trimmedValue(defaults.extra_data) || 'FF:FF:FF:FF:FF:FF',
				enabled: section.enabled !== '0',
				hintName: hint && hint.name,
				hintHost: this.firstIPv4(hint),
				status: 'unknown'
			});
		}

		devices.sort(function(a, b) {
			return String(a.name || a.mac).localeCompare(String(b.name || b.mac));
		});

		return devices;
	},

	probeDevices: function(devices) {
		var self = this,
			probes = {},
			seen = {},
			jobs = [],
			host,
			i;

		for (i = 0; i < devices.length; i++) {
			host = devices[i].host;

			if (!host || seen[host])
				continue;

			seen[host] = true;
			(function(probeHost) {
				jobs.push(L.resolveDefault(self.callWolpProbe(probeHost), {
					reachable: false,
					code: 1,
					stderr: 'probe failed'
				}).then(function(result) {
					probes[probeHost] = result;
				}));
			}(host));
		}

		return Promise.all(jobs).then(function() {
			return probes;
		});
	},

	attachStatuses: function(devices, probes) {
		var i,
			device,
			probe;

		for (i = 0; i < devices.length; i++) {
			device = devices[i];

			if (!device.host) {
				device.status = 'unknown';
				continue;
			}

			probe = probes[device.host];
			device.status = probe && probe.reachable ? 'online' : 'offline';
		}

		return devices;
	},

	fetchState: function() {
		return Promise.all([
			L.resolveDefault(this.callWolpStat(), {}),
			L.resolveDefault(this.callHostHints(), {}),
			uci.load('luci-wolp')
		]).then(L.bind(function(data) {
			var stat = data[0] || {},
				hosts = data[1] || {},
				defaults = this.readDefaults(),
				devices = this.collectDevices(defaults, hosts);

			return this.probeDevices(devices).then(L.bind(function(probes) {
				return {
					stat: stat,
					hosts: hosts,
					defaults: defaults,
					devices: this.attachStatuses(devices, probes)
				};
			}, this));
		}, this));
	},

	load: function() {
		return this.fetchState();
	},

	render: function(state) {
		this.root = E('div', { 'class': 'cbi-map' });
		this.state = state;
		this.renderPage();
		return this.root;
	},

	renderPage: function() {
		this.replaceRootContent([
			this.renderStyle(),
			this.renderHeader(),
			this.renderOverview(),
			this.renderToolbar(),
			this.renderDeviceTable(),
			this.renderManualPanel(),
			this.renderSettingsPanel()
		]);
	},

	reloadState: function(message) {
		return this.fetchState().then(L.bind(function(state) {
			this.state = state;
			this.renderPage();

			if (message) {
				ui.addNotification(null, [
					E('p', [ message ])
				]);
			}
		}, this));
	},

	renderStyle: function() {
		return E('style', [ ''
			+ '.wolp-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin:16px 0;}'
			+ '.wolp-card{background:var(--app-bg,#fff);border:1px solid var(--border-color-medium,#d9d9d9);border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04);}'
			+ '.wolp-card h3,.wolp-section h3{margin:0 0 6px 0;font-size:14px;}'
			+ '.wolp-count{font-size:28px;font-weight:700;line-height:1.1;}'
			+ '.wolp-muted{color:#666;font-size:12px;}'
			+ '.wolp-toolbar{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 18px;}'
			+ '.wolp-toolbar .cbi-button{margin:0;}'
			+ '.wolp-section{margin:18px 0 0 0;padding:18px;border:1px solid var(--border-color-medium,#d9d9d9);border-radius:12px;background:var(--app-bg,#fff);}'
			+ '.wolp-table{width:100%;border-collapse:collapse;margin-top:10px;}'
			+ '.wolp-table th,.wolp-table td{padding:10px 8px;border-bottom:1px solid var(--border-color-low,#ececec);text-align:left;vertical-align:top;}'
			+ '.wolp-table th{font-size:12px;color:#666;}'
			+ '.wolp-actions{display:flex;flex-wrap:wrap;gap:8px;}'
			+ '.wolp-actions .cbi-button{margin:0;}'
			+ '.wolp-badge{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-size:12px;font-weight:600;}'
			+ '.wolp-badge-online{background:#e8f7ee;color:#1f7a3f;}'
			+ '.wolp-badge-offline{background:#fff0f0;color:#b42318;}'
			+ '.wolp-badge-unknown{background:#f2f4f7;color:#475467;}'
			+ '.wolp-tag{display:inline-block;padding:2px 6px;border-radius:999px;background:#f5f5f5;color:#666;font-size:11px;margin-left:6px;}'
			+ '.wolp-empty{padding:24px 10px;text-align:center;color:#666;}'
			+ '.wolp-form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px 16px;margin-top:12px;}'
			+ '.wolp-field label{display:block;margin-bottom:6px;font-weight:600;}'
			+ '.wolp-field input,.wolp-field select{width:100%;}'
			+ '.wolp-inline{display:flex;align-items:center;gap:8px;}'
			+ '.wolp-footer-actions{margin-top:14px;display:flex;flex-wrap:wrap;gap:10px;}'
		]);
	},

	renderHeader: function() {
		return E('div', [
			E('h2', [ _('Wake on LAN Plus') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Manage configured wake devices, inspect their current reachability, and trigger wake or shutdown actions without leaving the page.')
			])
		]);
	},

	countByStatus: function(status) {
		var devices = this.state.devices || [],
			count = 0,
			i;

		for (i = 0; i < devices.length; i++) {
			if (devices[i].status === status)
				count++;
		}

		return count;
	},

	renderOverviewCard: function(title, value, hint) {
		return E('div', { 'class': 'wolp-card' }, [
			E('h3', [ title ]),
			E('div', { 'class': 'wolp-count' }, [ String(value) ]),
			E('div', { 'class': 'wolp-muted' }, [ hint ])
		]);
	},

	renderOverview: function() {
		return E('div', { 'class': 'wolp-grid' }, [
			this.renderOverviewCard(_('Configured Devices'), this.state.devices.length, _('Devices saved in luci-wolp device inventory')),
			this.renderOverviewCard(_('Online'), this.countByStatus('online'), _('Ping reachable with a known IPv4 address')),
			this.renderOverviewCard(_('Offline'), this.countByStatus('offline'), _('Stored IPv4 exists but ping probe failed')),
			this.renderOverviewCard(_('Unknown'), this.countByStatus('unknown'), _('No probeable IPv4 address is currently known'))
		]);
	},

	renderToolbar: function() {
		var self = this;

		return E('div', { 'class': 'wolp-toolbar' }, [
			E('button', {
				'class': 'cbi-button cbi-button-action',
				'click': function(ev) {
					ev.preventDefault();
					self.showDeviceEditor(null);
				}
			}, [ _('Add Device') ]),
			E('button', {
				'class': 'cbi-button',
				'click': function(ev) {
					ev.preventDefault();
					self.refreshStatuses();
				}
			}, [ _('Refresh Status') ]),
			E('button', {
				'class': 'cbi-button cbi-button-positive',
				'disabled': !this.state.stat.etherwake,
				'click': function(ev) {
					ev.preventDefault();
					self.handleWakeSelected();
				}
			}, [ _('Wake Selected') ])
		]);
	},

	statusBadge: function(status) {
		var label = _('Unknown'),
			className = 'wolp-badge wolp-badge-unknown';

		if (status === 'online') {
			label = _('Online');
			className = 'wolp-badge wolp-badge-online';
		}
		else if (status === 'offline') {
			label = _('Offline');
			className = 'wolp-badge wolp-badge-offline';
		}

		return E('span', { 'class': className }, [ label ]);
	},

	deviceById: function(sectionId) {
		var devices = this.state.devices || [],
			i;

		for (i = 0; i < devices.length; i++) {
			if (devices[i].id === sectionId)
				return devices[i];
		}

		return null;
	},

	renderDeviceRow: function(device) {
		var self = this,
			disableWake = !this.state.stat.etherwake || !device.enabled || !this.normalizeMac(device.mac),
			disableShutdown = !this.state.stat.netcat || !device.enabled || !device.host || !this.normalizeMac(device.mac);

		return E('tr', [
			E('td', [
				E('input', {
					'type': 'checkbox',
					'data-device-id': device.id,
					'disabled': disableWake
				})
			]),
			E('td', [
				E('div', [ device.name ]),
				device.enabled ? null : E('span', { 'class': 'wolp-tag' }, [ _('Disabled') ])
			]),
			E('td', [ device.mac || '-' ]),
			E('td', [
				E('div', [ device.host || '-' ]),
				device.host && device.hintHost && device.host === device.hintHost ? E('div', { 'class': 'wolp-muted' }, [ _('Resolved from host hints') ]) : null
			]),
			E('td', [ device.resolvedInterface || '-' ]),
			E('td', [ this.statusBadge(device.status) ]),
			E('td', [
				E('div', { 'class': 'wolp-actions' }, [
					E('button', {
						'class': 'cbi-button cbi-button-positive',
						'disabled': disableWake,
						'click': function(ev) {
							ev.preventDefault();
							self.executeWake(device);
						}
					}, [ _('Wake') ]),
					E('button', {
						'class': 'cbi-button',
						'disabled': disableShutdown,
						'click': function(ev) {
							ev.preventDefault();
							self.executeShutdown(device);
						}
					}, [ _('Shutdown') ]),
					E('button', {
						'class': 'cbi-button',
						'click': function(ev) {
							ev.preventDefault();
							self.showDeviceEditor(device.id);
						}
					}, [ _('Edit') ]),
					E('button', {
						'class': 'cbi-button cbi-button-remove',
						'click': function(ev) {
							ev.preventDefault();
							self.deleteDevice(device.id, device.name);
						}
					}, [ _('Delete') ])
				])
			])
		]);
	},

	renderDeviceTable: function() {
		var self = this,
			rows = [],
			i;

		for (i = 0; i < this.state.devices.length; i++)
			rows.push(this.renderDeviceRow(this.state.devices[i]));

		return E('div', { 'class': 'wolp-section' }, [
			E('h3', [ _('Device Inventory') ]),
			E('div', { 'class': 'wolp-muted' }, [
				_('Configured devices are persistent. Current IP and status are enriched from OpenWrt host hints and reachability probes.')
			]),
			this.state.devices.length ? E('table', { 'class': 'wolp-table' }, [
				E('thead', [
					E('tr', [
						E('th', [
							E('input', {
								'type': 'checkbox',
								'click': function(ev) {
									self.toggleAllSelections(ev.target.checked);
								}
							})
						]),
						E('th', [ _('Device') ]),
						E('th', [ _('MAC Address') ]),
						E('th', [ _('IPv4 Address') ]),
						E('th', [ _('Wake Interface') ]),
						E('th', [ _('Status') ]),
						E('th', [ _('Actions') ])
					])
				]),
				E('tbody', rows)
			]) : E('div', { 'class': 'wolp-empty' }, [
				_('No devices have been configured yet. Add a device to build a persistent wake inventory.')
			])
		]);
	},

	renderField: function(label, input, hint) {
		return E('div', { 'class': 'wolp-field' }, [
			E('label', [ label ]),
			input,
			hint ? E('div', { 'class': 'wolp-muted' }, [ hint ]) : null
		]);
	},

	renderManualPanel: function() {
		var self = this,
			deviceSelect = E('select'),
			actionSelect = E('select', [
				E('option', { 'value': 'wake' }, [ _('Wake') ]),
				E('option', { 'value': 'shutdown' }, [ _('Shutdown') ])
			]),
			macInput = E('input', { 'type': 'text', 'placeholder': 'AA:BB:CC:DD:EE:FF' }),
			hostInput = E('input', { 'type': 'text', 'placeholder': '192.168.1.50' }),
			ifaceInput = E('input', { 'type': 'text', 'placeholder': this.state.defaults.interface || 'br-lan' }),
			portInput = E('input', { 'type': 'text', 'placeholder': this.state.defaults.udp_port || '9', 'value': this.state.defaults.udp_port || '9' }),
			extraInput = E('input', { 'type': 'text', 'placeholder': 'FF:FF:FF:FF:FF:FF', 'value': this.state.defaults.extra_data || 'FF:FF:FF:FF:FF:FF' }),
			broadcastInput = E('input', { 'type': 'checkbox' }),
			option,
			i;

		deviceSelect.appendChild(E('option', { 'value': '' }, [ _('Custom Input') ]));

		for (i = 0; i < this.state.devices.length; i++) {
			option = this.state.devices[i];
			deviceSelect.appendChild(E('option', { 'value': option.id }, [
				option.name + ' (' + option.mac + ')'
			]));
		}

		deviceSelect.addEventListener('change', function() {
			var device = self.deviceById(deviceSelect.value);

			if (!device)
				return;

			macInput.value = device.mac || '';
			hostInput.value = device.host || '';
			ifaceInput.value = device.resolvedInterface || '';
			portInput.value = device.udp_port || self.state.defaults.udp_port || '9';
			extraInput.value = device.extra_data || self.state.defaults.extra_data || 'FF:FF:FF:FF:FF:FF';
		});

		return E('div', { 'class': 'wolp-section' }, [
			E('h3', [ _('Manual Operation') ]),
			E('div', { 'class': 'wolp-muted' }, [
				_('Use this panel for one-off operations or to prefill fields from a configured device.')
			]),
			E('div', { 'class': 'wolp-form-grid' }, [
				this.renderField(_('Action'), actionSelect),
				this.renderField(_('Configured Device'), deviceSelect),
				this.renderField(_('MAC Address'), macInput),
				this.renderField(_('IPv4 Address'), hostInput, _('Required for shutdown when no current host hint is available')),
				this.renderField(_('Wake Interface'), ifaceInput, _('Optional. Falls back to the default interface when present')),
				this.renderField(_('UDP Port'), portInput),
				this.renderField(_('Additional Data'), extraInput),
				this.renderField(_('Send to broadcast address'), E('div', { 'class': 'wolp-inline' }, [
					broadcastInput,
					E('span', [ _('Used only for wake requests') ])
				]))
			]),
			E('div', { 'class': 'wolp-footer-actions' }, [
				E('button', {
					'class': 'cbi-button cbi-button-apply',
					'click': function(ev) {
						ev.preventDefault();
						self.executeManualAction({
							action: actionSelect.value,
							mac: macInput.value,
							host: hostInput.value,
							interface: ifaceInput.value,
							udp_port: portInput.value,
							extra_data: extraInput.value,
							broadcast: broadcastInput.checked
						});
					}
				}, [ _('Execute') ])
			])
		]);
	},

	renderSettingsPanel: function() {
		var self = this,
			interfaceInput = E('input', { 'type': 'text', 'value': this.state.defaults.interface || '', 'placeholder': 'br-lan' }),
			portInput = E('input', { 'type': 'text', 'value': this.state.defaults.udp_port || '9', 'placeholder': '9' }),
			extraInput = E('input', { 'type': 'text', 'value': this.state.defaults.extra_data || 'FF:FF:FF:FF:FF:FF', 'placeholder': 'FF:FF:FF:FF:FF:FF' });

		return E('div', { 'class': 'wolp-section' }, [
			E('h3', [ _('Defaults') ]),
			E('div', { 'class': 'wolp-muted' }, [
				_('These values prefill new devices and manual operations. Device-level values override defaults.')
			]),
			E('div', { 'class': 'wolp-form-grid' }, [
				this.renderField(_('Default Interface'), interfaceInput),
				this.renderField(_('Default UDP Port'), portInput),
				this.renderField(_('Default Additional Data'), extraInput)
			]),
			E('div', { 'class': 'wolp-footer-actions' }, [
				E('button', {
					'class': 'cbi-button cbi-button-save',
					'click': function(ev) {
						ev.preventDefault();
						self.saveDefaults({
							interface: interfaceInput.value,
							udp_port: portInput.value,
							extra_data: extraInput.value
						});
					}
				}, [ _('Save Defaults') ])
			])
		]);
	},

	refreshStatuses: function() {
		ui.showModal(_('Refreshing device status'), [
			E('p', { 'class': 'spinning' }, [ _('Checking host reachability…') ])
		]);

		return this.reloadState().then(function() {
			ui.hideModal();
		}).catch(function(err) {
			ui.hideModal();
			ui.addNotification(null, [
				E('p', [ _('Failed to refresh device status') + ': ' + (err.message || err) ])
			]);
		});
	},

	toggleAllSelections: function(checked) {
		var boxes = this.root.querySelectorAll('input[data-device-id]'),
			i;

		for (i = 0; i < boxes.length; i++) {
			if (!boxes[i].disabled)
				boxes[i].checked = checked;
		}
	},

	selectedDevices: function() {
		var boxes = this.root.querySelectorAll('input[data-device-id]:checked'),
			devices = [],
			device,
			i;

		for (i = 0; i < boxes.length; i++) {
			device = this.deviceById(boxes[i].getAttribute('data-device-id'));

			if (device)
				devices.push(device);
		}

		return devices;
	},

	makeWakeArgs: function(target) {
		var args = [ '-D' ];

		if (this.trimmedValue(target.interface))
			args.push('-i', this.trimmedValue(target.interface));

		if (target.broadcast)
			args.push('-b');

		args.push(this.normalizeMac(target.mac));
		return args;
	},

	makeShutdownCommand: function(target) {
		var macBytes = this.normalizeMac(target.mac).replace(/:/g, '').match(/.{2}/g),
			extraBytes = this.normalizeMac(target.extra_data || 'FF:FF:FF:FF:FF:FF').replace(/:/g, '').match(/.{2}/g),
			packet = 'FFFFFFFFFFFF',
			i;

		for (i = 0; i < 16; i++)
			packet += macBytes.join('');

		packet += extraBytes.join('');

		return '(printf "' + packet.match(/.{2}/g).map(function(b) {
			return '\\x' + b;
		}).join('') + '" | /usr/bin/netcat -u -w1 ' + target.host + ' ' + target.udp_port + ') >/dev/null 2>&1 &';
	},

	executeWake: function(device) {
		var mac = this.normalizeMac(device.mac),
			iface = this.trimmedValue(device.interface) || this.trimmedValue(device.resolvedInterface);

		if (!this.state.stat.etherwake)
			return alert(_('etherwake is not installed!'));
		if (!mac)
			return alert(_('The selected device does not have a valid MAC address.'));

		ui.showModal(_('Waking host'), [
			E('p', { 'class': 'spinning' }, [ _('Starting WoL utility…') ])
		]);

		return this.callWolpExec('/usr/bin/etherwake', this.makeWakeArgs({
			mac: mac,
			interface: iface,
			broadcast: !!device.broadcast
		})).then(this.parseExecResult).then(function(res) {
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
				E('p', [ _('Waking host failed') + ': ' + (err.message || err) ])
			]);
		});
	},

	executeShutdown: function(device) {
		var mac = this.normalizeMac(device.mac),
			host = this.trimmedValue(device.host);

		if (!this.state.stat.netcat)
			return alert(_('netcat is not installed!'));
		if (!mac)
			return alert(_('The selected device does not have a valid MAC address.'));
		if (!host || !this.isValidIPv4(host))
			return alert(_('No IPv4 address available for shutdown target. Ensure the host is online or has a host hint entry.'));

		ui.showModal(_('Shutting down host'), [
			E('p', { 'class': 'spinning' }, [ _('Sending shutdown command…') ])
		]);

		return this.callWolpExec('/bin/sh', [ '-c', this.makeShutdownCommand({
			host: host,
			mac: mac,
			udp_port: device.udp_port || '9',
			extra_data: device.extra_data || 'FF:FF:FF:FF:FF:FF'
		}) ]).then(this.parseExecResult).then(function(res) {
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
				E('p', [ _('Shutting down host failed') + ': ' + (err.message || err) ])
			]);
		});
	},

	executeManualAction: function(target) {
		var action = target.action || 'wake',
			mac = this.normalizeMac(target.mac),
			host = this.trimmedValue(target.host),
			port = this.trimmedValue(target.udp_port),
			extra = this.normalizeMac(target.extra_data || 'FF:FF:FF:FF:FF:FF');

		if (!mac)
			return alert(_('Enter a valid MAC address.'));
		if (!this.isValidPort(port || '9'))
			return alert(_('Enter a valid UDP port.'));
		if (!extra)
			return alert(_('Enter valid additional data in MAC format.'));

		if (action === 'shutdown') {
			if (!host || !this.isValidIPv4(host))
				return alert(_('No IPv4 address available for shutdown target. Ensure the host is online or has a host hint entry.'));

			return this.executeShutdown({
				mac: mac,
				host: host,
				udp_port: port || '9',
				extra_data: extra
			});
		}

		return this.executeWake({
			mac: mac,
			resolvedInterface: this.trimmedValue(target.interface),
			interface: this.trimmedValue(target.interface),
			broadcast: !!target.broadcast
		});
	},

	handleWakeSelected: function() {
		var self = this,
			devices = this.selectedDevices(),
			results = [],
			sequence = Promise.resolve(),
			i;

		if (!devices.length)
			return alert(_('Select at least one enabled device to wake.'));
		if (!this.state.stat.etherwake)
			return alert(_('etherwake is not installed!'));

		ui.showModal(_('Waking selected devices'), [
			E('p', { 'class': 'spinning' }, [ _('Starting WoL utility…') ])
		]);

		for (i = 0; i < devices.length; i++) {
			(function(device) {
				sequence = sequence.then(function() {
					return self.callWolpExec('/usr/bin/etherwake', self.makeWakeArgs({
						mac: device.mac,
						interface: device.resolvedInterface
					})).then(function(res) {
						results.push({
							name: device.name,
							ok: !res.code,
							message: !res.code
								? (res.stdout || _('Command executed successfully'))
								: (res.stderr || res.stdout || ('exit code ' + (res.code || 1)))
						});
					}).catch(function(err) {
						results.push({ name: device.name, ok: false, message: err.message || err });
					});
				});
			}(devices[i]));
		}

		return sequence.then(function() {
			ui.showModal(_('Waking selected devices'), [
				E('div', results.map(function(result) {
					return E('p', [
						(result.ok ? '[' + _('Success') + '] ' : '[' + _('Failed') + '] ') + result.name + ': ' + result.message
					]);
				})),
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
				E('p', [ _('Waking host failed') + ': ' + (err.message || err) ])
			]);
		});
	},

	showDeviceEditor: function(sectionId) {
		var self = this,
			device = sectionId ? this.deviceById(sectionId) : null,
			nameInput = E('input', { 'type': 'text', 'value': device ? device.name : '' }),
			macInput = E('input', { 'type': 'text', 'value': device ? device.mac : '', 'placeholder': 'AA:BB:CC:DD:EE:FF' }),
			hostInput = E('input', { 'type': 'text', 'value': device && device.host ? device.host : '', 'placeholder': '192.168.1.50' }),
			ifaceInput = E('input', { 'type': 'text', 'value': device && device.interface ? device.interface : '', 'placeholder': this.state.defaults.interface || 'br-lan' }),
			portInput = E('input', { 'type': 'text', 'value': device ? device.udp_port : (this.state.defaults.udp_port || '9'), 'placeholder': '9' }),
			extraInput = E('input', { 'type': 'text', 'value': device ? device.extra_data : (this.state.defaults.extra_data || 'FF:FF:FF:FF:FF:FF'), 'placeholder': 'FF:FF:FF:FF:FF:FF' }),
			enabledInput = E('input', { 'type': 'checkbox', 'checked': device ? device.enabled : true });

		ui.showModal(sectionId ? _('Edit Device') : _('Add Device'), [
			E('div', { 'class': 'wolp-form-grid' }, [
				this.renderField(_('Device Name'), nameInput),
				this.renderField(_('MAC Address'), macInput),
				this.renderField(_('IPv4 Address'), hostInput, _('Optional. Used for shutdown and reachability checks')),
				this.renderField(_('Wake Interface'), ifaceInput),
				this.renderField(_('UDP Port'), portInput),
				this.renderField(_('Additional Data'), extraInput),
				this.renderField(_('Enabled'), E('div', { 'class': 'wolp-inline' }, [
					enabledInput,
					E('span', [ _('Include this device in dashboard actions') ])
				]))
			]),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn cbi-button',
					'click': ui.hideModal
				}, [ _('Cancel') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-save',
					'click': function() {
						self.saveDevice(sectionId, {
							name: nameInput.value,
							mac: macInput.value,
							host: hostInput.value,
							interface: ifaceInput.value,
							udp_port: portInput.value,
							extra_data: extraInput.value,
							enabled: enabledInput.checked
						});
					}
				}, [ _('Save') ])
			])
		]);
	},

	saveDevice: function(sectionId, values) {
		var name = this.trimmedValue(values.name),
			mac = this.normalizeMac(values.mac),
			host = this.trimmedValue(values.host),
			iface = this.trimmedValue(values.interface),
			port = this.trimmedValue(values.udp_port),
			extra = this.normalizeMac(values.extra_data || 'FF:FF:FF:FF:FF:FF'),
			target = sectionId || uci.add('luci-wolp', 'device');

		if (!name)
			return alert(_('Enter a device name.'));
		if (!mac)
			return alert(_('Enter a valid MAC address.'));
		if (host && !this.isValidIPv4(host))
			return alert(_('Enter a valid IPv4 address.'));
		if (!this.isValidPort(port || '9'))
			return alert(_('Enter a valid UDP port.'));
		if (!extra)
			return alert(_('Enter valid additional data in MAC format.'));

		uci.set('luci-wolp', target, 'name', name);
		uci.set('luci-wolp', target, 'mac', mac);

		if (host)
			uci.set('luci-wolp', target, 'host', host);
		else
			uci.unset('luci-wolp', target, 'host');

		if (iface)
			uci.set('luci-wolp', target, 'interface', iface);
		else
			uci.unset('luci-wolp', target, 'interface');

		uci.set('luci-wolp', target, 'udp_port', port || '9');
		uci.set('luci-wolp', target, 'extra_data', extra);
		uci.set('luci-wolp', target, 'enabled', values.enabled ? '1' : '0');

		return uci.save().then(L.bind(function() {
			ui.hideModal();
			uci.unload('luci-wolp');
			return this.reloadState(_('Device saved successfully.'));
		}, this)).catch(function(err) {
			ui.addNotification(null, [
				E('p', [ _('Failed to save device') + ': ' + (err.message || err) ])
			]);
		});
	},

	saveDefaults: function(values) {
		var target = this.ensureDefaultsSection(),
			iface = this.trimmedValue(values.interface),
			port = this.trimmedValue(values.udp_port),
			extra = this.normalizeMac(values.extra_data || 'FF:FF:FF:FF:FF:FF');

		if (!this.isValidPort(port || '9'))
			return alert(_('Enter a valid UDP port.'));
		if (!extra)
			return alert(_('Enter valid additional data in MAC format.'));

		if (iface)
			uci.set('luci-wolp', target, 'interface', iface);
		else
			uci.unset('luci-wolp', target, 'interface');

		uci.set('luci-wolp', target, 'udp_port', port || '9');
		uci.set('luci-wolp', target, 'extra_data', extra);

		return uci.save().then(L.bind(function() {
			uci.unload('luci-wolp');
			return this.reloadState(_('Defaults saved successfully.'));
		}, this)).catch(function(err) {
			ui.addNotification(null, [
				E('p', [ _('Failed to save defaults') + ': ' + (err.message || err) ])
			]);
		});
	},

	deleteDevice: function(sectionId, name) {
		if (!confirm(_('Delete device') + ': ' + name + '?'))
			return;

		uci.remove('luci-wolp', sectionId);

		return uci.save().then(L.bind(function() {
			uci.unload('luci-wolp');
			return this.reloadState(_('Device deleted successfully.'));
		}, this)).catch(function(err) {
			ui.addNotification(null, [
				E('p', [ _('Failed to delete device') + ': ' + (err.message || err) ])
			]);
		});
	}
});
