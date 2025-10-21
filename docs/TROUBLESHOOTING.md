# NexDigi Troubleshooting Guide

Common issues, solutions, and debugging tips for NexDigi.

## Table of Contents

- [Authentication Issues](#authentication-issues)
- [Connection Problems](#connection-problems)
- [Serial Port Issues](#serial-port-issues)
- [Channel Configuration](#channel-configuration)
- [APRS Issues](#aprs-issues)
- [NexNet Problems](#nexnet-problems)
- [WebSocket Disconnects](#websocket-disconnects)
- [BBS Issues](#bbs-issues)
- [IGate Problems](#igate-problems)
- [Performance Issues](#performance-issues)
- [Log Analysis](#log-analysis)
- [Debugging Tips](#debugging-tips)
- [Getting Help](#getting-help)

---

## Authentication Issues

### 401 Unauthorized Error

**Symptoms:**
- API requests return 401 status
- Cannot access web UI
- "Unauthorized" or "Invalid password" messages

**Causes & Solutions:**

1. **Missing Authentication Header**
   ```bash
   # Wrong - no authentication
   curl http://localhost:3000/api/channels
   
   # Correct
   curl -H "X-UI-Password: your-password" http://localhost:3000/api/channels
   ```

2. **Wrong Password**
   - Default password is `admin`
   - Reset password by editing `server/config.json`:
     ```json
     {
       "uiPassword": "admin"
     }
     ```
   - Restart server after changing config

3. **Authentication Disabled in Config**
   - If `uiPassword` is `null` in config, authentication is disabled
   - WebSocket connections will still require auth message
   - Re-enable by setting a password in config.json

4. **Browser Cached Old Password**
   - Clear browser cache and cookies
   - Try incognito/private browsing mode
   - Hard refresh (Ctrl+F5 / Cmd+Shift+R)

---

## Connection Problems

### Cannot Connect to Web UI

**Symptoms:**
- Browser shows "Connection refused" or "Cannot connect"
- `http://localhost:3000` doesn't load

**Diagnostic Steps:**

1. **Check if server is running**
   ```bash
   # Linux
   sudo systemctl status nexdigi
   ps aux | grep node
   
   # Windows
   Get-Service nexdigi
   Get-Process node
   ```

2. **Check if port 3000 is listening**
   ```bash
   # Linux
   netstat -tlnp | grep 3000
   ss -tlnp | grep 3000
   
   # Windows
   netstat -ano | findstr :3000
   ```

3. **Check firewall**
   ```bash
   # Linux (ufw)
   sudo ufw status
   sudo ufw allow 3000/tcp
   
   # Linux (firewalld)
   sudo firewall-cmd --list-ports
   sudo firewall-cmd --add-port=3000/tcp --permanent
   sudo firewall-cmd --reload
   
   # Windows
   New-NetFirewallRule -DisplayName "NexDigi" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
   ```

4. **Check server logs**
   ```bash
   # Linux
   sudo journalctl -u nexdigi -n 100 --no-pager
   
   # Windows
   Get-Content C:\NexDigi\logs\nexdigi.log -Tail 100
   
   # Development
   npm run dev
   ```

### Remote Connection Issues

**Symptoms:**
- Can connect on localhost but not from other devices
- Works locally but not over network

**Solutions:**

1. **Server binding to localhost only**
   - Edit `server/index.js`:
     ```javascript
     // Wrong - only listens on localhost
     app.listen(3000, 'localhost');
     
     // Correct - listens on all interfaces
     app.listen(3000, '0.0.0.0');
     ```

2. **Router/firewall blocking**
   - Port forward 3000 on your router
   - Allow inbound connections in firewall
   - Check NAT configuration

3. **VPN or network policy**
   - Corporate networks may block custom ports
   - Try using port 80 or 443
   - Use reverse proxy (nginx, Apache)

---

## Serial Port Issues

### Permission Denied

**Symptoms:**
- Error: "Error: Error: Permission denied, cannot open /dev/ttyUSB0"
- Channel status shows "error" or "disconnected"

**Solutions:**

1. **Add user to dialout group (Linux)**
   ```bash
   sudo usermod -aG dialout $USER
   sudo usermod -aG dialout nexdigi  # if running as service
   
   # Verify membership
   groups
   groups nexdigi
   
   # Logout and login again, or restart service
   sudo systemctl restart nexdigi
   ```

2. **Check port permissions**
   ```bash
   ls -l /dev/ttyUSB*
   # Should show: crw-rw---- 1 root dialout
   
   # If not, set permissions
   sudo chmod 660 /dev/ttyUSB0
   sudo chown root:dialout /dev/ttyUSB0
   ```

3. **Create udev rule for persistent permissions**
   ```bash
   # Create /etc/udev/rules.d/99-nexdigi.rules
   sudo nano /etc/udev/rules.d/99-nexdigi.rules
   
   # Add this line (adjust vendorId and productId from lsusb):
   SUBSYSTEM=="tty", ATTRS{idVendor}=="067b", ATTRS{idProduct}=="2303", MODE="0660", GROUP="dialout"
   
   # Reload udev rules
   sudo udevadm control --reload-rules
   sudo udevadm trigger
   ```

### Serial Port Not Found

**Symptoms:**
- Error: "Error: Error: No such file or directory, cannot open /dev/ttyUSB0"
- Port doesn't appear in hardware list

**Diagnostic Steps:**

1. **List available serial ports**
   ```bash
   # Linux
   ls -l /dev/tty{USB,ACM}*
   dmesg | grep tty
   
   # Windows
   Get-WmiObject Win32_SerialPort | Select-Object Name, DeviceID
   mode
   ```

2. **Check if device is detected**
   ```bash
   # Linux - watch USB connection
   sudo dmesg -w
   # Then plug in USB device
   
   lsusb
   # Look for your TNC/serial adapter
   ```

3. **Install drivers**
   - **Prolific PL2303:** Usually built-in on Linux, may need driver on Windows
   - **FTDI:** Generally works out of the box
   - **CH340:** May need driver installation
   - **Windows:** Download from manufacturer website
   - **macOS:** May need FTDI or Prolific kext

4. **Try different USB port**
   - Some USB hubs don't work well with serial devices
   - Try direct connection to computer
   - Avoid USB 3.0 hubs if possible (use USB 2.0)

### Port Already in Use

**Symptoms:**
- Error: "Error: Error: Port is already open"
- Multiple instances trying to use same port

**Solutions:**

1. **Find process using port**
   ```bash
   # Linux
   sudo lsof /dev/ttyUSB0
   sudo fuser /dev/ttyUSB0
   
   # Kill the process
   sudo kill <PID>
   ```

2. **Common culprits**
   - ModemManager on Linux (disable it):
     ```bash
     sudo systemctl stop ModemManager
     sudo systemctl disable ModemManager
     ```
   - Direwolf or other APRS software
   - Multiple NexDigi instances
   - Serial terminal programs (minicom, screen, PuTTY)

3. **Check NexDigi config**
   - Make sure port isn't configured in multiple channels
   - Check for duplicate channel entries in config.json

---

## Channel Configuration

### Channel Won't Connect

**Symptoms:**
- Channel status stuck on "connecting" or shows "error"
- No frames received or transmitted

**Diagnostic Steps:**

1. **Serial TNC - Check cable connection**
   ```bash
   # Test serial port communication
   screen /dev/ttyUSB0 9600
   # Or
   minicom -D /dev/ttyUSB0 -b 9600
   
   # You should see TNC output or be able to send KISS commands
   ```

2. **KISS-TCP - Verify Direwolf/SoundModem is running**
   ```bash
   # Check if Direwolf is running
   ps aux | grep direwolf
   
   # Check if port 8001 is listening
   netstat -tlnp | grep 8001
   
   # Test connection
   telnet localhost 8001
   nc localhost 8001
   ```

3. **AGW - Check AGW server**
   - AGW Engine or Packet Engine Pro must be running
   - Default port is 8000
   - Check AGW server logs

4. **Incorrect baud rate**
   - Most TNCs use 9600 baud
   - Some use 1200, 19200, or 38400
   - Check your TNC manual

5. **Wrong port name**
   - Linux: `/dev/ttyUSB0`, `/dev/ttyACM0`, etc.
   - Windows: `COM3`, `COM4`, etc.
   - Use hardware API to list available ports

### No Frames Received

**Symptoms:**
- Channel connected but frame counter stays at zero
- Live viewer shows no activity

**Diagnostic Steps:**

1. **Check if radio is on**
   - Verify radio power and volume
   - Monitor frequency for activity
   - Use external scanner to confirm traffic

2. **Check TNC configuration**
   - KISS mode enabled on TNC
   - Correct audio levels
   - TNC LED indicators (DCD, TXD, RXD)

3. **Test with known traffic**
   - Use APRS.fi to see if there's activity on your frequency
   - Generate test traffic with another station
   - Use Direwolf to generate test frames

4. **Check frame filtering**
   - NexDigi doesn't filter by default
   - But digipeater or IGate settings might affect what you see
   - Check browser console for WebSocket messages

5. **Enable debug logging**
   - Edit `server/config.json`:
     ```json
     {
       "logging": {
         "level": "debug",
         "console": true,
         "file": true
       }
     }
     ```
   - Restart server and check logs

---

## APRS Issues

### Digipeater Not Working

**Symptoms:**
- Frames received but not digipeated
- WIDE1-1 or WIDE2-1 not processed

**Solutions:**

1. **Check digipeater settings**
   - Verify enabled: `GET /api/digipeater/settings`
   - Check WIDE settings:
     ```json
     {
       "enabled": true,
       "wideSettings": {
         "enabled": true,
         "fillIn": true,
         "maxN": 2
       }
     }
     ```

2. **Check path processing**
   - NexDigi only digipeats frames with WIDE1-1 or WIDEn-N in path
   - Fill-in mode: Only digipeats WIDE1-1 if no other digi has
   - Max hops prevents excessive propagation

3. **Rate limiting**
   - Default: 60 frames/minute
   - Exceeded frames are dropped silently
   - Check stats: `GET /api/digipeater/stats`

4. **Per-channel overrides**
   - Make sure channel isn't disabled for digipeating
   - Check `perChannelOverrides` in config

### Position Beacons Not Transmitting

**Symptoms:**
- IGate or digipeater enabled but no position beacons

**Solutions:**

1. **Check beacon settings**
   ```json
   {
     "igate": {
       "beacon": {
         "enabled": true,
         "interval": 600,
         "lat": 38.4512,
         "lon": -76.2345,
         "comment": "NexDigi IGate"
       }
     }
   }
   ```

2. **Verify callsign and SSID**
   - Must have valid callsign configured
   - SSID typically -10 for IGate, -1 for digipeater

3. **Check transmit channel**
   - At least one channel must have TX enabled
   - Check channel configuration

---

## NexNet Problems

### Peers Won't Connect

**Symptoms:**
- Peer status stuck on "connecting"
- Authentication failures in logs

**Diagnostic Steps:**

1. **Check network connectivity**
   ```bash
   # Ping peer
   ping 192.168.1.100
   
   # Test port connectivity
   telnet 192.168.1.100 3001
   nc -zv 192.168.1.100 3001
   ```

2. **Verify firewall rules**
   ```bash
   # Linux
   sudo ufw allow 3001/tcp
   sudo ufw status
   
   # Windows
   New-NetFirewallRule -DisplayName "NexDigi NexNet" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow
   ```

3. **Check public key exchange**
   - Both nodes must have each other's public keys
   - Keys are Ed25519 format: `ed25519:ABC123...`
   - Get your key: `GET /api/nexnet/status`
   - Verify peer key in config matches their public key

4. **Authentication failures**
   ```bash
   # Check logs for auth errors
   grep "authentication" logs/nexdigi.log
   
   # Common issues:
   # - Wrong public key configured
   # - Clock skew (>5 minutes difference)
   # - Replay attack detection (check timestamps)
   ```

5. **Clock synchronization**
   ```bash
   # Linux - check system time
   timedatectl
   
   # Enable NTP
   sudo timedatectl set-ntp true
   
   # Windows - sync time
   w32tm /resync
   ```

### Routes Not Propagating

**Symptoms:**
- Peers connected but routing table empty
- Messages not reaching destination

**Diagnostic Steps:**

1. **Check LSA flooding**
   ```bash
   # Enable debug logging
   # Check for "LSA" messages in logs
   grep "LSA" logs/nexdigi.log
   ```

2. **Verify hop limits**
   - Default max hops: 7
   - LSAs won't propagate beyond max hops
   - Check in NexNet settings

3. **Check peer authentication**
   - Routes only shared with authenticated peers
   - Unauthenticated peers don't participate in routing

4. **Network topology issues**
   - Hub mode: Spokes don't route between each other
   - Client mode: No routing, only direct to hub
   - Mesh mode: All nodes participate in routing

5. **View routing table**
   ```bash
   curl -H "X-UI-Password: your-password" \
     http://localhost:3000/api/nexnet/routes
   ```

### High Latency

**Symptoms:**
- Messages take long time to arrive
- NexNet UI shows high latency values

**Diagnostic Steps:**

1. **Check link latency**
   - Internet links: Usually <100ms
   - RF links: Can be several seconds
   - Satellite/HF: Can be 10+ seconds

2. **Diagnose path**
   ```bash
   # Check routing path
   curl -H "X-UI-Password: your-password" \
     http://localhost:3000/api/nexnet/routes | grep <destination>
   
   # Look for excessive hop count or slow links
   ```

3. **Queue depth**
   - Check NexNet stats for queue depth
   - High queue = congestion
   - May need to increase bandwidth or reduce traffic

4. **QoS configuration**
   - Low priority messages queue behind high priority
   - Adjust priority for time-sensitive traffic
   - See [NEXNET.md](NEXNET.md#quality-of-service)

### Message Loss

**Symptoms:**
- Messages sent but not received
- Intermittent delivery

**Diagnostic Steps:**

1. **Check queue depths**
   ```bash
   curl -H "X-UI-Password: your-password" \
     http://localhost:3000/api/nexnet/status
   
   # Look for queueDepth
   ```

2. **Rate limiting**
   - Default: 100 messages/minute
   - Exceeded messages are dropped
   - Increase limit or reduce traffic

3. **Message size**
   - Max message size: 8KB
   - Larger messages are rejected
   - Fragment large data

4. **RF link reliability**
   - Packet loss on RF can cause drops
   - Use lower data rates for better reliability
   - Add redundancy (multiple paths)

---

## WebSocket Disconnects

### Frequent Disconnections

**Symptoms:**
- WebSocket connection drops frequently
- Live updates stop working
- Must refresh browser to reconnect

**Causes & Solutions:**

1. **Missing heartbeat response**
   - Server sends heartbeat every 30 seconds
   - Client must respond with `pong`
   - Check browser console for heartbeat messages
   - Verify your client code responds to heartbeats

2. **Network instability**
   - WiFi connection dropping
   - VPN disconnecting
   - Firewall timing out idle connections
   - Use wired connection if possible

3. **Reverse proxy timeout**
   - nginx/Apache may timeout WebSocket connections
   - Increase proxy timeout:
     ```nginx
     # nginx
     proxy_read_timeout 300s;
     proxy_send_timeout 300s;
     ```

4. **Browser tab suspended**
   - Chrome suspends background tabs
   - Use "keep-alive" in tab
   - Or make NexDigi a PWA

### Authentication Required After Reconnect

**Symptoms:**
- WebSocket reconnects but shows "Unauthorized"
- Must reload page to authenticate

**Solution:**

Implement reconnection logic with re-authentication:

```javascript
let ws;
const PASSWORD = localStorage.getItem('password');

function connect() {
  ws = new WebSocket('ws://localhost:3000');
  
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'auth',
      password: PASSWORD
    }));
  };
  
  ws.onclose = () => {
    setTimeout(connect, 3000); // Reconnect after 3 seconds
  };
}

connect();
```

---

## BBS Issues

### Messages Not Saving

**Symptoms:**
- Post BBS message but it doesn't appear
- Message count doesn't increase

**Diagnostic Steps:**

1. **Check BBS data file**
   ```bash
   ls -lh server/data/bbs.json
   cat server/data/bbs.json
   ```

2. **File permissions**
   ```bash
   # Linux - should be writable by nexdigi user
   sudo chown nexdigi:nexdigi server/data/bbs.json
   sudo chmod 644 server/data/bbs.json
   ```

3. **Disk space**
   ```bash
   df -h
   ```

4. **Check retention policy**
   - Old messages may be auto-deleted
   - Check `retentionDays` in BBS config
   - Default: 30 days for bulletins

### BBS Session Timeout

**Symptoms:**
- Connected mode BBS session disconnects
- "Session timeout" message

**Solutions:**

1. **Increase session timeout**
   ```json
   {
     "bbs": {
       "sessionTimeout": 600
     }
   }
   ```

2. **Keep session active**
   - Send any command periodically
   - `L` (list) or `?` (help) every few minutes

---

## IGate Problems

### Not Connecting to APRS-IS

**Symptoms:**
- IGate status shows "disconnected"
- No frames from APRS-IS

**Diagnostic Steps:**

1. **Check APRS-IS server**
   ```bash
   # Test connection
   telnet rotate.aprs2.net 14580
   
   # Should see:
   # # logresp <callsign> unverified, server <server>
   ```

2. **Verify callsign and passcode**
   - Get passcode from https://apps.magicbug.co.uk/passcode/
   - Must match your callsign exactly
   - Passcode is case-sensitive (use uppercase callsign)

3. **Check filter string**
   - Invalid filter causes connection rejection
   - Test filter syntax
   - Start with simple filter: `r/38.45/-76.23/50`

4. **Firewall blocking port 14580**
   ```bash
   # Allow outbound APRS-IS
   sudo ufw allow out 14580/tcp
   ```

### Frames Not Gating to RF

**Symptoms:**
- IGate connected but no frames sent to RF
- IS-to-RF counter stays at zero

**Solutions:**

1. **Check TX enabled**
   ```json
   {
     "igate": {
       "txEnabled": false  // Change to true
     }
   }
   ```
   **Warning:** Only enable TX gate if you understand APRS gating rules!

2. **Verify message addressed to local RF**
   - IGate only gates messages for stations heard on RF
   - Check heard list in UI
   - Messages must be within filter radius

3. **Check rate limiting**
   - RF protection limits TX gating
   - Default: 10 frames/minute to RF
   - Prevents flooding RF channel

---

## Performance Issues

### High CPU Usage

**Symptoms:**
- Server process using 100% CPU
- UI sluggish or unresponsive

**Diagnostic Steps:**

1. **Check for busy loop**
   ```bash
   # Linux
   top -p $(pgrep -f nexdigi)
   
   # Windows
   Get-Process node | Sort-Object CPU -Descending
   ```

2. **Too many channels**
   - Each channel adds processing overhead
   - Disable unused channels
   - Use mock adapter for testing

3. **Frame processing backlog**
   - High traffic can cause backlog
   - Check frame queue in logs
   - May need more powerful hardware

4. **Debug logging enabled**
   - Debug logging is very verbose
   - Change to `info` or `warn` level
   - Restart server

### High Memory Usage

**Symptoms:**
- Node.js process using excessive RAM
- System swapping or OOM killer

**Diagnostic Steps:**

1. **Check memory usage**
   ```bash
   # Linux
   ps aux | grep node
   
   # Inside Node.js (development)
   const used = process.memoryUsage();
   console.log(used);
   ```

2. **Frame history accumulation**
   - Frame buffer may grow too large
   - Limit stored frames in config:
     ```json
     {
       "maxStoredFrames": 1000
     }
     ```

3. **WebSocket connections**
   - Each connected client uses memory
   - Limit concurrent connections
   - Close unused tabs

4. **Memory leak**
   - Restart server periodically
   - File bug report with details
   - Use `--inspect` flag and Chrome DevTools to profile

### Slow UI Loading

**Symptoms:**
- Web UI takes long time to load
- Pages lag or freeze

**Solutions:**

1. **Check network**
   - Use browser DevTools → Network tab
   - Look for slow-loading resources
   - Check server response times

2. **Large frame history**
   - Loading thousands of frames slows UI
   - Reduce limit in frame viewer
   - Use pagination

3. **Client build optimization**
   ```bash
   # Rebuild client with production optimizations
   cd client
   npm run build
   ```

4. **Browser cache**
   - Clear cache and hard reload
   - Disable browser extensions
   - Try different browser

---

## Log Analysis

### Log File Locations

**Linux (systemd service):**
```bash
sudo journalctl -u nexdigi -f
sudo journalctl -u nexdigi --since "1 hour ago"
sudo journalctl -u nexdigi -n 500 --no-pager
```

**Linux (manual install):**
```bash
# If configured in config.json
tail -f server/logs/nexdigi.log
less server/logs/nexdigi.log
```

**Windows (service):**
```powershell
Get-Content C:\NexDigi\logs\nexdigi.log -Wait -Tail 100
```

**Development:**
```bash
# Logs to console
npm run dev
```

### Log Levels

Configure in `server/config.json`:

```json
{
  "logging": {
    "level": "info",
    "console": true,
    "file": true
  }
}
```

Levels (most to least verbose):
- `debug` - Everything (very verbose)
- `info` - Normal operations
- `warn` - Warnings and errors
- `error` - Errors only

### Common Log Messages

**Successful start:**
```
[INFO] NexDigi server starting...
[INFO] Loading configuration from /opt/nexdigi/server/config.json
[INFO] Initializing channels...
[INFO] Channel 'VHF 144.39' (channel-1) connected
[INFO] Server listening on port 3000
```

**Authentication failure:**
```
[WARN] Authentication failed from 192.168.1.100
[WARN] Invalid password attempt
```

**Serial port error:**
```
[ERROR] Channel 'VHF 144.39' error: Error: Permission denied, cannot open /dev/ttyUSB0
[ERROR] Channel 'VHF 144.39' disconnected
```

**NexNet peer connected:**
```
[INFO] NexNet peer KB3ACZ-10 connected from 192.168.1.100:3001
[INFO] NexNet peer KB3ACZ-10 authenticated successfully
[INFO] Received LSA from KB3ACZ-10, updating routing table
```

**IGate connection:**
```
[INFO] IGate connecting to rotate.aprs2.net:14580
[INFO] IGate connected to noam.aprs2.net
[INFO] IGate login successful: KB3ACZ-10
```

---

## Debugging Tips

### Enable Debug Logging

```json
{
  "logging": {
    "level": "debug",
    "console": true,
    "file": true
  }
}
```

### Browser Developer Tools

1. **Console tab** - JavaScript errors and warnings
2. **Network tab** - API requests, WebSocket connection
3. **Application tab** - localStorage, cookies

### Test API Endpoints Manually

```bash
# System status
curl -H "X-UI-Password: admin" http://localhost:3000/api/system/status | jq

# List channels
curl -H "X-UI-Password: admin" http://localhost:3000/api/channels | jq

# NexNet peers
curl -H "X-UI-Password: admin" http://localhost:3000/api/nexnet/peers | jq
```

### Network Packet Capture

```bash
# Capture APRS-IS traffic
sudo tcpdump -i any -A 'port 14580'

# Capture NexNet traffic
sudo tcpdump -i any 'port 3001'

# Capture WebSocket traffic
sudo tcpdump -i any 'port 3000'
```

### Test WebSocket Connection

```javascript
// Open browser console and paste:
const ws = new WebSocket('ws://localhost:3000');
ws.onopen = () => console.log('Connected');
ws.onmessage = (e) => console.log('Message:', e.data);
ws.onerror = (e) => console.error('Error:', e);
ws.onclose = () => console.log('Disconnected');

// Authenticate
ws.send(JSON.stringify({ type: 'auth', password: 'admin' }));
```

### Verify Configuration Syntax

```bash
# Validate JSON
cat server/config.json | jq .

# If error, use JSONLint or similar
```

### Check for Conflicts

```bash
# Find processes using port 3000
sudo lsof -i :3000
sudo netstat -tlnp | grep 3000

# Find processes using port 3001 (NexNet)
sudo lsof -i :3001
```

### Reset to Default Configuration

```bash
# Backup current config
cp server/config.json server/config.json.backup

# Copy example config
cp server/config.example.json server/config.json

# Edit with your callsign
nano server/config.json

# Restart
sudo systemctl restart nexdigi
```

### Clean Reinstall

```bash
# Linux
sudo systemctl stop nexdigi
sudo rm -rf /opt/nexdigi
# Re-run installation script

# Windows
Stop-Service nexdigi
Remove-Item -Recurse -Force C:\NexDigi
# Re-run installation script
```

---

## Getting Help

### Before Asking for Help

1. **Check this troubleshooting guide**
2. **Review relevant documentation:**
   - [Installation Guide](INSTALL.md)
   - [Configuration Reference](CONFIGURATION.md)
   - [NexNet Guide](NEXNET.md)
   - [API Reference](API.md)
3. **Collect diagnostic information:**
   - Server logs
   - Configuration file (redact passwords)
   - Error messages (exact text)
   - Steps to reproduce
4. **Try minimal configuration**
   - Test with one channel only
   - Disable optional features
   - Use mock adapter to isolate hardware issues

### Diagnostic Information to Include

When reporting issues, include:

```
NexDigi Version: 1.0.0
Operating System: Ubuntu 22.04 / Windows 11 / macOS 13.0
Node.js Version: v18.19.0
Hardware: Raspberry Pi 4 / Desktop PC
TNC Type: Kenwood TM-D710 / Direwolf / SoundModem
Channel Type: Serial / KISS-TCP / AGW
Error Message: (exact text)
Steps to Reproduce: (detailed steps)
Configuration: (config.json, redact passwords)
Logs: (last 100 lines, redacted if needed)
```

### Report a Bug

**GitHub Issues:** https://github.com/yourusername/NexDigi/issues

Use this template:

```markdown
## Description
Brief description of the issue

## Steps to Reproduce
1. Step one
2. Step two
3. Step three

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Environment
- NexDigi Version: 
- OS: 
- Node.js Version: 
- Hardware: 

## Logs
```
(paste logs here)
```

## Configuration
```json
(paste relevant config, redact passwords)
```
```

### Get Community Support

- **GitHub Discussions:** General questions and discussions
- **Ham Radio Forums:** QRZ.com, eHam.net, Reddit r/amateurradio
- **Email:** support@nexdigi.example.com (if applicable)

### Feature Requests

Open an issue on GitHub with the "enhancement" label:

```markdown
## Feature Description
Clear description of the proposed feature

## Use Case
Why this feature is needed and how it would be used

## Proposed Implementation
(optional) Suggestions for how it could be implemented

## Alternatives Considered
(optional) Other approaches you've considered
```

---

## Additional Resources

- [Installation Guide](INSTALL.md)
- [Configuration Reference](CONFIGURATION.md)
- [NexNet Mesh Networking](NEXNET.md)
- [API Reference](API.md)
- [README](../README.md)

---

**Last Updated:** January 2024  
**Version:** 1.0.0
