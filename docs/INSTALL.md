# NexDigi Installation Guide

Complete installation instructions for all supported platforms.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation Methods](#installation-methods)
  - [Automated Installation (Recommended)](#automated-installation-recommended)
  - [Manual Installation](#manual-installation)
  - [Docker Installation](#docker-installation)
- [Platform-Specific Guides](#platform-specific-guides)
  - [Debian/Ubuntu Linux](#debianubuntu-linux)
  - [Windows](#windows)
  - [macOS](#macos)
- [Post-Installation](#post-installation)
- [Upgrading](#upgrading)
- [Uninstallation](#uninstallation)

---

## Prerequisites

### All Platforms

- **Node.js:** Version 18 or higher (automatically installed by setup scripts)
- **Disk Space:** Minimum 500 MB, recommended 2 GB for logs and message history
- **RAM:** Minimum 512 MB, recommended 1 GB+ for multi-channel operation
- **Network:** Internet connection for APRS-IS, Winlink CMS, and package installation

### Linux-Specific

- **Build Tools:** gcc, make, python3 (automatically installed by setup scripts)
- **Serial Port Access:** User must be in `dialout` group for TNC access
- **systemd:** For service management (standard on modern distributions)

### Windows-Specific

- **PowerShell:** Version 5.1+ (included in Windows 10/11)
- **Administrator Rights:** Required for service installation
- **Visual C++ Redistributable:** May be needed for some serial adapters

### Hardware (Optional)

- **Serial TNC:** Any KISS-compatible TNC (e.g., Kantronics KPC-3+, TNC-X, MFJ-1270)
- **USB-Serial Adapter:** For connecting serial TNCs to modern computers
- **Sound Card Interface:** For use with Direwolf or SoundModem

---

## Installation Methods

### Automated Installation (Recommended)

The automated installation scripts handle all dependencies, create system users, configure services, and set up autostart.

#### Full Installation (Server + Web UI)

**Linux (Debian/Ubuntu):**
```bash
git clone https://github.com/na4wx/NexDigi.git
cd NexDigi
chmod +x scripts/install.sh
sudo ./scripts/install.sh
```

**Windows (PowerShell as Administrator):**
```powershell
git clone https://github.com/na4wx/NexDigi.git
cd NexDigi
.\scripts\install.ps1
```

#### Server Only (Headless)

Perfect for remote sites, Raspberry Pi deployments, or when accessing the UI from another machine.

**Linux:**
```bash
git clone https://github.com/na4wx/NexDigi.git
cd NexDigi
chmod +x scripts/install-server.sh
sudo ./scripts/install-server.sh
```

**Windows:**
```powershell
git clone https://github.com/na4wx/NexDigi.git
cd NexDigi
.\scripts\install-server.ps1
```

#### Web UI Only (Remote Client)

Install just the web interface to connect to a remote NexDigi server.

**Linux:**
```bash
git clone https://github.com/na4wx/NexDigi.git
cd NexDigi
chmod +x scripts/install-client.sh
sudo ./scripts/install-client.sh
```

**Windows:**
```powershell
git clone https://github.com/na4wx/NexDigi.git
cd NexDigi
.\scripts\install-client.ps1
```

---

### Manual Installation

For development, testing, or when you prefer manual control.

#### 1. Install Node.js

**Debian/Ubuntu:**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt-get install -y nodejs build-essential
```

**Windows:**
Download and install from [nodejs.org](https://nodejs.org/)

**macOS:**
```bash
brew install node
```

#### 2. Clone Repository

```bash
git clone https://github.com/na4wx/NexDigi.git
cd NexDigi
```

#### 3. Install Dependencies

```bash
# Install server dependencies
npm install

# Install client dependencies
cd client
npm install
cd ..
```

#### 4. Configure Application

Edit `server/config.json`:
```json
{
  "callsign": "YOURCALL",
  "ssid": 1,
  "uiPassword": "your-secure-password",
  "port": 3000,
  "channels": []
}
```

#### 5. Build Client (Production)

```bash
cd client
npm run build
cd ..
```

#### 6. Run Application

**Development Mode:**
```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Start client (separate terminal)
cd client
npm run dev
```

**Production Mode:**
```bash
# Start server (serves built client)
node server/index.js
```

---

### Docker Installation

(Coming Soon)

Docker support is planned for a future release. See [GitHub Issue #XX](https://github.com/na4wx/NexDigi/issues) for progress.

---

## Platform-Specific Guides

### Debian/Ubuntu Linux

#### System Requirements

- **OS:** Debian 10+, Ubuntu 20.04+, or derivatives (Raspberry Pi OS, Linux Mint, etc.)
- **Architecture:** amd64, arm64, armhf (Raspberry Pi)

#### Installation Steps

1. **Update System:**
   ```bash
   sudo apt-get update
   sudo apt-get upgrade -y
   ```

2. **Run Installer:**
   ```bash
   git clone https://github.com/na4wx/NexDigi.git
   cd NexDigi
   chmod +x scripts/install.sh
   sudo ./scripts/install.sh
   ```

3. **What the Installer Does:**
   - Installs Node.js 18.x from NodeSource repository
   - Installs build-essential, git, and other dependencies
   - Creates `nexdigi` system user with dialout group membership
   - Backs up any existing installation to `/opt/nexdigi.bak.TIMESTAMP`
   - Installs NexDigi to `/opt/nexdigi`
   - Creates and enables systemd service
   - Starts the service automatically

4. **Verify Installation:**
   ```bash
   systemctl status nexdigi
   journalctl -u nexdigi -f
   ```

5. **Access Web UI:**
   Open `http://localhost:3000` or `http://your-server-ip:3000`

#### Raspberry Pi Notes

- **Performance:** Raspberry Pi 3B+ or newer recommended for multi-channel operation
- **Serial Ports:** Use `/dev/ttyAMA0` or `/dev/ttyUSB0` for TNC connections
- **GPIO Access:** User `nexdigi` is automatically added to `gpio` group
- **Memory:** Consider adding swap if running with less than 1 GB RAM

#### Adding Serial Port Access

If you need to run as a different user:
```bash
sudo usermod -a -G dialout $USER
# Log out and back in for group change to take effect
```

---

### Windows

#### System Requirements

- **OS:** Windows 10 (1809+) or Windows 11, Windows Server 2016+
- **Architecture:** x64 (64-bit)

#### Installation Steps

1. **Open PowerShell as Administrator:**
   - Right-click Start menu
   - Select "Windows PowerShell (Admin)" or "Terminal (Admin)"

2. **Run Installer:**
   ```powershell
   git clone https://github.com/na4wx/NexDigi.git
   cd NexDigi
   .\scripts\install.ps1
   ```

3. **What the Installer Does:**
   - Downloads and installs Node.js 18.x if not present
   - Installs npm dependencies
   - Builds production client
   - Downloads NSSM (service manager)
   - Installs NexDigi to `C:\NexDigi`
   - Creates Windows service set to auto-start
   - Configures Windows Firewall rules for port 3000
   - Starts the service

4. **Verify Installation:**
   ```powershell
   Get-Service NexDigi
   Get-Content C:\NexDigi\nexdigi.log -Tail 50
   ```

5. **Access Web UI:**
   Open `http://localhost:3000`

#### Windows Service Management

```powershell
# Start/Stop service
Start-Service NexDigi
Stop-Service NexDigi
Restart-Service NexDigi

# View status
Get-Service NexDigi

# View logs
Get-Content C:\NexDigi\nexdigi.log -Wait
Get-Content C:\NexDigi\nexdigi-error.log
```

#### COM Port Configuration

Windows assigns COM ports to serial devices. Find your TNC:
1. Open Device Manager
2. Expand "Ports (COM & LPT)"
3. Note the COM port number (e.g., `COM3`)
4. Configure in NexDigi as `COM3`

#### Firewall Issues

If you can't access the UI remotely:
```powershell
# Check firewall rule
Get-NetFirewallRule -DisplayName "NexDigi HTTP"

# Manually add rule if missing
New-NetFirewallRule -DisplayName "NexDigi HTTP" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

---

### macOS

#### System Requirements

- **OS:** macOS 10.15 Catalina or newer
- **Architecture:** Intel (x64) or Apple Silicon (arm64)

#### Installation Steps

1. **Install Homebrew** (if not already installed):
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. **Install Node.js:**
   ```bash
   brew install node
   ```

3. **Clone and Install:**
   ```bash
   git clone https://github.com/na4wx/NexDigi.git
   cd NexDigi
   npm install
   cd client && npm install && cd ..
   ```

4. **Build Client:**
   ```bash
   cd client
   npm run build
   cd ..
   ```

5. **Run Application:**
   ```bash
   # Development mode
   npm run dev

   # Production mode
   node server/index.js
   ```

#### Serial Port Access on macOS

macOS requires special drivers for some USB-serial adapters:
- **FTDI:** Built-in support
- **Prolific PL2303:** Download driver from manufacturer
- **CH340:** Download driver from manufacturer

Find device name:
```bash
ls /dev/tty.*
```

Example: `/dev/tty.usbserial-14420`

#### Creating a Launch Agent

To run NexDigi at startup, create `~/Library/LaunchAgents/com.nexdigi.server.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nexdigi.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/NexDigi/server/index.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/nexdigi.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/nexdigi-error.log</string>
</dict>
</plist>
```

Load the agent:
```bash
launchctl load ~/Library/LaunchAgents/com.nexdigi.server.plist
```

---

## Post-Installation

### First-Time Setup

1. **Access Web UI:**
   Navigate to `http://localhost:3000` (or your server's IP)

2. **Server Setup Dialog:**
   - Enter server host (e.g., `localhost:3000`)
   - Enter UI password (default: `changeme` - **change immediately!**)
   - Enter your callsign

3. **Change Default Password:**
   Edit `server/config.json` (or `C:\NexDigi\server\config.json` on Windows):
   ```json
   {
     "uiPassword": "your-secure-password-here"
   }
   ```
   
   Restart service:
   ```bash
   # Linux
   sudo systemctl restart nexdigi
   
   # Windows
   Restart-Service NexDigi
   ```

4. **Configure Hardware:**
   - Go to Settings → Channels
   - Add your TNC or KISS-TCP connection
   - Save and test connection

5. **Enable Features:**
   - Go to Settings → Features
   - Enable APRS Digipeater, IGate, BBS, etc.
   - Configure callsigns and parameters

### Verifying Installation

#### Check Service Status

**Linux:**
```bash
systemctl status nexdigi
journalctl -u nexdigi -n 50
```

**Windows:**
```powershell
Get-Service NexDigi
Get-Content C:\NexDigi\nexdigi.log -Tail 50
```

#### Test API Endpoints

```bash
# Health check
curl http://localhost:3000/api/channels

# With authentication
curl -H "X-UI-Password: your-password" http://localhost:3000/api/channels
```

#### Check Logs

**Linux:** `/opt/nexdigi/logs/` or `journalctl -u nexdigi -f`  
**Windows:** `C:\NexDigi\nexdigi.log`

---

## Upgrading

### From Git Repository

**Linux:**
```bash
cd /opt/nexdigi
sudo systemctl stop nexdigi
sudo git pull origin main
sudo npm install
cd client && sudo npm install && sudo npm run build && cd ..
sudo systemctl start nexdigi
```

**Windows:**
```powershell
cd C:\NexDigi
Stop-Service NexDigi
git pull origin main
npm install
cd client; npm install; npm run build; cd ..
Start-Service NexDigi
```

### Backup Before Upgrading

**Linux:**
```bash
sudo systemctl stop nexdigi
sudo cp -r /opt/nexdigi /opt/nexdigi.backup.$(date +%Y%m%d)
```

**Windows:**
```powershell
Stop-Service NexDigi
Copy-Item -Path C:\NexDigi -Destination "C:\NexDigi.backup.$(Get-Date -Format 'yyyyMMdd')" -Recurse
```

### Migration Notes

- **Configuration:** Always backup `server/config.json` before upgrading
- **Data:** BBS messages, chat history, and settings are preserved in `server/data/`
- **Breaking Changes:** Check CHANGELOG.md for version-specific migration steps

---

## Uninstallation

### Linux (Debian/Ubuntu)

```bash
# Stop and disable service
sudo systemctl stop nexdigi
sudo systemctl disable nexdigi

# Remove systemd service file
sudo rm /etc/systemd/system/nexdigi.service
sudo systemctl daemon-reload

# Remove installation directory
sudo rm -rf /opt/nexdigi

# Optional: Remove nexdigi user
sudo userdel -r nexdigi

# Optional: Remove Node.js (if not needed for other applications)
sudo apt-get remove nodejs
```

### Windows

```powershell
# Stop and remove service
Stop-Service NexDigi
C:\NexDigi\nssm.exe remove NexDigi confirm

# Remove installation directory
Remove-Item -Recurse -Force C:\NexDigi

# Remove firewall rules
Remove-NetFirewallRule -DisplayName "NexDigi HTTP"
Remove-NetFirewallRule -DisplayName "NexDigi WebSocket"

# Optional: Uninstall Node.js from Programs and Features
```

### macOS

```bash
# Stop launch agent (if configured)
launchctl unload ~/Library/LaunchAgents/com.nexdigi.server.plist
rm ~/Library/LaunchAgents/com.nexdigi.server.plist

# Remove installation directory
rm -rf /path/to/NexDigi

# Optional: Uninstall Node.js
brew uninstall node
```

---

## Troubleshooting Installation

### Node.js Not Found After Installation

**Linux:**
```bash
# Refresh environment
source ~/.bashrc
# or
source ~/.profile
```

**Windows:**
Close and reopen PowerShell to refresh PATH.

### Permission Denied on Serial Port

**Linux:**
```bash
sudo usermod -a -G dialout nexdigi
sudo systemctl restart nexdigi
```

### Port 3000 Already in Use

Check what's using the port:
```bash
# Linux
sudo lsof -i :3000

# Windows
netstat -ano | findstr :3000
```

Change the port in `server/config.json`:
```json
{
  "port": 3001
}
```

### Installation Script Fails

**Linux:**
Check logs:
```bash
cat /tmp/nexdigi-install.log
```

**Windows:**
Run with verbose output:
```powershell
.\scripts\install.ps1 -Verbose
```

### Service Won't Start

**Linux:**
```bash
journalctl -u nexdigi -xe
sudo systemctl status nexdigi -l
```

**Windows:**
```powershell
Get-Content C:\NexDigi\nexdigi-error.log
```

Common causes:
- Invalid JSON in `config.json`
- Missing dependencies (run `npm install` again)
- Port already in use
- File permission issues

---

## Getting Help

- **Documentation:** [docs/](.)
- **GitHub Issues:** [https://github.com/na4wx/NexDigi/issues](https://github.com/na4wx/NexDigi/issues)
- **Discussions:** [https://github.com/na4wx/NexDigi/discussions](https://github.com/na4wx/NexDigi/discussions)
- **Troubleshooting Guide:** [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

**Next Steps:**
- [Configuration Guide](CONFIGURATION.md) - Set up channels, digipeater, IGate, BBS
- [NexNet Guide](NEXNET.md) - Configure mesh networking
- [API Reference](API.md) - Integrate with external applications
