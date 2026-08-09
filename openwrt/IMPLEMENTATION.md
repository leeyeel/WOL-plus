# OpenWrt Implementation

`luci.wolp` exposes fixed RPC methods only:

- `stat`: reports whether `etherwake` is installed.
- `wake(mac, interface, broadcast)`: sends a standard raw Magic Packet.
- `shutdown(mac, interface, broadcast, extra_data)`: sends the same frame with a validated six-byte discriminator using `etherwake -p`.

All input is validated before a shell command is built. `etherwake` is the only raw-socket operation and runs inside the trusted `rpcd` backend.
