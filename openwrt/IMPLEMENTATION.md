# OpenWrt Implementation

The LuCI frontend does not open raw sockets or execute arbitrary commands. It calls constrained `rpcd` methods:

- `stat`: detects packaged dependencies.
- `wake(mac, interface, broadcast)`: runs a validated `etherwake` command.
- `control(action, host, port, mac, secret)`: runs the packaged control helper for `status` or `shutdown`.

`wake` is the only raw-socket operation. It remains in the trusted `rpcd` backend because `etherwake` needs the privilege. `control` sends normal unicast UDP to a port at or above `1024`, so it does not need raw-socket capability.

The control helper signs `WOLP/1` requests with HMAC-SHA256, waits for a signed Client ACK, and returns a JSON result to LuCI. LuCI requires a `RUNNING` ACK before it sends `SHUTDOWN`; it reports `SCHEDULED` or `ALREADY_SCHEDULED` only after the Client acknowledges it.

The package ACL grants `stat` as read-only and `wake`/`control` only to write-capable LuCI sessions. It intentionally does not export the old `exec`, `probe`, or `/bin/sh` interfaces.
