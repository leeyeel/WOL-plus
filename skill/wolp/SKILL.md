---
name: wolp
description: Wake or shut down LAN devices from the agent host using raw Ethernet Wake-on-LAN Magic Packets.
---

# wolp

Use this skill to control a device on the same Layer-2 network as the agent host.

Run `scripts/wolp_power.py`.

- `list`: print the resolved inventory.
- `wake`: send a standard raw Ethernet Magic Packet.
- `shutdown`: send a Magic Packet followed by a six-byte shutdown discriminator.

Real sends require Linux `AF_PACKET` plus `CAP_NET_RAW` or `root`. The script uses only the Python standard library.

Default device inventory location:

- `WOLP_DEVICE_FILE`, if set.
- `XDG_CONFIG_HOME/wolp/devices.json`, if set.
- `~/.config/wolp/devices.json` otherwise.

Minimum inputs:

- Wake: target MAC and sender interface.
- Shutdown: target MAC, sender interface, and the Client's six-byte `extra_data` discriminator.

Use `--dry-run` unless the user clearly requested a real send. Before a real shutdown, get explicit confirmation because the Magic Packet can wake an already powered-off device.

Use `wake --list-interfaces` to inspect local interfaces. Prefer a `preferred=true`, `operstate=up` physical LAN interface. `--auto-interface` selects the best available one.

Device inventory example:

```json
{
  "defaults": {
    "extra_data": "FF:FF:FF:FF:FF:FF"
  },
  "devices": {
    "nas": {
      "mac": "AA:BB:CC:DD:EE:FF",
      "interface": "eno1"
    },
    "desktop": {
      "mac": "11:22:33:44:55:66",
      "interface": "eno1",
      "extra_data": "12:34:56:78:9A:BC"
    }
  }
}
```

Commands:

```bash
python3 skill/wolp/scripts/wolp_power.py list
python3 skill/wolp/scripts/wolp_power.py wake --list-interfaces
python3 skill/wolp/scripts/wolp_power.py wake --device nas --dry-run
python3 skill/wolp/scripts/wolp_power.py shutdown --device desktop --dry-run
python3 skill/wolp/scripts/wolp_power.py shutdown --interface eth0 --mac AA:BB:CC:DD:EE:FF --extra-data 12:34:56:78:9A:BC --dry-run
```

Successful real sends update the resolved device inventory. Receiver setup details are in `references/client-install.md`.
