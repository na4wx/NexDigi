# Example Configurations

This directory contains example configuration files for common NexDigi deployment scenarios. Copy and modify these files to suit your needs.

## Quick Start

1. Choose an example configuration that matches your use case
2. Copy it to `server/config.json`:
   ```bash
   cp examples/basic-digipeater.json server/config.json
   ```
3. Edit the file and update:
   - `callsign` (your amateur radio callsign)
   - `passcode` (APRS-IS passcode from aprs.fi)
   - `uiPassword` (strong password for web interface)
   - Channel settings (ports, addresses)
4. Start the server:
   ```bash
   npm run dev
   ```

## Available Examples

### 1. basic-digipeater.json

**Use Case:** Simple APRS digipeater for fill-in coverage

**Features:**
- Single serial TNC channel
- WIDE1-1 fill-in digipeater mode
- No IGate, BBS, or NexNet
- Minimal resource usage

**Ideal For:**
- Remote hilltop sites
- Fill-in coverage in weak areas
- First-time users learning the system

**Hardware Requirements:**
- Raspberry Pi or equivalent
- Serial KISS TNC (e.g., MobilinkD, Kantronics)
- VHF/UHF radio

**Configuration Notes:**
- Update `/dev/ttyUSB0` to match your TNC port (Windows: `COM3`, etc.)
- Adjust `baudRate` if your TNC uses different speed (typically 9600 or 19200)
- `rateLimit: 30` prevents digipeating more than 30 packets/minute

---

### 2. mesh-node.json

**Use Case:** NexNet mesh node with full synchronization

**Features:**
- One serial TNC channel
- WIDEn-N digipeater
- BBS enabled with 90-day retention
- NexNet mesh with 2 peers
- Chat and BBS synchronization
- Weather alert distribution

**Ideal For:**
- Emergency communications networks
- Club networks with multiple nodes
- Areas requiring resilient messaging

**Hardware Requirements:**
- Raspberry Pi 4 or better (2GB+ RAM recommended)
- Serial KISS TNC
- Reliable internet connection for mesh backbone

**Configuration Notes:**
- Generate Ed25519 keypair: `openssl genpkey -algorithm ed25519 -out nexnet_key.pem`
- Update `peers` array with actual node addresses
- Set `trusted: true` only for known nodes
- `mode: "mesh"` enables full routing (all nodes can reach each other)
- Alternative modes: `"hub"` (star topology), `"client"` (spoke only)

**Network Setup:**
- Open TCP port 4000 in firewall
- Port forward 4000 if behind NAT
- Use static IP or dynamic DNS for public nodes

---

### 3. igate-only.json

**Use Case:** Dedicated IGate for APRS-IS connectivity

**Features:**
- Single serial TNC
- No digipeater (prevents RF pollution)
- Bidirectional IGate (RF ↔ Internet)
- TLS connection to APRS-IS
- Geographic filter (50km radius)

**Ideal For:**
- Areas with poor APRS-IS coverage
- Static home stations
- Low-traffic areas

**Hardware Requirements:**
- Any computer with serial port
- Serial KISS TNC
- Internet connection (always-on recommended)

**Configuration Notes:**
- Get APRS-IS passcode from https://apps.magicbug.co.uk/passcode/
- Update coordinates in `filter` (format: `r/lat/lon/range`)
- `p/WX` filter includes weather stations
- `rateLimit: 10` prevents flooding APRS-IS
- Set `useTLS: true` for secure connection (port 14580)

**Filter Examples:**
- `r/36.1699/-86.7842/50` - 50km radius around Nashville
- `p/WX` - All weather stations
- `b/W4ABC/N4XYZ` - Specific callsigns
- Combined: `r/36.17/-86.78/50 p/WX b/W4ABC`

---

### 4. full-featured.json

**Use Case:** Kitchen-sink configuration with all features enabled

**Features:**
- 3 channels: Serial TNC, KISS-TCP (Direwolf), Soundmodem
- VHF and UHF digipeaters with beacons
- Bidirectional IGate with TLS
- BBS with Winlink gateway
- NexNet mesh with 3 peers (2 trusted, 1 untrusted)
- Weather alerts for 3 counties
- Metrics and monitoring

**Ideal For:**
- High-availability nodes
- Multi-band operations (VHF/UHF/HF)
- Advanced users wanting all features
- Club stations serving multiple purposes

**Hardware Requirements:**
- Powerful computer (quad-core, 4GB+ RAM)
- Multiple TNCs or Direwolf + soundcard
- VHF, UHF, and/or HF radios
- Reliable internet connection

**Configuration Notes:**
- **Channel 1 (vhf):** 2m APRS via serial TNC
  - WIDE1-1 fill-in mode
  - Beacon every 30 minutes
- **Channel 2 (uhf):** 70cm packet via Direwolf KISS-TCP
  - WIDEn-N mode (more hops allowed)
  - Faster rate limit (20/min vs 30/min)
- **Channel 3 (soundmodem):** HF APRS via Soundmodem
  - No digipeater (HF doesn't use paths)
  - KISS-TCP on port 8100

**Soundmodem Setup:**
- Download from http://soundmodem.sourcearchive.com/
- Configure AGWPE mode on port 8100
- Select appropriate HF modem (300 baud PSK or AFSK)

**Winlink Gateway:**
- Creates `targetCallsign: "WLNK-1"` for forwarding
- Users send APRS messages to your callsign
- Messages forwarded to Winlink RMS

**Weather Alerts:**
- Get SAME codes from https://www.weather.gov/nwr/Counties
- `checkInterval: 300` checks every 5 minutes
- Distributes via APRS and NexNet automatically

**Metrics:**
- Stores 30 days of metrics (`retentionHours: 720`)
- Alerts when memory > 90% or channel errors > 10/hour

---

### 5. headless-server.json

**Use Case:** Server-only deployment (no web UI access)

**Features:**
- Single serial TNC
- WIDEn-N digipeater with beacon
- Bidirectional IGate with TLS
- BBS enabled
- Logging to file
- No NexNet (standalone operation)

**Ideal For:**
- Remote/unattended sites
- Servers managed via SSH
- Low-bandwidth connections
- Production deployments

**Hardware Requirements:**
- Any Linux server
- Serial KISS TNC
- Internet connection (optional for IGate)

**Configuration Notes:**
- Web UI still available but not actively monitored
- Logs written to `/var/log/nexdigi/server.log`
- Log rotation: keeps 5 files × 10MB = 50MB max
- Beacon every hour (`interval: 3600`)
- Use `systemd` or `pm2` for auto-restart

**Systemd Service Example:**

Create `/etc/systemd/system/nexdigi.service`:
```ini
[Unit]
Description=NexDigi APRS Server
After=network.target

[Service]
Type=simple
User=nexdigi
WorkingDirectory=/opt/nexdigi
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable nexdigi
sudo systemctl start nexdigi
sudo journalctl -u nexdigi -f
```

---

## Configuration Reference

For detailed explanation of all configuration options, see:
- **[CONFIGURATION.md](../docs/CONFIGURATION.md)** - Complete configuration guide
- **[INSTALL.md](../docs/INSTALL.md)** - Installation instructions
- **[NEXNET.md](../docs/NEXNET.md)** - NexNet mesh networking guide
- **[API.md](../docs/API.md)** - REST API and WebSocket documentation

## Common Modifications

### Change Serial Port

**Linux/Mac:**
```json
"port": "/dev/ttyUSB0"
```
Find your port: `ls /dev/tty*`

**Windows:**
```json
"port": "COM3"
```
Find your port: Device Manager → Ports

### Add Multiple Radios

```json
"channels": [
  {
    "id": "radio1",
    "type": "serial",
    "port": "/dev/ttyUSB0",
    "baudRate": 9600
  },
  {
    "id": "radio2",
    "type": "serial",
    "port": "/dev/ttyUSB1",
    "baudRate": 19200
  }
]
```

### Use Direwolf Instead of Hardware TNC

1. Start Direwolf with KISS-TCP:
   ```bash
   direwolf -p -t 0
   ```
2. Update config:
   ```json
   {
     "id": "direwolf",
     "type": "kiss-tcp",
     "host": "localhost",
     "port": 8001
   }
   ```

### Change IGate Filter

```json
"filter": "r/36.17/-86.78/50 p/WX b/W4ABC"
```

Components:
- `r/lat/lon/range` - Geographic radius
- `p/prefix` - Prefix match (e.g., `WX`, `APZ`)
- `b/call1/call2` - Specific callsigns
- Combine with spaces

### Disable Features

Set `enabled: false`:
```json
"igate": {
  "enabled": false
}
```

Or remove section entirely.

---

## Security Best Practices

### Change Default Password

**Never use default passwords in production!**

```json
"uiPassword": "MyStrongPassword123!"
```

### Get Valid APRS-IS Passcode

**Never use fake passcodes!**

Generate at: https://apps.magicbug.co.uk/passcode/

### Use TLS for APRS-IS

```json
"igate": {
  "useTLS": true,
  "port": 14580
}
```

### Restrict NexNet Peers

Only trust known nodes:
```json
"peers": [
  {
    "callsign": "N1TRUST-1",
    "address": "trusted.example.com:4000",
    "trusted": true
  },
  {
    "callsign": "N2UNKNOWN-1",
    "address": "unknown.example.com:4000",
    "trusted": false
  }
]
```

Untrusted peers can connect but cannot modify routing tables.

---

## Validation

Before starting the server, validate your configuration:

```bash
npm run validate
```

This checks for:
- JSON syntax errors
- Missing required fields
- Invalid channel types
- Insecure passwords
- Port conflicts

---

## Need Help?

- **Documentation:** [docs/](../docs/)
- **Troubleshooting:** [TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)
- **Issues:** https://github.com/na4wx/NexDigi/issues
- **Contributing:** [CONTRIBUTING.md](../docs/CONTRIBUTING.md)

---

**73 de NA4WX**
