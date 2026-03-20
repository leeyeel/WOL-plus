---
name: wolp-lan-power-control
description: Wake or shut down LAN devices by sending WOL-plus packets from the agent host. Use this when the user wants to power on a device with a raw Ethernet magic packet, or power off a device with a UDP magic packet, and they can provide the target MAC address plus the network interface or target IPv4 address.
---

# WOLP LAN Power Control

Use this skill when the user wants the agent to control a device on the local network.

Supported operations:

- `wake`: send a raw Ethernet magic packet on a specific interface
- `shutdown`: send a UDP magic packet to a target IPv4 address
- `list`: print the resolved device inventory

Use the bundled Python script:

- `scripts/wolp_power.py`
- `scripts/build_wake_helper.sh`
- `scripts/wolp_wake_helper.c`
- `devices.json`

Required inputs:

- Wake:
  - target MAC address
  - local interface name, such as `eth0` or `br-lan`
- Shutdown:
  - target MAC address
  - target IPv4 address
  - optional `extra_data`, default `FF:FF:FF:FF:FF:FF`
  - optional UDP port, default `9`

Constraints:

- `shutdown` uses a normal UDP socket and does not require `root`.
- `wake` uses a separate raw-frame helper on Linux. Only the helper needs `root` or `CAP_NET_RAW`.
- Build the helper once:
- Preferred setup uses `setcap`:

```bash
bash skill/wolp-lan-power-control/scripts/build_wake_helper.sh
sudo setcap cap_net_raw+ep skill/wolp-lan-power-control/scripts/wolp_wake_helper
```

- If `setcap` is not available, use `--sudo-helper` so only the helper runs with `sudo`:

```bash
python3 skill/wolp-lan-power-control/scripts/wolp_power.py wake --device nas --sudo-helper
```

- `--sudo-helper` calls `sudo -n`, so configure passwordless sudo for the helper path if you want non-interactive agent execution.
- Do not run the whole Python script as `root` unless necessary.
- The Python script delegates `wake` to `wolp_wake_helper`, so the main script can remain unprivileged.
- `shutdown` requires IP connectivity to the target host and a compatible WOL-plus listener on the target machine.
- Packet send confirms only local transmission, not that the remote machine actually changed power state.

Device inventory:

- Store reusable devices in `skill/wolp-lan-power-control/devices.json`.
- Fill `devices.json` before using `--device <name>`.
- The file format is:

```json
{
  "defaults": {
    "interface": "br-lan",
    "port": 9,
    "extra_data": "FF:FF:FF:FF:FF:FF"
  },
  "devices": {
    "nas": {
      "mac": "AA:BB:CC:DD:EE:FF",
      "host": "192.168.1.50"
    },
    "desktop": {
      "mac": "11:22:33:44:55:66",
      "host": "192.168.1.60",
      "interface": "eth0",
      "extra_data": "12:34:56:78:9A:BC",
      "port": 9
    }
  }
}
```

- Use `list` before sending if you need to inspect or verify stored devices.
- CLI flags override inventory values.

Preferred commands:

```bash
bash skill/wolp-lan-power-control/scripts/build_wake_helper.sh
python3 skill/wolp-lan-power-control/scripts/wolp_power.py list
python3 skill/wolp-lan-power-control/scripts/wolp_power.py wake --device nas
python3 skill/wolp-lan-power-control/scripts/wolp_power.py wake --device nas --sudo-helper
python3 skill/wolp-lan-power-control/scripts/wolp_power.py shutdown --device nas
python3 skill/wolp-lan-power-control/scripts/wolp_power.py wake --interface br-lan --mac AA:BB:CC:DD:EE:FF
python3 skill/wolp-lan-power-control/scripts/wolp_power.py shutdown --host 192.168.1.50 --mac AA:BB:CC:DD:EE:FF --extra-data FF:FF:FF:FF:FF:FF --port 9
```

For safe previews or debugging, use `--dry-run` first:

```bash
python3 skill/wolp-lan-power-control/scripts/wolp_power.py wake --device nas --dry-run
python3 skill/wolp-lan-power-control/scripts/wolp_power.py shutdown --device nas --dry-run
```

Client install and config:

- Prefer the Debian client when the agent can reach the target machine over SSH.
- Build the package from this repo if needed:

```bash
bash scripts/build-deb.sh amd64 0.0.0-dev
```

- Install on the target machine:

```bash
sudo dpkg -i release/client/wolp-client_0.0.0-dev_amd64.deb
sudo systemctl status wolp.service
```

- Linux client paths:
  - config: `/usr/local/etc/wolp/wolp.json`
  - service: `wolp.service`
  - web UI: `/usr/share/wolp/webui`
  - HTTP UI port: `2025`
- Important config fields in `/usr/local/etc/wolp/wolp.json`:
  - `mac_address`: the client machine's MAC address to match in shutdown packets
  - `interface`: the client machine's active NIC name
  - `extra_data`: must match the sender's `--extra-data`
  - `udp_port`: must match the sender's `--port`
  - `shutdown_delay`: local delay before poweroff, in seconds
  - `username` and `password`: web UI credentials
- Default receiver values in this repo:
  - `extra_data=FF:FF:FF:FF:FF:FF`
  - `udp_port=9`
  - `shutdown_delay=60`
  - HTTP UI port `2025`
- The sender-side inventory `interface` is only for `wake`. The receiver-side `udp_port` and `extra_data` are only for `shutdown`.

When reporting results or performing installs:

- echo the resolved interface, host, UDP port, and normalized MAC values
- for wake, report which helper path is being used
- state clearly whether the script performed a real send or a dry run
- if the user did not provide enough data, ask only for the missing interface, MAC, or target IPv4 address
- if you install the client, report the package path, config path, and the exact `extra_data` and `udp_port` values you configured
