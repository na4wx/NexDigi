# NexDigi — APRS Digipeater Foundation (IN DEVELOPMENT)

⚠️ IN DEVELOPMENT — This project is actively under development. APIs, configuration, and on-disk layout will change.

Foundation for a modern APRS digipeater (Node.js backend + React + MUI frontend).

Quick start

1. Install root dependencies (backend):

   npm install

2. Install client dependencies and run both in dev:

   cd client; npm install

3. Run server and client in separate terminals:

   npm run dev:server
   cd client && npm run dev

Server runs on port 3000, client on Vite default 5173.

Current features

NexDigi is a modern APRS digipeater foundation with the following capabilities:

### Multi-channel support
- **Multiple radios/channels**: Configure and manage multiple channels, each representing a radio or connection.
- **Channel types**:
  - Serial KISS adapter: Supports direct serial connections to TNCs (e.g., hardware modems).
  - KISS-TCP adapter: Connects to networked KISS servers (e.g., SoundModem).
  - Mock adapter: Simulates channels for testing and development.

### Digipeating and routing
- **Cross-digipeating**: Define routes between channels to enable cross-digipeating (e.g., forwarding frames from one radio to another).
- **Selective digipeating**: Service WIDE paths or explicit digipeater callsigns.
- **Path modification**: Optionally append the digipeater's callsign to the path when servicing frames.
- **Loop prevention**: Implements a seen-cache with TTL and eviction to avoid frame loops.

### IGate integration
- **Global IGate client**: Forward frames to APRS-IS when enabled.
- **Per-channel IGate toggle**: Selectively enable or disable IGate forwarding for individual channels.
- **Status visibility**: View IGate connection status and activity in the UI.

### Channel management
- **Per-channel configuration**: Customize callsign, mode (e.g., digipeat), IGate settings, and adapter options (e.g., serial port, baud rate).
- **Dynamic control**: Enable, disable, or reconnect channels on the fly.
- **Periodic beacons**: Configure periodic beacon transmissions for each channel.

### Debugging and admin tools
- **API endpoints**:
  - `/api/channels`: Manage channels (list, create, update, delete).
  - `/api/routes`: Manage cross-digipeat routes.
  - `/api/serial-ports`: Discover available serial ports.
  - `/api/frames`: View recent frames.
- **Diagnostics**: Verbose logging and debug endpoints for troubleshooting.

### AX.25 utilities
- **Frame parsing**: Decode AX.25 frames and address fields.
- **SSID handling**: Supports WIDEn-N decrementing and H-bit marking for serviced entries.

### Frontend features
- **Settings UI**: Manage channels and IGate settings via a React + Material-UI interface.
- **Channel actions**: Perform actions like Edit, Beacon, Probe, Reconnect, and Delete directly from the UI.
- **Real-time updates**: View live frame activity and channel status.

These features make NexDigi a flexible and powerful foundation for building APRS digipeaters with modern tools.

What you can do today
1. Edit `server/config.json` to add or change channels and IGate settings.
2. Start the server: from project root run `npm run dev:server` (or `node server/index.js`).
3. Start the client: `cd client && npm run dev` (Vite dev server).
4. Use the Settings → Channels page to view channels, toggle IGate per-channel, and open the per-channel action menu (Edit / Beacon / Probe / Reconnect / Delete).

Planned features / roadmap (high level)
- BBS features (store messages, mailboxes, integration with APRS messages)
- Live chat UI and infra (real-time messaging between stations/users)
- Store-and-forward for APRS messages (persist messages until recipient's beacon/last-seen)
- Real time weather alerts, from the National Weather Service's API (configurable SAME codes for area specific alerts)
- Integration between APRS messages and BBS (route APRS messages into user mailboxes and vice‑versa)
- Authentication/ACLs for IGate and UI changes (role-based access for operators)
- Better tests, CI, and Docker/dev containers
- Optional: tighter APRS-IS filtering controls, duplicate-detection tuning, and advanced path rules

API

- GET /api/channels — list channels (includes `options` and `status`)
- POST /api/channels — create channel (body: { id, name, type, enabled, options })
- PUT /api/channels/:id — update channel
- DELETE /api/channels/:id — delete channel
- GET /api/routes — list routes
- POST /api/routes — add route { from,to }
- DELETE /api/routes — delete route { from,to }
- GET /api/serial-ports — list serial ports (if `serialport` installed)

Tests

Run test scripts in `server/` (if present):

```powershell
node server/test_ax25.js       # AX.25 parsing unit test
node server/test_integration.js # two-node integration test
node server/test_multi_hop.js   # multi-hop test
node server/test_loop_stress.js # loop stress test
```

Notes

- Per-channel digipeat targets are stored in `cfg.channels[].options.targets` and are synchronized to `cfg.routes` at runtime.
- AX.25 parsing supports WIDEn-N decrementing in SSID nibble and textual-suffix forms; serviced entries are H-bit marked.
- The ChannelManager implements a seen-cache with TTL and eviction to prevent loops.

Contributing

PRs welcome. If you'd like me to wire more UI controls (per-channel adapter status details, quick-target edit buttons in list rows), tell me which features to prioritize.

## License

Copyright (c) 2025 Jordan G Webb, NA4WX

This project is licensed under the MIT License — see the `LICENSE` file for details.

## Platform-specific setup

Below are quick, tested setup notes for Debian-based Linux and Windows. They cover prerequisites, node installation, serial device permissions, and guidance for using the adapters included in this project.

### Debian / Ubuntu (recommended steps)

1. Install system prerequisites (build tools and libudev headers for native modules):

```bash
sudo apt update
sudo apt install -y build-essential python3 pkg-config curl libudev-dev git
```

2. Install Node.js (LTS). Example (NodeSource):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

3. Add your user to the `dialout` group to access serial ports (logout/login required):

```bash
sudo usermod -a -G dialout $USER
```

4. Install project dependencies and the client:

```bash
git clone <repo-url>
cd NexDigi
npm install
cd client
npm install
```

5. Configure `server/config.json` to add channels. For simple local testing without hardware, add a `mock` channel.

6. Start the server (development):

```bash
# from repo root
npm run dev:server
# or run both client+server in dev:
npm run dev
```

Notes for Debian:
- If you use serial adapters, the `serialport` package may compile native addons. Having `build-essential`/`python3`/`libudev-dev` installed ensures `npm install` succeeds.
- If you use SoundModem or AGW for audio-based TNCs, run those services separately and configure `kiss-tcp`/`soundmodem` channels in `server/config.json` to point at the host/port.

### Windows (developer-friendly steps)

1. Install Node.js LTS from https://nodejs.org (recommended 18.x or 20.x LTS).

2. Install `windows-build-tools` if `serialport` needs to compile (only required for older Node versions). For modern prebuilt `serialport` releases this may not be necessary.

3. Clone the repository and install dependencies in PowerShell or an elevated prompt if you need device access:

```powershell
git clone <repo-url>
cd NexDigi
npm install
cd client
npm install
```

4. Configure `server/config.json` to include a `serial` or `kiss-tcp` channel as appropriate for your hardware. For testing, add a `mock` channel.

5. Start the server and client (PowerShell):

```powershell
# server only
npm run dev:server
# or both (requires a separate shell for client)
npm run dev
```

Windows notes:
- Serial ports appear as `COM*` (e.g. COM3). Use that name in `server/config.json` for `serial` channels.
- If you run into `serialport` install issues, check for prebuilt binaries for your Node version or install the required Windows build chain (Visual Studio Build Tools).

### Testing without hardware

- Add a `mock` channel in `server/config.json` to exercise the code paths without radio hardware. The mock adapter emits synthetic frames periodically.
- Use the simulate endpoint `/api/digipeater/simulate-incoming-bulletin` to inject a test bulletin and verify that the WeatherAlertManager captures and repeats it (if enabled).

### Running as a service (suggestion)

- On Debian, create a `systemd` service that runs `node /path/to/NexDigi/server/index.js` under a user in the `dialout` group.
- On Windows, use NSSM or a scheduled task to run the server at startup.

If you'd like, I can add a sample `systemd` unit file and a short PowerShell script to install the service on Windows.

### One-line install commands (service)

If you already have the repo checked out on the target host, here are convenient one-line commands to install and enable the service using the files in `deploy/`.

Debian (run from the repository root; requires sudo):

```bash
sudo useradd -r -s /bin/false nexdigi || true; sudo mkdir -p /opt/nexdigi && sudo cp -r . /opt/nexdigi && sudo usermod -a -G dialout nexdigi && sudo chown -R nexdigi:dialout /opt/nexdigi && sudo -u nexdigi bash -lc 'cd /opt/nexdigi && npm install --production' && sudo cp /opt/nexdigi/deploy/nexdigi.service /etc/systemd/system/nexdigi.service && sudo systemctl daemon-reload && sudo systemctl enable --now nexdigi.service
```

Windows (run in an elevated PowerShell prompt from the repo root; adjust Node path and install path as needed):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\install-windows-service.ps1 -InstallPath 'C:\opt\nexdigi' -NodeExe 'C:\Program Files\nodejs\node.exe'
```

Notes:
- The Debian one-liner creates a `nexdigi` user (if not present), copies the repo to `/opt/nexdigi`, installs production dependencies, installs the systemd unit, and starts the service.
- The Windows PowerShell script will attempt to use NSSM (if installed) for a robust service; otherwise it falls back to `sc.exe`. Run the command from an elevated prompt.
- Always inspect and edit the service files (`deploy/nexdigi.service`, `deploy/install-windows-service.ps1`) to match your environment before running automated install commands.

## Safe Debian install (step-by-step)

If you prefer a safer approach than the one-liner, use the provided `deploy/install-debian.sh` which:

- Verifies Node.js version (requires Node >= 18 by default)
- Stops an existing `nexdigi` systemd service if present
- Backs up any previous `/opt/nexdigi` to `/opt/nexdigi.bak.TIMESTAMP`
- Copies files into `/opt/nexdigi` and installs production dependencies as the `nexdigi` user
- Installs the systemd unit (`/etc/systemd/system/nexdigi.service`) and starts the service

Recommended usage (run as root or with sudo):

```bash
# from repository root
sudo bash deploy/install-debian.sh
```

Manual safe install steps (if you want to review each step):

1. Verify Node version (>= 18):

```bash
node -v
```

2. Stop existing service (if present):

```bash
sudo systemctl stop nexdigi.service || true
```

3. Backup existing installation (if present):

```bash
sudo mv /opt/nexdigi /opt/nexdigi.bak.$(date -u +%Y%m%dT%H%M%SZ) || true
```

4. Copy new files to `/opt/nexdigi`:

```bash
sudo mkdir -p /opt/nexdigi
sudo cp -r . /opt/nexdigi
sudo chown -R nexdigi:dialout /opt/nexdigi
```

5. Install production dependencies as the nexdigi user:

```bash
sudo -u nexdigi bash -lc 'cd /opt/nexdigi && npm install --production'
```

6. Install and start systemd unit:

```bash
sudo cp /opt/nexdigi/deploy/nexdigi.service /etc/systemd/system/nexdigi.service
sudo systemctl daemon-reload
sudo systemctl enable --now nexdigi.service
```

7. Tail logs to verify startup:

```bash
journalctl -u nexdigi -f
```

If you want me to tweak `deploy/install-debian.sh` (for example: change minimum Node version, add an env file, or preserve npm caches), tell me what behavior you prefer and I will update it.

### Environment file and uninstall

The systemd unit now supports an environment file at `/etc/default/nexdigi`. Create this file to set environment variables used by the service (example):

```bash
sudo tee /etc/default/nexdigi > /dev/null <<'EOF'
# NexDigi runtime environment
NODE_ENV=production
PORT=3000
EOF
```

The installer preserves an existing `/etc/default/nexdigi` by copying it into the install directory as `.etc-default-nexdigi.bak` so you can review and restore it.

To safely uninstall and restore the last backup created by the installer, use:

```bash
sudo bash deploy/uninstall-debian.sh
```

Provisioning mode

The installer supports an automatic provisioning mode (default) that installs required system packages and Node.js via apt/NodeSource. If you prefer to provision the host yourself (for example, in a locked-down environment or to use a specific Node install method), run the installer with `--no-provision`:

```bash
sudo bash deploy/install-debian.sh --no-provision
```

When provisioning is enabled the installer will:
- apt-get update && apt-get install build-essential python3 pkg-config curl git ca-certificates libudev-dev
- install Node.js ${NODE_MIN_MAJOR}+ via NodeSource if the host lacks a suitable Node.js version


