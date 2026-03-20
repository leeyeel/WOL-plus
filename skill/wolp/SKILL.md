---
name: wolp
description: Wake or shut down LAN devices by sending WOL-plus packets from the agent host. Use this when the user wants to power on a device with a raw Ethernet magic packet, or power off a device with a UDP magic packet, and they can provide the target MAC address plus the network interface or target IPv4 address.
---

# wolp

Use this skill when the user wants the agent to control a device on the local network.

Supported operations:

- `wake`: send a standard UDP Wake-on-LAN magic packet with Python
- `shutdown`: send a UDP magic packet to a target IPv4 address
- `list`: print the resolved device inventory

Use the bundled Python script:

- `scripts/wolp_power.py`
- `assets/devices.json`

Required inputs:

- Wake:
  - target MAC address
  - optional broadcast IPv4 address, default `255.255.255.255`
  - optional UDP port, default `9`
- Shutdown:
  - target MAC address
  - target IPv4 address
  - optional `extra_data`, default `FF:FF:FF:FF:FF:FF`
  - optional UDP port, default `9`

Constraints:

- `shutdown` uses a normal UDP socket and does not require `root`.
- `wake` uses the Python package `wakeonlan` and does not require a compiled helper.
- Install the dependency before sending wake packets:

```bash
python3 -m pip install wakeonlan
```

- The `wake` subcommand will print a clear error if `wakeonlan` is missing.
- `shutdown` requires IP connectivity to the target host and a compatible WOL-plus listener on the target machine.
- Packet send confirms only local transmission, not that the remote machine actually changed power state.

Device inventory:

- Store reusable devices in `skill/wolp/assets/devices.json`.
- Successful non-dry-run `wake` and `shutdown` commands automatically write the resolved device info back to `assets/devices.json`.
- If `--device <name>` is provided, that entry is updated in place; otherwise the script reuses an existing entry with the same MAC or creates a new `device-<mac>` entry.
- Repeated operations on the same device keep refreshing that device's stored fields and the latest success metadata.
- The file format is:

```json
{
  "defaults": {
    "broadcast_ip": "255.255.255.255",
    "port": 9,
    "extra_data": "FF:FF:FF:FF:FF:FF"
  },
  "devices": {
    "nas": {
      "mac": "AA:BB:CC:DD:EE:FF",
      "host": "192.168.1.50",
      "broadcast_ip": "192.168.1.255"
    },
    "desktop": {
      "mac": "11:22:33:44:55:66",
      "host": "192.168.1.60",
      "extra_data": "12:34:56:78:9A:BC",
      "last_action": "shutdown",
      "last_success_at": "2026-03-21T00:00:00Z",
      "port": 9
    }
  }
}
```

- Use `list` before sending if you need to inspect or verify stored devices.
- CLI flags override inventory values.

Preferred commands:

```bash
python3 skill/wolp/scripts/wolp_power.py list
python3 skill/wolp/scripts/wolp_power.py wake --device nas
python3 skill/wolp/scripts/wolp_power.py shutdown --device nas
python3 skill/wolp/scripts/wolp_power.py wake --mac AA:BB:CC:DD:EE:FF
python3 skill/wolp/scripts/wolp_power.py wake --mac AA:BB:CC:DD:EE:FF --broadcast-ip 192.168.1.255 --port 9
python3 skill/wolp/scripts/wolp_power.py shutdown --host 192.168.1.50 --mac AA:BB:CC:DD:EE:FF --extra-data FF:FF:FF:FF:FF:FF --port 9
```

For safe previews or debugging, use `--dry-run` first:

```bash
python3 skill/wolp/scripts/wolp_power.py wake --device nas --dry-run
python3 skill/wolp/scripts/wolp_power.py shutdown --device nas --dry-run
```

Client install and config:

- Project: `https://github.com/leeyeel/WOL-plus`
- Releases: `https://github.com/leeyeel/WOL-plus/releases`
- Client receives shutdown packets and serves the Web UI.
- Default Web UI access:
  - URL: `http://<client-ip>:2025`
  - username: `admin`
  - password: `admin123`

Agent standard install procedure:

1. Confirm the minimum missing inputs only:
   - target OS: Windows, Debian/Ubuntu, or RPM-based Linux
   - target architecture when relevant: `amd64` or `arm64`/`aarch64`
   - whether the agent can install directly on the target machine or must only provide user instructions
   - target machine IP if the user wants Web UI verification
2. Choose the install source:
   - prefer a matching package from Releases
   - prefer the Debian package when the agent can reach a Debian/Ubuntu host over SSH
   - only build from this repo when a needed Debian package is unavailable from Releases
3. Install by platform:
   - Windows:
     - download `installer_windows_amd64_v<version>.exe` from Releases
     - if the agent cannot control the Windows desktop session, tell the user to run the installer manually
     - after installation, verify the service is running and open `http://<windows-ip>:2025`
   - Debian/Ubuntu:
     ```bash
     sudo dpkg -i wolp-client_<version>_amd64.deb
     sudo systemctl status wolp.service
     ```
   - RPM Linux:
     ```bash
     sudo rpm -ivh wolp-client-<version>-1.x86_64.rpm
     sudo systemctl status wolp.service
     ```
4. Debian build fallback from this repo:
   ```bash
   bash scripts/build-deb.sh amd64 0.0.0-dev
   sudo dpkg -i release/client/wolp-client_0.0.0-dev_amd64.deb
   sudo systemctl status wolp.service
   ```
5. Verify the client after install:
   - confirm `wolp.service` is active
   - confirm the Web UI responds at `http://<client-ip>:2025`
   - tell the user to change the default password after first login
6. Configure the client when the user wants shutdown support:
   - edit `/usr/local/etc/wolp/wolp.json`
   - set `mac_address` to the client machine MAC that should receive the shutdown packet
   - set `interface` to the active NIC name on the client machine
   - set `extra_data` to match the sender's `--extra-data`
   - set `udp_port` to match the sender's `--port`
   - set `shutdown_delay`, `username`, and `password` as requested
7. Remember the fixed defaults and path layout:
   - binary: `/usr/local/bin/wolp`
   - config: `/usr/local/etc/wolp/wolp.json`
   - web UI: `/usr/share/wolp/webui`
   - service: `wolp.service`
   - default `extra_data=FF:FF:FF:FF:FF:FF`
   - default `udp_port=9`
   - default `shutdown_delay=60`
   - default HTTP UI port `2025`
8. Keep protocol roles clear:
   - sender-side inventory `interface` matters only for `wake`
   - receiver-side `udp_port` and `extra_data` matter only for `shutdown`

When reporting results or performing installs:

- echo the resolved broadcast IP, host, UDP port, and normalized MAC values
- for wake, report that the packet is sent through the `wakeonlan` Python package
- state clearly whether the script performed a real send or a dry run
- if the user did not provide enough data, ask only for the missing MAC, target IPv4 address, or wake broadcast IP when needed
- if you install the client, report the package source, package path, config path, Web UI URL, and the exact `extra_data` and `udp_port` values you configured
