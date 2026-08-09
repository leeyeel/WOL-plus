# luci-app-wolp

This LuCI application sends raw Layer 2 Wake-on-LAN Magic Packets for both wake and shutdown.

The package installs:

- `luci.wolp.wake`: fixed, validated `etherwake` invocation for standard WoL.
- `luci.wolp.shutdown`: fixed, validated `etherwake` invocation with a six-byte SecureOn-style discriminator.

No generic command execution RPC is exposed. Wake and shutdown require only the target MAC, local interface, and optional broadcast flag; shutdown additionally requires the Client's six-byte discriminator.

Build and installation guidance is in [the OpenWrt README](../../README.md).
