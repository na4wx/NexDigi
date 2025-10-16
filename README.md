# NexDigi — Modern Multi-Channel Packet Radio Toolkit

NexDigi is a comprehensive packet radio platform featuring advanced APRS digipeating, mesh networking (NexNet), BBS, Winlink gateway capabilities, and intelligent traffic management with enterprise-grade features.

## 🌟 Feature Tree

### 📡 Core Radio & Channel Management
- **Multi-Transport Support**
  - Serial KISS (TNC via USB/Serial)
  - KISS-TCP (Direwolf, SoundModem)
  - AGW Protocol (Soundmodem, AGWPE)
  - Mock adapter (testing without hardware)
- **Channel Operations**
  - Multi-channel simultaneous operation
  - Per-channel configuration & routing
  - Cross-band digipeating
  - Duplex-style independent RX/TX
  - Hot-reload configuration
  - Channel health monitoring

### 🔄 APRS Digipeater
- **Path Processing**
  - WIDEn-N decrementing with H-bit marking
  - WIDE1-1 fill-in digipeater mode
  - Configurable max WIDE-N per channel
  - Loop prevention & duplicate detection
  - Smart seen-cache with TTL
- **Traffic Management**
  - Cross-channel routing
  - Rate limiting & metrics
  - Blocked frame detection
  - Performance monitoring

### 🌐 IGate (APRS-IS Gateway)
- **Connectivity**
  - Bidirectional APRS-IS connection
  - TLS/SSL support
  - Automatic reconnection
  - Filter configuration
- **Forwarding**
  - RF → APRS-IS with position validation
  - APRS-IS → RF with rate limiting
  - Per-channel IGate control
  - Message routing

### ☁️ Weather Integration
- **NWS Alerts**
  - Real-time NWS API polling
  - SAME code filtering
  - Automatic bulletin generation
  - Active alert persistence
  - Multi-alert handling
- **Weather Digipeating**
  - ALLWX bulletin formatting
  - External bulletin repeating (optional)
  - Product code parsing (TOR/SVR/FFW/WSW)
  - Priority emergency alerts

### 📮 Bulletin Board System (BBS)
- **Message Management**
  - Personal & bulletin messages
  - Message threading & replies
  - Read/unread tracking
  - Message expiration
  - User management
- **Access Methods**
  - APRS messaging (UI frames)
  - Connected mode (AX.25)
  - Multi-channel access
  - Session management
- **Message Alerts**
  - Automatic notification beacons
  - Configurable reminder intervals
  - Per-user alert tracking
  - Message count summaries

### 📧 Winlink Gateway
- **CMS Integration**
  - Winlink CMS connection
  - Message pickup & delivery
  - Position reporting
  - Channel status updates
- **Operations**
  - Automatic reconnection
  - Configurable check intervals
  - Multi-channel access
  - Queue management

### 🕸️ NexNet (Advanced Mesh Networking)
- **Network Topology**
  - Mesh mode (peer-to-peer)
  - Hub mode (client aggregation)
  - Client mode (connect to hub)
  - Hybrid RF + Internet transport
- **Intelligent Routing**
  - Dynamic route discovery
  - Multi-hop forwarding
  - Path cost calculation
  - Route preference (Internet/RF)
- **Quality of Service (QoS)**
  - 4-level priority queuing
    - Emergency (TOR/SVR/FFW)
    - High (bulletins/weather)
    - Normal (standard traffic)
    - Low (routine messages)
  - Token bucket bandwidth limiting
  - Automatic traffic shaping
  - Queue size configuration
- **Load Balancing**
  - Weighted route selection
  - Round-robin distribution
  - Least-loaded algorithm
  - Automatic failover (threshold-based)
  - Route health tracking
- **Mesh Self-Healing**
  - Link State Advertisements (LSA)
  - Dijkstra shortest path
  - Automatic route discovery
  - Link failure detection
  - Topology synchronization
- **Security & Authentication**
  - Ed25519 public key cryptography
  - Challenge-response authentication
  - Per-node trust relationships
  - Replay attack prevention
  - Rate limiting (auth attempts)
  - Session timeout management
- **BBS Synchronization**
  - Message replication across nodes
  - Vector clock conflict resolution
  - Incremental sync (since timestamp)
  - Deduplication by message hash
  - Bidirectional propagation
  - Selective sync by bulletin number
- **Weather & APRS Distribution**
  - NWS bulletin parsing & flooding
  - APRS position tracking
  - Geographic queries
  - Duplicate detection (5s window)
  - Rate limiting (60 packets/min)
  - Multi-hop flooding (max 3 hops)
- **Monitoring & Administration**
  - Real-time metrics (throughput/latency/loss)
  - Node health tracking (active/stale/down)
  - Ping/pong latency measurement
  - Alert generation (latency/loss thresholds)
  - Historical data aggregation (5-min intervals)
  - REST API for dashboards

### 🎛️ User Interface
- **Web Dashboard**
  - Modern Material-UI design
  - Real-time frame viewer
  - Live channel status
  - Interactive configuration
- **Settings Management**
  - Channel configuration
  - Digipeater settings
  - IGate configuration
  - BBS settings
  - Winlink settings
  - NexNet settings (QoS/Security/Monitoring)
- **Monitoring Pages**
  - Active alerts
  - Last heard stations
  - NexNet status & neighbors
  - Traffic metrics
  - System health

### 🔧 Utility Features
- **Callsign Lookup**
  - Automatic FCC/callook.info queries
  - Cached results (10-min TTL)
  - APRS message responses
  - Configurable endpoint
- **Beacon Scheduler**
  - Periodic position beacons
  - Status beacons
  - Weather beacons
  - Configurable intervals
  - Multi-channel support
- **Last Heard Tracking**
  - Station history
  - Signal strength (if available)
  - Timestamp tracking
  - Mode detection (APRS/Packet)

### 🛠️ Administration & Deployment
- **Installation**
  - One-command Debian/Ubuntu install
  - Windows service installer
  - Systemd integration
  - Automatic dependency handling
- **Configuration**
  - JSON-based settings
  - Hot-reload support
  - Environment variables
  - Per-channel overrides
- **Monitoring**
  - Systemd journal logging
  - Metric alerts
  - Error tracking
  - Performance counters

### 🔒 Reliability & Performance
- **Error Handling**
  - Graceful degradation
  - Automatic reconnection
  - Crash recovery
  - Duplicate suppression
- **Optimization**
  - Efficient frame parsing
  - Memory-bounded caches
  - Periodic cleanup
  - Token bucket rate limiting
- **Scalability**
  - Multi-channel scaling
  - Mesh network routing
  - Queue management
  - Resource limits

---

## Quick Start (Development)

**Prerequisites:** Node.js 18+

```bash
npm install
cd client && npm install && cd ..
npm run dev
```

Server runs on port 3000, client on Vite default 5173.

## Installation

NexDigi supports automated installation on Debian/Ubuntu Linux and Windows. The installers handle system dependencies, Node.js installation, and service setup automatically.

### Debian / Ubuntu (Recommended)

**Automated install** (installs all dependencies and sets up service):

```bash
git clone https://github.com/na4wx/NexDigi.git
cd NexDigi
sudo bash deploy/install-debian.sh
```

This installer will:
- Install system packages (build tools, Node.js via NodeSource if needed)
- Create a `nexdigi` system user with serial port access
- Back up any existing installation to `/opt/nexdigi.bak.TIMESTAMP`
- Install NexDigi to `/opt/nexdigi` with production dependencies
- Set up and start the systemd service

**Skip system provisioning** (if you already have Node.js and build tools):

```bash
sudo bash deploy/install-debian.sh --no-provision
```

**Check logs and status:**

```bash
# View logs
journalctl -u nexdigi -f

# Check service status
systemctl status nexdigi
```

### Windows

**Automated service install:**

```powershell
# Clone repository first
git clone https://github.com/na4wx/NexDigi.git
cd NexDigi

# Install Node.js dependencies
npm install
cd client && npm install && cd ..

# Install as Windows service (run in elevated PowerShell)
powershell -ExecutionPolicy Bypass -File .\deploy\install-windows-service.ps1
```

**Development mode:**

```powershell
# Run server and client in development
npm run dev
```

### Configuration

1. **Hardware setup**: Edit `server/config.json` to configure your radio channels:
   - `serial`: For TNCs connected via serial/USB
   - `kiss-tcp`: For SoundModem or networked KISS servers  
   - `mock`: For testing without hardware

2. **Environment variables**: On Linux, create `/etc/default/nexdigi`:
   ```bash
   sudo tee /etc/default/nexdigi > /dev/null <<'EOF'
   NODE_ENV=production
   PORT=3000
   EOF
   ```

### Uninstall

**Linux:**
```bash
sudo bash deploy/uninstall-debian.sh
```

**Windows:** Use Windows Services manager or NSSM to remove the service.

## Development Setup

For development (without service installation):

**Linux/macOS:**
```bash
git clone https://github.com/na4wx/NexDigi.git
cd NexDigi
npm install
cd client && npm install && cd ..
npm run dev
```

**Windows:**
```powershell
git clone https://github.com/na4wx/NexDigi.git
cd NexDigi
npm install
cd client; npm install; cd ..
npm run dev
```

### Testing without hardware

Add a `mock` channel in `server/config.json` to test without radio hardware. The mock adapter generates synthetic frames for testing digipeater and weather alert functionality.

## License

MIT © 2025 Jordan G Webb, NA4WX. See `LICENSE` for details.

## Digipeater configuration notes

A few runtime tunables are exposed in the Digipeater Settings UI and persisted to `server/data/digipeaterSettings.json`.

- seenCache
   - `ttl` (milliseconds): how long seen frames are remembered. Default: 5000 (5s). Lower values reduce duplicate suppression latency; higher values reduce re-digipeat risks but use more memory.
   - `maxEntries` (integer): maximum number of entries kept in memory. Default: 1000. Increase this if you handle many simultaneous active stations or low frame rates.

- metricsThresholds
   - `servicedWideBlocked` (integer): per-check threshold for how many attempts were blocked because another service already handled the same WIDE entry. Default: 10.
   - `maxWideBlocked` (integer): per-check threshold for how many attempts were blocked due to per-channel max-WIDE constraints. Default: 10.
   - `metricsCheckIntervalSec` (integer): how often the server compares metrics against thresholds (seconds). Default: 60.

Operational guidance
- If you see repeated digipeating of the same WIDE frames, increase `seenCache.ttl` slightly (e.g., to 7500 or 10000 ms) and/or increase `maxEntries` to avoid cache eviction of active entries.
- If metrics alerts trigger often, consider lowering thresholds for earlier notification or tune channel `maxWideN` per-channel to limit propagation.
- Defaults are conservative for small-to-medium networks. Adjust gradually while monitoring metrics in the UI.


