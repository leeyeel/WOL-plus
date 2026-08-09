# OpenWrt Wake On LAN Plus

`luci-app-wolp` keeps wake and shutdown on separate transports:

- Wake uses `etherwake` to transmit a standard Layer 2 Wake-on-LAN Magic Packet.
- Shutdown uses an authenticated unicast UDP control exchange with a running WOLP Client.

The shutdown control payload is not a Magic Packet. It contains an action, target MAC, timestamp, nonce, and HMAC-SHA256 signature. LuCI sends `STATUS` first and only sends `SHUTDOWN` after the Client returns a verified `RUNNING` acknowledgement.

## Dependencies

The IPK declares these dependencies automatically:

- `etherwake`
- `netcat`
- `openssl-util`
- `rpcd-mod-ucode`
- `ucode-mod-fs`

`etherwake` needs raw-socket capability, but it runs only behind the fixed `luci.wolp.wake` RPC method. The UDP control helper uses a normal outgoing UDP socket and does not require `CAP_NET_RAW`.

## Setup

1. Install and start the WOLP Client on the target device.
2. Open its Web UI at `http://<client-ip>:2025` and copy `control_port` and `control_secret` from Settings. The default port is `20250`.
3. Install the OpenWrt IPK and open `Services -> Wake on LAN Plus`.
4. For shutdown, enter the target MAC, Client IPv4 address, control port, and control secret. LuCI remembers the port and secret as its defaults.

If the Client does not acknowledge the status request, shutdown is rejected. A wake request only confirms local packet transmission; it is not reported as a confirmed boot until the Client responds.

## Build

```bash
cd openwrt
VERSION=0.4.0 ./build-ipk.sh
```

The package includes the LuCI page, constrained `rpcd` methods, and `/usr/libexec/wolp-control`.

## Security Boundary

The RPC service exports only `stat`, `wake`, and `control`. It does not expose a generic command executor or `/bin/sh` interface. Access to `wake` and `control` is granted through the package ACL only to LuCI sessions with write access.
