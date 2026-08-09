# luci-app-wolp

This LuCI application sends standard Layer 2 Wake-on-LAN packets and authenticated UDP control requests for a WOLP Client.

The package installs:

- `luci.wolp.wake`: fixed, validated `etherwake` invocation for standard WoL.
- `luci.wolp.control`: fixed, validated `STATUS` and `SHUTDOWN` control exchange.
- `/usr/libexec/wolp-control`: creates and verifies the HMAC-SHA256 UDP messages.

No generic command execution RPC is exposed. The control exchange needs the Client IPv4 address, target MAC, `control_port` (default `20250`), and the Client-generated `control_secret`.

Build and installation guidance is in [the OpenWrt README](../../README.md).
