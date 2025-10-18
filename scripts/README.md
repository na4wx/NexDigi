# Installation Scripts

This directory contains automated installation scripts for deploying NexDigi on various platforms and configurations.

## Linux/macOS Scripts

### Full Installation (Server + Client)
```bash
sudo bash install.sh
```
Installs both the NexDigi server and web UI, sets up systemd service, and configures the system for immediate use.

### Server Only (Headless)
```bash
sudo bash install-server.sh
```
Installs only the NexDigi server without the web UI. Ideal for headless systems or when the UI will be accessed from another machine.

### Client Only (Remote UI)
```bash
sudo bash install-client.sh
```
Installs only the web UI with nginx. Configure to connect to a remote NexDigi server.

## Windows Scripts

### Full Installation (Server + Client)
```powershell
# Run PowerShell as Administrator
.\install.ps1
```
Installs both server and client, creates Windows service using NSSM, and configures firewall rules.

### Server Only (Headless)
```powershell
# Run PowerShell as Administrator
.\install-server.ps1
```
Installs only the NexDigi server as a Windows service.

### Client Only (Remote UI)
```powershell
# Run PowerShell as Administrator
.\install-client.ps1
```
Installs only the web UI using http-server as a Windows service.

## Requirements

### Linux/macOS
- Debian/Ubuntu-based distribution (for `.sh` scripts)
- Root/sudo access
- Internet connection for downloading Node.js

### Windows
- Windows 10/11 or Windows Server 2016+
- PowerShell 5.1+
- Administrator privileges
- Internet connection for downloading Node.js and NSSM

## What the Scripts Do

### Full Installation Scripts
1. Detect and install Node.js 18+ if needed
2. Install system dependencies
3. Install npm packages for server and client
4. Build production client bundle
5. Create system service (systemd/Windows service)
6. Configure firewall (if applicable)
7. Start the service automatically

### Server-Only Scripts
1. Detect and install Node.js 18+ if needed
2. Install system dependencies
3. Install npm packages for server only
4. Create system service for the API server
5. Configure firewall for port 3000
6. Start the service automatically

### Client-Only Scripts
1. Detect and install Node.js 18+ if needed
2. Build production client bundle
3. Install web server (nginx on Linux, http-server on Windows)
4. Configure web server to serve static files
5. Set up automatic startup

## Post-Installation

### Default Settings
- **Server Port**: 3000
- **UI Password**: `changeme` (⚠️ Change this immediately!)
- **Default Channel**: Mock adapter (for testing)

### Change UI Password
Edit the configuration file:
- **Linux**: `/opt/nexdigi/server/config.json`
- **Windows**: `C:\NexDigi\server\config.json`

```json
{
  "uiPassword": "your-secure-password-here"
}
```

Then restart the service:
```bash
# Linux
sudo systemctl restart nexdigi

# Windows
Restart-Service NexDigi
```

### Service Management

#### Linux/macOS
```bash
# View logs
journalctl -u nexdigi -f

# Stop service
sudo systemctl stop nexdigi

# Start service
sudo systemctl start nexdigi

# Restart service
sudo systemctl restart nexdigi

# Service status
sudo systemctl status nexdigi
```

#### Windows
```powershell
# View logs
Get-Content C:\NexDigi\nexdigi.log -Wait

# Stop service
Stop-Service NexDigi

# Start service
Start-Service NexDigi

# Restart service
Restart-Service NexDigi

# Service status
Get-Service NexDigi
```

## Troubleshooting

### Node.js Version Issues
If the script fails to detect Node.js after installation, try:
```bash
# Linux/macOS
source ~/.bashrc
# or
source ~/.profile

# Windows
# Close and reopen PowerShell as Administrator
```

### Port Already in Use
If port 3000 is already in use, edit `server/config.json` to change the port:
```json
{
  "port": 3001
}
```

### Service Won't Start
Check the logs for detailed error messages:
```bash
# Linux
journalctl -u nexdigi -xe

# Windows
Get-Content C:\NexDigi\nexdigi-error.log
```

### Client Can't Connect to Server
1. Verify server is running: `curl http://localhost:3000/api/channels`
2. Check firewall allows port 3000
3. Verify UI password is correct
4. Check server logs for authentication errors

## Uninstallation

### Linux/macOS
```bash
# Stop and remove service
sudo systemctl stop nexdigi
sudo systemctl disable nexdigi
sudo rm /etc/systemd/system/nexdigi.service
sudo systemctl daemon-reload

# Remove installation directory
sudo rm -rf /opt/nexdigi

# Remove client (if installed)
sudo rm /etc/nginx/sites-enabled/nexdigi
sudo rm /etc/nginx/sites-available/nexdigi
sudo rm -rf /var/www/nexdigi
sudo systemctl restart nginx
```

### Windows
```powershell
# Stop and remove service
Stop-Service NexDigi
C:\NexDigi\nssm.exe remove NexDigi confirm

# Remove installation directory
Remove-Item -Recurse -Force C:\NexDigi

# Remove client (if installed)
Stop-Service NexDigi-Client
C:\NexDigi-Client\nssm.exe remove NexDigi-Client confirm
Remove-Item -Recurse -Force C:\NexDigi-Client

# Remove firewall rules
netsh advfirewall firewall delete rule name="NexDigi HTTP"
netsh advfirewall firewall delete rule name="NexDigi WebSocket"
netsh advfirewall firewall delete rule name="NexDigi Client HTTP"
```

## Support

If you encounter issues with the installation scripts, please:
1. Check the troubleshooting section above
2. Review the detailed logs
3. Open an issue on GitHub with:
   - Your OS and version
   - Script output/error messages
   - Contents of log files

For more information, see the main [README.md](../README.md) in the project root.
