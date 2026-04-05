---
name: wolp
description: Wake or shut down LAN devices from the agent host. Use this when the user wants to power on a device with a raw Ethernet Wake-on-LAN frame or power off a device with a WOL-plus UDP packet, and they can provide the target MAC address plus a network interface for wake or a target IPv4 address for shutdown.
---

# wolp

Use this skill when the user wants the agent to control power state for a machine on the local network.

Use the bundled script:

- `scripts/wolp_power.py`

Supported operations:

- `list`: print the resolved inventory the script will use
- `wake`: send a standard Wake-on-LAN raw Ethernet frame
- `shutdown`: send a WOL-plus UDP packet to a target IPv4 address

Runtime properties:

- The script uses only the Python standard library.
- No `pip install` step is required.
- Real `wake` sends require Linux `AF_PACKET` support plus `CAP_NET_RAW` or `root`.
- Default inventory path is:
  - `WOLP_DEVICE_FILE`, if set
  - otherwise `XDG_CONFIG_HOME/wolp/devices.json`
  - otherwise `~/.config/wolp/devices.json`
- The bundled example inventory is `assets/devices.example.json`.
- Successful non-dry-run operations update the resolved inventory file in the user config path, not inside the skill directory.
- Packet send confirms local transmission only. It does not prove the remote host changed power state.

Minimum required inputs:

- Wake:
  - target MAC address
  - network interface name on the sender, such as `eno1` or `wlp6s0`
- Shutdown:
  - target MAC address
  - target IPv4 address
  - optional `extra_data`, default `FF:FF:FF:FF:FF:FF`
  - optional UDP port, default `9`

Execution policy:

- Default to `--dry-run` first unless the user clearly asked to send immediately.
- Before a real `wake`, confirm the agent is running on Linux and has permission to open raw sockets.
- Before a real `shutdown`, get explicit confirmation from the user.
- For `wake`, echo the resolved MAC, interface, source MAC, EtherType, and whether the run was dry-run or real send.
- For `wake`, also echo whether the interface came from `cli`, `inventory`, or `auto`.
- For `shutdown`, echo the resolved MAC, host, UDP port, and whether the run was dry-run or real send.

Inventory workflow:

- Use `wake --list-interfaces` first when you need to discover the correct local NIC name.
- Prefer entries where `preferred` is `true`.
- If multiple entries are `preferred`, choose an `operstate=up` physical LAN NIC rather than `lo`, `docker*`, `br-*`, `tailscale*`, `tun*`, `tap*`, or other virtual interfaces.
- If the user wants the agent to choose automatically, use `wake --auto-interface`.
- Use `list` first when you need to inspect or verify stored devices.
- If `--device <name>` is provided, resolve values from that entry first.
- If `--device <name>` is provided with explicit CLI flags and that entry does not exist yet, treat the device name as the record name to use on a later successful send.
- If `wake --device <name>` resolves a MAC but no interface, automatically select the best local interface using the same logic as `--auto-interface`.
- CLI flags override inventory values.
- On a successful real send:
  - if `--device <name>` is set, update that record in place
  - otherwise, reuse an existing entry with the same MAC or create `device-<mac>`
- If the default inventory file does not exist yet, the script initializes it with empty `devices` and default values.
- The example file format is:

```json
{
  "defaults": {
    "port": 9,
    "extra_data": "FF:FF:FF:FF:FF:FF"
  },
  "devices": {
    "nas": {
      "mac": "AA:BB:CC:DD:EE:FF",
      "host": "192.168.1.50",
      "interface": "eno1"
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

Preferred commands:

```bash
python3 skill/wolp/scripts/wolp_power.py list
python3 skill/wolp/scripts/wolp_power.py wake --list-interfaces
python3 skill/wolp/scripts/wolp_power.py wake --auto-interface --mac AA:BB:CC:DD:EE:FF --dry-run
python3 skill/wolp/scripts/wolp_power.py wake --device nas
python3 skill/wolp/scripts/wolp_power.py shutdown --device nas
python3 skill/wolp/scripts/wolp_power.py wake --mac AA:BB:CC:DD:EE:FF --interface eth0
python3 skill/wolp/scripts/wolp_power.py shutdown --host 192.168.1.50 --mac AA:BB:CC:DD:EE:FF --extra-data FF:FF:FF:FF:FF:FF --port 9
```

Safe preview commands:

```bash
python3 skill/wolp/scripts/wolp_power.py wake --device nas --dry-run
python3 skill/wolp/scripts/wolp_power.py shutdown --device nas --dry-run
```

Failure handling:

- If the user does not provide enough information, ask only for the missing MAC, wake interface, or shutdown target IPv4.
- If `wake --auto-interface` fails, run `wake --list-interfaces` and choose a `preferred=true` physical LAN NIC explicitly.
- If `shutdown` succeeds locally but the target does not power off, verify receiver-side `extra_data`, `udp_port`, firewall rules, and that the WOL-plus client is running.
- If `wake` fails locally, verify Linux host support, raw-socket permission, and that the chosen interface is the correct LAN NIC.
- If the user needs receiver installation or configuration, read `references/client-install.md`.

Receiver-side install and config details live in `references/client-install.md`.
