# NexDigi — modern multi‑channel APRS digipeater

NexDigi is a modern APRS digipeater with multi‑channel support, cross‑digipeating, duplex operation, and built‑in weather alerts and weather‑alert digipeating, specific to your chosen SAME codes.

## Highlights

- Multi‑channel radios/adapters: Serial KISS, KISS‑TCP (e.g., SoundModem), and a Mock adapter for testing
- Cross‑digipeating and routing with WIDEn‑N handling, H‑bit marking, and loop prevention
- Duplex‑style operation per channel (independent RX/TX behavior and routing)
- IGate to APRS‑IS with global and per‑channel toggles
- Weather alerts: polls NWS, matches your SAME codes, sends concise APRS bulletins to ALLWX (properly padded), optionally repeats external weather bulletins, and persists active alerts
- Operator‑friendly UI: live frames, per‑channel actions (Edit, Beacon, Probe, Reconnect, Delete), status at a glance
- Fast setup: one‑command installers (systemd service on Debian/Ubuntu; Windows service script)

## Quick start (development)

Prereqs: Node.js 18+.

```powershell
npm install
cd client; npm install; cd ..
npm run dev
```

Server runs on port 3000, client on Vite default 5173.

## Production install

See Installation below for automated Linux and Windows service setup.

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


