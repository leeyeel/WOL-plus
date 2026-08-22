# Wake On LAN Plus

Wake On LAN Plus uses raw Ethernet Wake-on-LAN Magic Packets for both wake and shutdown.

Shutdown is a Magic Packet for the target MAC followed by a configured six-byte discriminator. The Client captures matching `0x0842` Ethernet frames and starts its shutdown timer.

## Important Limitation

A shutdown frame is also a standard Magic Packet. A device that is already powered off can be awakened by that frame before its operating system can process the shutdown discriminator. Use this transport only on the target LAN segment and accept that limitation.

## Components

- **Client**: runs on the target Windows or Linux machine, captures matching Ethernet frames, and optionally provides a Web UI for configuration and cancelling the shutdown timer.
- **OpenWrt**: provides a LuCI sender using `etherwake` for both actions.
- **Agent skill**: sends raw Ethernet frames from a Linux agent host with `CAP_NET_RAW` or `root` permission.

All senders and the Client must be on the same Layer-2 network. Routing, relays, and target IPv4 addresses are not part of the protocol.

## Protocol

- Wake: `FF` repeated six times, followed by the target MAC repeated 16 times.
- Shutdown: the same 102-byte Magic Packet, followed by the Client's six-byte `extra_data` value.
- Ethernet type: `0x0842`.

The Client defaults `extra_data` to `FF:FF:FF:FF:FF:FF`. A standard 102-byte wake frame does not trigger Client shutdown because it has no trailing discriminator.

## Client

The Client needs packet-capture support:

- Linux: `libpcap` runtime library and permission to capture on the selected interface. The packaged systemd service runs as root.
- Windows: install [Npcap](https://npcap.com/) before starting the Client.

With Web UI installed, open `http://<client-ip>:2025`. The initial credentials are `admin` / `admin123`.

The key settings are:

- `mac_address`: target NIC MAC address.
- `interface`: libpcap capture-device name.
- `extra_data`: six-byte shutdown control key, displayed and stored as `XX:XX:XX:XX:XX:XX`.
- `shutdown_delay`: delay before the local shutdown command runs.

The default Linux configuration is `/usr/local/etc/wolp/wolp.json`. Existing configuration files are automatically rewritten to remove retired transport settings on next startup.

For a capture-only service without the Web UI:

```bash
/usr/local/bin/wolp --backend-only
```

## OpenWrt

Install the IPK packages from [Releases](https://github.com/leeyeel/WOL-plus/releases), then open `Services -> Wake on LAN Plus`.

For wake, select the LAN interface and target MAC. For shutdown, enter the same six-byte discriminator configured in the Client. `etherwake` sends both actions as raw Ethernet frames.

Build local IPKs with:

```bash
cd openwrt
VERSION=1.0.2 ./build-ipk.sh
```

## Agent Skill

The bundled skill is in `skill/wolp`. It runs on Linux and requires `CAP_NET_RAW` or `root` for real sends.

```bash
python3 skill/wolp/scripts/wolp_power.py wake --list-interfaces
python3 skill/wolp/scripts/wolp_power.py wake --auto-interface --mac AA:BB:CC:DD:EE:FF --dry-run
python3 skill/wolp/scripts/wolp_power.py shutdown --interface eth0 --mac AA:BB:CC:DD:EE:FF --extra-data 12:34:56:78:9A:BC --dry-run
```

The skill keeps device records outside its installation directory, under `WOLP_DEVICE_FILE`, `XDG_CONFIG_HOME/wolp/devices.json`, or `~/.config/wolp/devices.json`.

## Packages

- Windows: `installer_windows_amd64_v<version>.exe`
- Debian/Ubuntu: `wolp-client-<variant>_<version>_<arch>.deb`
- RPM Linux: `wolp-client-<variant>-<version>-1.<arch>.rpm`
- OpenWrt: `luci-app-wolp_<version>_<arch>.ipk`

Build Linux packages with `scripts/build-deb.sh` or `scripts/build-rpm.sh`. Building the Client requires libpcap development headers; cross-building arm64 requires an `aarch64-linux-gnu` C compiler and arm64 libpcap development headers.

## License

[MIT License](LICENSE)
