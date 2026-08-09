# Client Install And Config

Use this reference when installing or configuring the WOL-plus receiver.

The Client captures raw Ethernet frames. It must be on the same Layer-2 network as the sender.

- Linux requires `libpcap` and packet-capture permission. The packaged `wolp.service` runs as root.
- Windows requires Npcap before the WOL-plus Client starts.
- The default Web UI is `http://<client-ip>:2025`, with initial credentials `admin` / `admin123`.

Install a matching package from [Releases](https://github.com/leeyeel/WOL-plus/releases):

```bash
sudo dpkg -i wolp-client-with-webui_<version>_amd64.deb
sudo systemctl status wolp.service
```

For RPM systems:

```bash
sudo rpm -ivh wolp-client-with-webui-<version>-1.x86_64.rpm
sudo systemctl status wolp.service
```

The Linux configuration is `/usr/local/etc/wolp/wolp.json`:

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "interface": "eno1",
  "extra_data": "12:34:56:78:9A:BC",
  "shutdown_delay": "60",
  "username": "admin",
  "password": "admin123"
}
```

`extra_data` must match the sender's shutdown discriminator. Standard wake frames contain no discriminator and therefore do not start shutdown.

For capture-only operation:

```bash
wolp --backend-only
```

This mode does not start the Web UI. Configure the JSON file directly.
