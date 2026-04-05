# Client Install And Config

Use this reference only when the user needs to install or configure the WOL-plus receiver.

Project links:

- Project: `https://github.com/leeyeel/WOL-plus`
- Releases: `https://github.com/leeyeel/WOL-plus/releases`

Receiver role:

- The client receives shutdown packets and can optionally serve the Web UI.
- Default Web UI address when installed: `http://<client-ip>:2025`
- Default credentials when Web UI is installed: `admin` / `admin123`
- Backend-only mode disables the HTTP server:
  - run `wolp --backend-only`
  - Web UI assets may be omitted
  - configure `/usr/local/etc/wolp/wolp.json` directly

Agent install procedure:

1. Confirm the minimum missing inputs:
   - target OS: Windows, Debian/Ubuntu, or RPM-based Linux
   - target architecture when relevant: `amd64` or `arm64`/`aarch64`
   - whether the agent can install directly on the target machine or must only provide instructions
   - target machine IP if Web UI verification matters
2. Choose the install source:
   - prefer a matching package from Releases
   - prefer the Debian package when the agent can reach a Debian/Ubuntu host over SSH
   - only build from this repo when a needed package is unavailable from Releases
3. Install by platform:
   - Windows:
     - download `installer_windows_amd64_v<version>.exe`
     - if the agent cannot control the desktop session, tell the user to run it manually
   - Debian/Ubuntu:
     ```bash
     sudo dpkg -i wolp-client_<version>_amd64.deb
     sudo systemctl status wolp.service
     ```
   - RPM Linux:
     ```bash
     sudo rpm -ivh wolp-client-<version>-1.x86_64.rpm
     sudo systemctl status wolp.service
     ```
4. Debian build fallback:
   ```bash
   bash scripts/build-deb.sh --without-webui amd64 0.0.0-dev
   sudo dpkg -i release/client/wolp-client_0.0.0-dev_amd64.deb
   sudo systemctl status wolp.service
   ```
5. Verify after install:
   - confirm `wolp.service` is active
   - if Web UI is installed, confirm it responds at `http://<client-ip>:2025`
   - if backend-only mode is enabled, do not expect port `2025` to listen
   - if Web UI is enabled, tell the user to change the default password after first login

Receiver config:

- Config path: `/usr/local/etc/wolp/wolp.json`
- Binary path: `/usr/local/bin/wolp`
- Web UI path: `/usr/share/wolp/webui` when installed
- Service name: `wolp.service`
- Default `extra_data`: `FF:FF:FF:FF:FF:FF`
- Default `udp_port`: `9`
- Default `shutdown_delay`: `60`
- Default HTTP UI port: `2025`

When configuring shutdown support:

- Set `mac_address` to the receiver machine MAC that should match the sender packet.
- Set `extra_data` to match the sender `--extra-data`.
- Set `udp_port` to match the sender `--port`.
- Set `shutdown_delay`, `username`, and `password` as requested.

Keep protocol roles clear:

- Sender-side `interface` matters only for `wake`.
- Receiver-side `udp_port` and `extra_data` matter only for `shutdown`.
