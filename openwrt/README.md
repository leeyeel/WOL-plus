# OpenWrt Wake On LAN Plus

`luci-app-wolp` sends raw Layer-2 Magic Packets with `etherwake`.

- Wake sends a standard 102-byte Magic Packet.
- Shutdown sends the same Magic Packet followed by the Client's six-byte discriminator.

The router and Client must be on the same Layer-2 segment. A shutdown frame can wake an already powered-off target because it is also a standard Magic Packet.

## Dependencies

The IPK declares `etherwake`, `rpcd-mod-ucode`, `ucode-mod-fs`, and
`ucode-mod-uci`.

## Setup

1. Install and start the WOLP Client on the target machine.
2. In the Client Web UI, note `extra_data`.
3. Install the IPK and open `Services -> Wake on LAN Plus`.
4. For shutdown, enter the target MAC and the same six-byte discriminator.

## Build

```bash
cd openwrt
VERSION=1.0.2 ./build-ipk.sh
```

The RPC service exposes only `stat`, `wake`, and `shutdown`; it does not expose generic command execution.

The LuCI page loads its target selector from static DHCP bindings, active DHCP leases,
and active `br-lan` neighbor entries. Manual MAC input remains available only as a
fallback for devices which are not known to the router.
