# NexDigi 📡# NexDigi — Modern Multi-Channel Packet Radio Toolkit



**The Modern All-in-One Packet Radio Suite**NexDigi is a comprehensive packet radio platform featuring advanced APRS digipeating, mesh networking (NexNet), BBS, Winlink gateway capabilities, and intelligent traffic management with advanced features.



NexDigi is a complete, production-ready platform for amateur packet radio operations. Whether you're running a digipeater, mesh network node, BBS, or Winlink gateway—NexDigi does it all with a beautiful web interface and powerful automation.## 🌟 Feature Tree



[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)### 📡 Core Radio & Channel Management

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)- **Multi-Transport Support**

  - Serial KISS (TNC via USB/Serial)

---  - KISS-TCP (Direwolf, SoundModem)

  - AGW Protocol (Soundmodem, AGWPE)

## ✨ Why NexDigi?  - Mock adapter (testing without hardware)

- **Channel Operations**

**🚀 Quick Setup** — One command installs everything. Server, UI, and system service configured automatically.  - Multi-channel simultaneous operation

  - Per-channel configuration & routing

**🎯 Feature Complete** — APRS digipeater, mesh networking, BBS, Winlink gateway, weather alerts, and real-time chat—all in one package.  - Cross-band digipeating

  - Duplex-style independent RX/TX

**🎨 Modern Interface** — Beautiful Material-UI web dashboard. No more ugly terminal interfaces or config file hell.  - Hot-reload configuration

  - Channel health monitoring

**🔌 Hardware Flexible** — Works with serial TNCs, KISS-TCP (Direwolf/SoundModem), AGW, or no hardware at all (testing mode).

### 🔄 APRS Digipeater

**🌐 Multi-Protocol** — Handles APRS, AX.25, NexNet mesh, APRS-IS, Winlink CMS, and more—all simultaneously.- **Path Processing**

  - WIDEn-N decrementing with H-bit marking

**🛡️ Production Ready** — Automatic reconnection, error recovery, systemd service, and comprehensive logging built-in.  - WIDE1-1 fill-in digipeater mode

  - Configurable max WIDE-N per channel

---  - Loop prevention & duplicate detection

  - Smart seen-cache with TTL

## 🎯 Core Features- **Traffic Management**

  - Cross-channel routing

### 📡 **APRS Digipeater**  - Rate limiting & metrics

- Smart WIDEn-N path processing with duplicate detection  - Blocked frame detection

- Cross-channel routing for multi-band operation    - Performance monitoring

- WIDE1-1 fill-in mode for local coverage

- Rate limiting and traffic metrics### 🌐 IGate (APRS-IS Gateway)

- Configurable hop limits per channel- **Connectivity**

  - Bidirectional APRS-IS connection

### 🕸️ **NexNet Mesh Networking**  - TLS/SSL support

- Self-healing mesh topology with automatic routing  - Automatic reconnection

- Hub-and-spoke or peer-to-peer modes  - Filter configuration

- RF + Internet hybrid links- **Forwarding**

- 4-level QoS priority queuing (Emergency → Low)  - RF → APRS-IS with position validation

- Load balancing with automatic failover  - APRS-IS → RF with rate limiting

- Ed25519 cryptographic authentication  - Per-channel IGate control

- Real-time metrics and monitoring  - Message routing



### 📮 **Bulletin Board System (BBS)**### ☁️ Weather Integration

- Personal and bulletin messages- **NWS Alerts**

- APRS messaging and connected mode access  - Real-time NWS API polling

- Message threading and read tracking  - SAME code filtering

- Automatic notification beacons  - Automatic bulletin generation

- Multi-channel operation  - Active alert persistence

- Cross-node BBS synchronization via NexNet  - Multi-alert handling

- **Weather Digipeating**

### 📧 **Winlink Gateway**  - ALLWX bulletin formatting

- Winlink CMS integration (pickup/delivery)  - External bulletin repeating (optional)

- Automatic message forwarding  - Product code parsing (TOR/SVR/FFW/WSW)

- Position reporting  - Priority emergency alerts

- Multi-channel access with session management

### 📮 Bulletin Board System (BBS)

### ☁️ **Weather Alerts**- **Message Management**

- Real-time NWS alert monitoring  - Personal & bulletin messages

- Automatic APRS bulletin formatting  - Message threading & replies

- SAME code filtering by county  - Read/unread tracking

- Emergency alert prioritization (TOR/SVR/FFW)  - Message expiration

- Weather distribution via NexNet mesh  - User management

- **Access Methods**

### 💬 **Real-Time Chat**  - APRS messaging (UI frames)

- Multi-room keyboard-to-keyboard chat  - Connected mode (AX.25)

- RF and internet connectivity  - Multi-channel access

- Persistent message history  - Session management

- WebSocket real-time updates- **Message Alerts**

- Configurable RF channel routing  - Automatic notification beacons

  - Configurable reminder intervals

### 🌍 **APRS-IS IGate**  - Per-user alert tracking

- Bidirectional RF ↔ APRS-IS gateway  - Message count summaries

- Configurable filters and rate limiting

- TLS/SSL support### 📧 Winlink Gateway

- Automatic reconnection- **CMS Integration**

  - Winlink CMS connection

### 🎛️ **Web Dashboard**  - Message pickup & delivery

- Live frame viewer with hex/text decode  - Position reporting

- Channel status and health monitoring  - Channel status updates

- Interactive configuration (no config files!)- **Operations**

- Real-time traffic metrics  - Automatic reconnection

- Last heard station tracking  - Configurable check intervals

- NexNet topology visualization  - Multi-channel access

  - Queue management

---

### 🕸️ NexNet (Advanced Mesh Networking)

## 🚀 Quick Installation- **Network Topology**

  - Mesh mode (peer-to-peer)

Choose your installation method based on your needs:  - Hub mode (client aggregation)

  - Client mode (connect to hub)

### Option 1: Full Install (Server + Web UI) — Recommended  - Hybrid RF + Internet transport

- **Intelligent Routing**

This installs both the NexDigi server and web interface as a system service.  - Dynamic route discovery

  - Multi-hop forwarding

**Linux (Debian/Ubuntu):**  - Path cost calculation

```bash  - Route preference (Internet/RF)

git clone https://github.com/na4wx/NexDigi.git- **Quality of Service (QoS)**

cd NexDigi  - 4-level priority queuing

chmod +x scripts/install.sh    - Emergency (TOR/SVR/FFW)

sudo ./scripts/install.sh    - High (bulletins/weather)

```    - Normal (standard traffic)

    - Low (routine messages)

**Windows (PowerShell as Administrator):**  - Token bucket bandwidth limiting

```powershell  - Automatic traffic shaping

git clone https://github.com/na4wx/NexDigi.git  - Queue size configuration

cd NexDigi- **Load Balancing**

.\scripts\install.ps1  - Weighted route selection

```  - Round-robin distribution

  - Least-loaded algorithm

### Option 2: Server Only (Headless)  - Automatic failover (threshold-based)

  - Route health tracking

Perfect for remote sites or when you'll access the UI from another machine.- **Mesh Self-Healing**

  - Link State Advertisements (LSA)

**Linux:**  - Dijkstra shortest path

```bash  - Automatic route discovery

git clone https://github.com/na4wx/NexDigi.git  - Link failure detection

cd NexDigi  - Topology synchronization

chmod +x scripts/install-server.sh- **Security & Authentication**

sudo ./scripts/install-server.sh  - Ed25519 public key cryptography

```  - Challenge-response authentication

  - Per-node trust relationships

**Windows:**  - Replay attack prevention

```powershell  - Rate limiting (auth attempts)

git clone https://github.com/na4wx/NexDigi.git  - Session timeout management

cd NexDigi- **BBS Synchronization**

.\scripts\install-server.ps1  - Message replication across nodes

```  - Vector clock conflict resolution

  - Incremental sync (since timestamp)

### Option 3: Web UI Only (Connect to Remote Server)  - Deduplication by message hash

  - Bidirectional propagation

Install just the web interface to connect to a remote NexDigi server.  - Selective sync by bulletin number

- **Weather & APRS Distribution**

**Linux:**  - NWS bulletin parsing & flooding

```bash  - APRS position tracking

git clone https://github.com/na4wx/NexDigi.git  - Geographic queries

cd NexDigi  - Duplicate detection (5s window)

chmod +x scripts/install-client.sh  - Rate limiting (60 packets/min)

./scripts/install-client.sh  - Multi-hop flooding (max 3 hops)

```- **Monitoring & Administration**

  - Real-time metrics (throughput/latency/loss)

**Windows:**  - Node health tracking (active/stale/down)

```powershell  - Ping/pong latency measurement

git clone https://github.com/na4wx/NexDigi.git  - Alert generation (latency/loss thresholds)

cd NexDigi  - Historical data aggregation (5-min intervals)

.\scripts\install-client.ps1  - REST API for dashboards

```

### 🎛️ User Interface

### Option 4: Development Mode- **Web Dashboard**

  - Modern Material-UI design

For development or testing without installing as a service.  - Real-time frame viewer

  - Live channel status

```bash  - Interactive configuration

git clone https://github.com/na4wx/NexDigi.git- **Settings Management**

cd NexDigi  - Channel configuration

npm install  - Digipeater settings

cd client && npm install && cd ..  - IGate configuration

npm run dev  - BBS settings

```  - Winlink settings

  - NexNet settings (QoS/Security/Monitoring)

Access at http://localhost:5173 (client) and http://localhost:3000 (server API)- **Monitoring Pages**

  - Active alerts

---  - Last heard stations

  - NexNet status & neighbors

## ⚙️ Initial Configuration  - Traffic metrics

  - System health

After installation, access the web UI:

### 🔧 Utility Features

**Local:** http://localhost:3000  - **Callsign Lookup**

**Remote:** http://your-server-ip:3000  - Automatic FCC/callook.info queries

  - Cached results (10-min TTL)

### First-Time Setup  - APRS message responses

  - Configurable endpoint

1. **Welcome Dialog** — You'll be prompted to enter:- **Beacon Scheduler**

   - Server host (e.g., `localhost:3000` or `your-server-ip:3000`)  - Periodic position beacons

   - UI password (default: `changeme` - set in `server/config.json`)  - Status beacons

   - Your callsign  - Weather beacons

  - Configurable intervals

2. **Configure Hardware** — Go to Settings → Channels  - Multi-channel support

   - Add Serial TNCs, KISS-TCP connections, or Mock adapters- **Last Heard Tracking**

   - Configure port settings and channel IDs  - Station history

  - Signal strength (if available)

3. **Enable Features** — Settings → Features  - Timestamp tracking

   - Turn on APRS Digipeater, IGate, BBS, Weather Alerts, or NexNet  - Mode detection (APRS/Packet)

   - Configure callsigns and station information

### 🛠️ Administration & Deployment

4. **Set Up Digipeater** — Settings → Digipeater- **Installation**

   - Configure WIDE1-1 and WIDEn-N settings  - One-command Debian/Ubuntu install

   - Set hop limits and duplicate detection  - Windows service installer

  - Systemd integration

5. **Optional: Configure NexNet** — Settings → NexNet  - Automatic dependency handling

   - Choose mesh mode (mesh/hub/client)- **Configuration**

   - Add peer nodes  - JSON-based settings

   - Configure security keys  - Hot-reload support

  - Environment variables

### Default Configuration  - Per-channel overrides

- **Monitoring**

The default `server/config.json` includes:  - Systemd journal logging

- **UI Password:** `changeme` (⚠️ **Change this immediately!**)  - Metric alerts

- **Server Port:** 3000  - Error tracking

- **Mock Channel:** Enabled for testing without hardware  - Performance counters



---### 🔒 Reliability & Performance

- **Error Handling**

## 📚 Documentation  - Graceful degradation

  - Automatic reconnection

- **[Installation Guide](docs/INSTALL.md)** — Detailed setup for all platforms  - Crash recovery

- **[Configuration Guide](docs/CONFIGURATION.md)** — Channel setup, IGate, BBS, NexNet  - Duplicate suppression

- **[NexNet Mesh Guide](docs/NEXNET.md)** — Mesh networking, security, and routing- **Optimization**

- **[Chat System](CHAT_SYSTEM_SUMMARY.md)** — Real-time chat features and setup  - Efficient frame parsing

- **[API Reference](docs/API.md)** — REST API and WebSocket protocols  - Memory-bounded caches

- **[Troubleshooting](docs/TROUBLESHOOTING.md)** — Common issues and solutions  - Periodic cleanup

  - Token bucket rate limiting

---- **Scalability**

  - Multi-channel scaling

## 🔧 System Requirements  - Mesh network routing

  - Queue management

### Minimum  - Resource limits

- **CPU:** Single core, 1 GHz

- **RAM:** 512 MB---

- **Storage:** 500 MB

- **OS:** Linux (Debian/Ubuntu), Windows 10+, macOS 10.15+## Quick Start (Development)

- **Node.js:** 18+ (auto-installed by setup scripts)

**Prerequisites:** Node.js 18+

### Recommended for Multi-Channel/Mesh

- **CPU:** Dual core, 2+ GHz```bash

- **RAM:** 2 GBnpm install

- **Storage:** 2 GB (for logs and message history)cd client && npm install && cd ..

- **Network:** 10 Mbps+ for NexNet internet linksnpm run dev

```

### Hardware Support

- **Serial TNCs:** Any KISS TNC via USB or serial portServer runs on port 3000, client on Vite default 5173.

- **KISS-TCP:** Direwolf, SoundModem, other KISS servers

- **AGW Protocol:** SoundModem, AGWPE## Installation

- **Mock Mode:** No hardware required for testing

NexDigi supports automated installation on Debian/Ubuntu Linux and Windows. The installers handle system dependencies, Node.js installation, and service setup automatically.

---

### Debian / Ubuntu (Recommended)

## 🛠️ Service Management

**Automated install** (installs all dependencies and sets up service):

### Linux (systemd)

```bash

```bashgit clone https://github.com/na4wx/NexDigi.git

# Start/stop servicecd NexDigi

sudo systemctl start nexdigisudo bash deploy/install-debian.sh

sudo systemctl stop nexdigi```



# Enable/disable autostartThis installer will:

sudo systemctl enable nexdigi- Install system packages (build tools, Node.js via NodeSource if needed)

sudo systemctl disable nexdigi- Create a `nexdigi` system user with serial port access

- Back up any existing installation to `/opt/nexdigi.bak.TIMESTAMP`

# View logs- Install NexDigi to `/opt/nexdigi` with production dependencies

journalctl -u nexdigi -f- Set up and start the systemd service



# Restart after config changes**Skip system provisioning** (if you already have Node.js and build tools):

sudo systemctl restart nexdigi

```bash

# Check statussudo bash deploy/install-debian.sh --no-provision

systemctl status nexdigi```

```

**Check logs and status:**

### Windows

```bash

```powershell# View logs

# Start/stop servicejournalctl -u nexdigi -f

Start-Service NexDigi

Stop-Service NexDigi# Check service status

systemctl status nexdigi

# Restart```

Restart-Service NexDigi

### Windows

# View status

Get-Service NexDigi**Automated service install:**



# View logs (Event Viewer or log file)```powershell

Get-Content "C:\NexDigi\logs\nexdigi.log" -Tail 50 -Wait# Clone repository first

```git clone https://github.com/na4wx/NexDigi.git

cd NexDigi

---

# Install Node.js dependencies

## 🔐 Securitynpm install

cd client && npm install && cd ..

### UI Authentication

NexDigi requires password authentication for web UI access. Set your password in `server/config.json`:# Install as Windows service (run in elevated PowerShell)

powershell -ExecutionPolicy Bypass -File .\deploy\install-windows-service.ps1

```json```

{

  "uiPassword": "your-secure-password-here"**Development mode:**

}

``````powershell

# Run server and client in development

**Important Notes:**npm run dev

- RF traffic (APRS, AX.25) does NOT require the UI password```

- NexNet mesh communications use separate cryptographic authentication

- APRS-IS and Winlink connections use their own credentials### Configuration

- The UI password only protects web interface access and configuration changes

1. **Hardware setup**: Edit `server/config.json` to configure your radio channels:

### NexNet Security   - `serial`: For TNCs connected via serial/USB

NexNet uses Ed25519 public key cryptography for node authentication:   - `kiss-tcp`: For SoundModem or networked KISS servers  

   - `mock`: For testing without hardware

1. Each node generates a keypair on first start

2. Nodes exchange public keys via web UI or config file2. **Environment variables**: On Linux, create `/etc/default/nexdigi`:

3. Challenge-response authentication prevents spoofing   ```bash

4. Replay protection with timestamp validation   sudo tee /etc/default/nexdigi > /dev/null <<'EOF'

5. Rate limiting prevents brute force attacks   NODE_ENV=production

   PORT=3000

See [NexNet Security Guide](docs/NEXNET.md#security) for details.   EOF

   ```

---

### Uninstall

## 🤝 Contributing

**Linux:**

Contributions are welcome! Please:```bash

sudo bash deploy/uninstall-debian.sh

1. Fork the repository```

2. Create a feature branch (`git checkout -b feature/amazing-feature`)

3. Commit your changes (`git commit -m 'Add amazing feature'`)**Windows:** Use Windows Services manager or NSSM to remove the service.

4. Push to the branch (`git push origin feature/amazing-feature`)

5. Open a Pull Request## Development Setup



### Development SetupFor development (without service installation):



```bash**Linux/macOS:**

# Install dependencies```bash

npm installgit clone https://github.com/na4wx/NexDigi.git

cd client && npm install && cd ..cd NexDigi

npm install

# Run in development mode (hot reload)cd client && npm install && cd ..

npm run devnpm run dev

```

# Run tests (if available)

npm test**Windows:**

```powershell

# Build for productiongit clone https://github.com/na4wx/NexDigi.git

npm run buildcd NexDigi

cd client && npm run buildnpm install

```cd client; npm install; cd ..

npm run dev

---```



## 📝 Changelog### Testing without hardware



See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.Add a `mock` channel in `server/config.json` to test without radio hardware. The mock adapter generates synthetic frames for testing digipeater and weather alert functionality.



---## License



## 🐛 TroubleshootingMIT © 2025 Jordan G Webb, NA4WX. See `LICENSE` for details.



### Common Issues## Digipeater configuration notes



**Can't connect to server:**A few runtime tunables are exposed in the Digipeater Settings UI and persisted to `server/data/digipeaterSettings.json`.

- Check that the server is running: `systemctl status nexdigi` (Linux) or `Get-Service NexDigi` (Windows)

- Verify the port is open: `netstat -an | grep 3000` (Linux) or `netstat -an | findstr 3000` (Windows)- seenCache

- Check firewall settings   - `ttl` (milliseconds): how long seen frames are remembered. Default: 5000 (5s). Lower values reduce duplicate suppression latency; higher values reduce re-digipeat risks but use more memory.

   - `maxEntries` (integer): maximum number of entries kept in memory. Default: 1000. Increase this if you handle many simultaneous active stations or low frame rates.

**401 Unauthorized errors:**

- Verify your UI password matches `server/config.json`- metricsThresholds

- Clear browser localStorage and re-add the server   - `servicedWideBlocked` (integer): per-check threshold for how many attempts were blocked because another service already handled the same WIDE entry. Default: 10.

- Check server logs for authentication errors   - `maxWideBlocked` (integer): per-check threshold for how many attempts were blocked due to per-channel max-WIDE constraints. Default: 10.

   - `metricsCheckIntervalSec` (integer): how often the server compares metrics against thresholds (seconds). Default: 60.

**Serial port access denied (Linux):**

```bashOperational guidance

# Add user to dialout group- If you see repeated digipeating of the same WIDE frames, increase `seenCache.ttl` slightly (e.g., to 7500 or 10000 ms) and/or increase `maxEntries` to avoid cache eviction of active entries.

sudo usermod -a -G dialout nexdigi- If metrics alerts trigger often, consider lowering thresholds for earlier notification or tune channel `maxWideN` per-channel to limit propagation.

sudo systemctl restart nexdigi- Defaults are conservative for small-to-medium networks. Adjust gradually while monitoring metrics in the UI.

```



**WebSocket disconnects immediately:**
- Check that the UI password is correctly configured in the client
- Verify the WebSocket URL includes the password parameter
- Check browser console for detailed error messages

For more help, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

---

## 📄 License

MIT License © 2025 Jordan G Webb, NA4WX

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## 🙏 Acknowledgments

- **APRS Specification:** Bob Bruninga, WB4APR
- **AX.25 Protocol:** Amateur Radio community
- **Winlink Development Team:** For CMS documentation
- **Open Source Community:** Node.js, React, Material-UI, and countless libraries

---

## 📞 Support & Contact

- **Issues:** [GitHub Issues](https://github.com/na4wx/NexDigi/issues)
- **Discussions:** [GitHub Discussions](https://github.com/na4wx/NexDigi/discussions)
- **Email:** [na4wx@na4wx.com](mailto:na4wx@na4wx.com)
- **Website:** [https://na4wx.com](https://na4wx.com)

**73 de NA4WX!** 📡
