# NexDigi Configuration Guide

Complete configuration reference for all NexDigi features.

---

## Table of Contents

- [Configuration File Overview](#configuration-file-overview)
- [Channel Configuration](#channel-configuration)
  - [Serial TNC](#serial-tnc)
  - [KISS-TCP](#kiss-tcp)
  - [AGW Protocol](#agw-protocol)
  - [Mock Adapter](#mock-adapter-testing)
- [APRS Digipeater](#aprs-digipeater)
- [IGate Configuration](#igate-configuration)
- [BBS Configuration](#bbs-configuration)
- [Winlink Gateway](#winlink-gateway)
- [Weather Alerts](#weather-alerts)
- [NexNet Mesh](#nexnet-mesh)
- [Advanced Settings](#advanced-settings)

---

## Configuration File Overview

The main configuration file is located at `server/config.json`. This file contains all server-side settings.

### Basic Structure

```json
{
  "callsign": "YOURCALL",
  "ssid": 1,
  "uiPassword": "changeme",
  "port": 3000,
  "location": {
    "latitude": 35.9132,
    "longitude": -79.0558,
    "altitude": 150
  },
  "channels": [],
  "digipeater": {},
  "igate": {},
  "bbs": {},
  "winlink": {},
  "weather": {},
  "nexnet": {}
}
```

### Hot Reload

Many configuration changes can be applied without restarting:
- Channel additions/modifications
- Digipeater settings
- IGate filters
- BBS settings

Changes requiring restart:
- Server port
- UI password
- Core callsign/SSID

---

## Channel Configuration

Channels define how NexDigi connects to your radio hardware. Multiple channels can operate simultaneously.

### Serial TNC

Connect to a TNC via serial port (USB, RS-232, etc.).

**Configuration:**
```json
{
  "channels": [
    {
      "id": "vhf-tnc",
      "name": "VHF 144.390 MHz",
      "type": "serial",
      "enabled": true,
      "port": "/dev/ttyUSB0",
      "baudRate": 9600,
      "kissMode": true,
      "txDelay": 300,
      "persistence": 63,
      "slotTime": 100,
      "txTail": 50,
      "duplex": false,
      "features": {
        "digipeater": true,
        "igate": true,
        "bbs": true,
        "chat": true
      }
    }
  ]
}
```

**Parameters:**
- `id`: Unique identifier for the channel
- `name`: Friendly name displayed in UI
- `type`: `"serial"` for serial TNCs
- `enabled`: `true` to activate channel
- `port`: Serial port device
  - Linux: `/dev/ttyUSB0`, `/dev/ttyAMA0`, `/dev/ttyS0`
  - Windows: `COM1`, `COM3`, etc.
  - macOS: `/dev/tty.usbserial-XXXX`
- `baudRate`: Serial baud rate (typically `9600` or `19200`)
- `kissMode`: `true` for KISS protocol (standard)
- `txDelay`: Transmit delay in 10ms units (300 = 3 seconds)
- `persistence`: CSMA persistence (0-255, typical: 63)
- `slotTime`: CSMA slot time in 10ms units
- `txTail`: TX tail time in 10ms units
- `duplex`: `false` for half-duplex, `true` for full-duplex

**Common TNCs:**
- **Kantronics KPC-3+:** 9600 baud, `/dev/ttyUSB0`
- **TNC-X:** 9600 baud, `/dev/ttyUSB0`
- **MFJ-1270:** 9600 baud, `/dev/ttyUSB0`
- **Mobilinkd TNC3:** Bluetooth (use KISS-TCP via bluetooth-serial bridge)

### KISS-TCP

Connect to software TNCs over TCP (Direwolf, SoundModem, etc.).

**Configuration:**
```json
{
  "channels": [
    {
      "id": "direwolf-vhf",
      "name": "Direwolf VHF",
      "type": "kiss-tcp",
      "enabled": true,
      "host": "localhost",
      "port": 8001,
      "reconnectDelay": 5000,
      "features": {
        "digipeater": true,
        "igate": true,
        "bbs": true,
        "chat": true
      }
    }
  ]
}
```

**Parameters:**
- `type`: `"kiss-tcp"` for KISS over TCP
- `host`: Hostname or IP address of KISS server
- `port`: TCP port number
  - Direwolf default: `8001`
  - SoundModem default: `8100`
- `reconnectDelay`: Milliseconds to wait before reconnecting

**Direwolf Setup:**

Edit `direwolf.conf`:
```
KISSPORT 8001
AGWPORT 8000
```

Start Direwolf:
```bash
direwolf -c /path/to/direwolf.conf
```

**SoundModem Setup:**
1. Open SoundModem
2. Settings → KISS → Enable "KISS Server"
3. Set port to `8100`
4. Configure NexDigi to connect to `localhost:8100`

### AGW Protocol

Connect to AGW-compatible applications (SoundModem, AGWPE).

**Configuration:**
```json
{
  "channels": [
    {
      "id": "soundmodem-agw",
      "name": "SoundModem AGW",
      "type": "agw",
      "enabled": true,
      "host": "localhost",
      "port": 8000,
      "radioPort": 0,
      "features": {
        "digipeater": true,
        "igate": false,
        "bbs": true,
        "chat": true
      }
    }
  ]
}
```

**Parameters:**
- `type`: `"agw"` for AGW protocol
- `host`: AGW server hostname
- `port`: AGW port (default: `8000`)
- `radioPort`: AGW radio port number (usually `0`)

**SoundModem AGW Setup:**
1. Settings → AGW → Enable "AGW Server"
2. Set port to `8000`
3. Configure NexDigi with matching settings

### Mock Adapter (Testing)

Simulate radio traffic without hardware. Useful for development and testing.

**Configuration:**
```json
{
  "channels": [
    {
      "id": "mock-test",
      "name": "Mock Channel (Testing)",
      "type": "mock",
      "enabled": true,
      "simulateTraffic": true,
      "trafficInterval": 30000,
      "features": {
        "digipeater": true,
        "igate": false,
        "bbs": true,
        "chat": true
      }
    }
  ]
}
```

**Parameters:**
- `type`: `"mock"` for simulated channel
- `simulateTraffic`: Generate fake APRS traffic
- `trafficInterval`: Milliseconds between simulated packets

---

## APRS Digipeater

Configure smart APRS digipeating with WIDEn-N path processing.

### Basic Configuration

```json
{
  "digipeater": {
    "enabled": true,
    "callsign": "YOURCALL",
    "ssid": 1,
    "aliases": ["WIDE1-1", "WIDE2-1"],
    "maxWide": 7,
    "substituteCall": true,
    "enableWide11FillIn": true,
    "duplicateWindow": 30,
    "rateLimit": {
      "enabled": true,
      "packetsPerMinute": 60,
      "burstSize": 10
    },
    "channels": {
      "vhf-tnc": {
        "enabled": true,
        "maxHops": 3,
        "substituteCall": true
      }
    }
  }
}
```

### Parameters Explained

**Global Settings:**
- `enabled`: Master enable/disable
- `callsign`: Your digipeater callsign
- `ssid`: SSID (typically 1-15)
- `aliases`: Path aliases to respond to
  - `WIDE1-1`: Fill-in digipeater (local coverage)
  - `WIDE2-1`: Regional coverage (2 hops)
- `maxWide`: Maximum WIDE value to process (prevents abuse)
- `substituteCall`: Replace alias with your callsign in path
- `enableWide11FillIn`: Act as WIDE1-1 fill-in digipeater
- `duplicateWindow`: Seconds to remember packets (prevent loops)

**Rate Limiting:**
- `enabled`: Enable rate limiting
- `packetsPerMinute`: Max packets to digipeat per minute
- `burstSize`: Allow brief bursts above limit

**Per-Channel Overrides:**
- `enabled`: Enable digipeating on this channel
- `maxHops`: Maximum hops remaining to digipeat
- `substituteCall`: Override global setting per channel

### Example: Fill-In Digipeater

Low-power digipeater for local coverage only:

```json
{
  "digipeater": {
    "enabled": true,
    "callsign": "W4XYZ",
    "ssid": 1,
    "aliases": ["WIDE1-1"],
    "maxWide": 1,
    "enableWide11FillIn": true,
    "substituteCall": true,
    "duplicateWindow": 30,
    "rateLimit": {
      "enabled": true,
      "packetsPerMinute": 30
    }
  }
}
```

### Example: Wide-Area Digipeater

High-site digipeater with regional coverage:

```json
{
  "digipeater": {
    "enabled": true,
    "callsign": "W4XYZ",
    "ssid": 1,
    "aliases": ["WIDE1-1", "WIDE2-1", "WIDE2-2"],
    "maxWide": 7,
    "enableWide11FillIn": false,
    "substituteCall": true,
    "duplicateWindow": 60,
    "rateLimit": {
      "enabled": true,
      "packetsPerMinute": 120,
      "burstSize": 20
    }
  }
}
```

---

## IGate Configuration

Bridge between RF and APRS-IS (internet).

### Basic Configuration

```json
{
  "igate": {
    "enabled": true,
    "callsign": "YOURCALL",
    "ssid": 10,
    "passcode": 12345,
    "server": "rotate.aprs2.net",
    "port": 14580,
    "useTLS": true,
    "filter": "r/35.9/-79.0/50 b/W4* t/poimqstunw",
    "beaconInterval": 1800,
    "rfToIs": {
      "enabled": true,
      "rateLimit": 60,
      "filterDuplicates": true,
      "requireValidPosition": true
    },
    "isToRf": {
      "enabled": false,
      "rateLimit": 10,
      "channels": []
    }
  }
}
```

### Parameters Explained

**Connection:**
- `enabled`: Master enable/disable
- `callsign`: Your APRS-IS callsign
- `ssid`: SSID for APRS-IS (typically 10 for IGate)
- `passcode`: Your APRS-IS passcode (generate at aprs.fi)
- `server`: APRS-IS server hostname
  - North America: `noam.aprs2.net`
  - Rotating: `rotate.aprs2.net`
  - Specific tier2: `t2usa.aprs2.net`
- `port`: APRS-IS port
  - Standard: `14580`
  - TLS: `14581`
- `useTLS`: Use encrypted connection (recommended)

**Filtering:**
- `filter`: APRS-IS server-side filter
  - `r/lat/lon/radius`: Range filter (km)
  - `b/call*`: Budlist filter
  - `t/types`: Message types
  - See [APRS-IS Filter Guide](http://www.aprs-is.net/javAPRSFilter.aspx)

**RF → APRS-IS:**
- `enabled`: Gate RF traffic to internet
- `rateLimit`: Max packets per minute to APRS-IS
- `filterDuplicates`: Suppress duplicate packets
- `requireValidPosition`: Only gate packets with valid coordinates

**APRS-IS → RF:**
- `enabled`: Gate internet traffic to RF (⚠️ use carefully!)
- `rateLimit`: Max packets per minute to RF
- `channels`: Array of channel IDs to gate to RF

**Beacon:**
- `beaconInterval`: Seconds between IGate status beacons

### APRS-IS Passcode Generation

Visit [https://apps.magicbug.co.uk/passcode/](https://apps.magicbug.co.uk/passcode/) and enter your callsign to generate a passcode.

### Example: RX-Only IGate

Safe configuration for receive-only operation:

```json
{
  "igate": {
    "enabled": true,
    "callsign": "W4XYZ",
    "ssid": 10,
    "passcode": 12345,
    "server": "rotate.aprs2.net",
    "port": 14581,
    "useTLS": true,
    "filter": "r/35.9/-79.0/100",
    "rfToIs": {
      "enabled": true,
      "rateLimit": 60,
      "filterDuplicates": true,
      "requireValidPosition": true
    },
    "isToRf": {
      "enabled": false
    }
  }
}
```

---

## BBS Configuration

Configure the built-in Bulletin Board System.

### Basic Configuration

```json
{
  "bbs": {
    "enabled": true,
    "callsign": "W4XYZ",
    "ssid": 8,
    "sysopCall": "W4XYZ",
    "welcomeMessage": "Welcome to W4XYZ BBS\nType H for help",
    "channels": ["vhf-tnc", "uhf-tnc"],
    "features": {
      "personalMessages": true,
      "bulletins": true,
      "connectedMode": true,
      "aprsMessages": true
    },
    "messageRetention": {
      "personalDays": 30,
      "bulletinDays": 14
    },
    "notifications": {
      "enabled": true,
      "interval": 3600,
      "maxNotifications": 3,
      "channels": ["vhf-tnc"]
    }
  }
}
```

### Parameters Explained

**Basic Settings:**
- `enabled`: Master enable/disable
- `callsign`: BBS callsign
- `ssid`: SSID (typically 8 for BBS)
- `sysopCall`: Sysop callsign for system messages
- `welcomeMessage`: Text shown on connect

**Access Methods:**
- `channels`: Array of channel IDs to accept connections
- `connectedMode`: Allow AX.25 connected mode sessions
- `aprsMessages`: Allow APRS UI-frame messaging

**Message Management:**
- `personalMessages`: Enable person-to-person messages
- `bulletins`: Enable bulletin messages
- `messageRetention`: Days to keep messages
  - `personalDays`: Personal message retention
  - `bulletinDays`: Bulletin retention

**Notifications:**
- `enabled`: Send notification beacons for new messages
- `interval`: Seconds between notifications
- `maxNotifications`: Max times to notify per message
- `channels`: Array of channels to send notifications

### BBS Commands

Users can access the BBS via:
1. **Connected Mode:** Connect to your BBS callsign-SSID
2. **APRS Messages:** Send message to BBS callsign

**Available Commands:**
- `H` or `HELP`: Show help
- `L` or `LIST`: List messages
- `R <num>`: Read message number
- `S <call>`: Send personal message
- `SB <category>`: Send bulletin
- `K <num>`: Kill/delete your message
- `B`: List bulletins
- `Q` or `BYE`: Disconnect

---

## Winlink Gateway

Configure Winlink CMS gateway functionality.

### Basic Configuration

```json
{
  "winlink": {
    "enabled": true,
    "callsign": "W4XYZ",
    "ssid": 10,
    "password": "your-winlink-password",
    "secure": "your-secure-login-password",
    "cmsServer": "server.winlink.org",
    "cmsPort": 8772,
    "useTLS": true,
    "channels": ["vhf-tnc"],
    "checkInterval": 600,
    "position": {
      "latitude": 35.9132,
      "longitude": -79.0558,
      "gridSquare": "FM05"
    },
    "features": {
      "pickup": true,
      "delivery": true,
      "statusBeacons": true
    }
  }
}
```

### Parameters Explained

**CMS Connection:**
- `enabled`: Master enable/disable
- `callsign`: Your Winlink callsign
- `ssid`: SSID for Winlink
- `password`: Winlink password (register at winlink.org)
- `secure`: Secure login password
- `cmsServer`: Winlink CMS server hostname
- `cmsPort`: CMS port (8772 for standard, 8773 for TLS)
- `useTLS`: Use encrypted connection

**Operations:**
- `channels`: Array of channel IDs for RMS access
- `checkInterval`: Seconds between CMS checks
- `pickup`: Check for outbound messages
- `delivery`: Deliver inbound messages
- `statusBeacons`: Send APRS position beacons

**Position:**
- `latitude`: Gateway latitude
- `longitude`: Gateway longitude
- `gridSquare`: Maidenhead grid square

### Winlink Registration

1. Visit [https://winlink.org/](https://winlink.org/)
2. Create account with your callsign
3. Request gateway password
4. Use credentials in NexDigi configuration

---

## Weather Alerts

Configure real-time NWS weather alert monitoring and distribution.

### Basic Configuration

```json
{
  "weather": {
    "enabled": true,
    "apiKey": "",
    "pollInterval": 300,
    "sameCodes": [
      "037063",
      "037183"
    ],
    "alertTypes": [
      "TOR",
      "SVR",
      "FFW",
      "WSW"
    ],
    "distribution": {
      "aprsBeacons": true,
      "bbsBulletins": true,
      "nexnetFlood": true,
      "channels": ["vhf-tnc"]
    },
    "formatting": {
      "prefix": "ALLWX",
      "maxLength": 67,
      "repeatExternal": false
    }
  }
}
```

### Parameters Explained

**NWS API:**
- `enabled`: Master enable/disable
- `apiKey`: NWS API key (optional, increases rate limit)
- `pollInterval`: Seconds between API checks

**Filtering:**
- `sameCodes`: Array of SAME county codes to monitor
  - Find codes at [NWS SAME Codes](https://www.nws.noaa.gov/nwr/coverage/county_coverage.html)
- `alertTypes`: Array of alert product codes to distribute
  - `TOR`: Tornado Warning
  - `SVR`: Severe Thunderstorm Warning
  - `FFW`: Flash Flood Warning
  - `WSW`: Winter Storm Warning
  - `EWW`: Extreme Wind Warning
  - See [NWS Product Codes](https://www.weather.gov/media/pah/ServiceGuide/Alerts_Warnings.pdf)

**Distribution:**
- `aprsBeacons`: Send as APRS bulletins
- `bbsBulletins`: Post to BBS
- `nexnetFlood`: Distribute via NexNet mesh
- `channels`: Array of channels to send beacons

**Formatting:**
- `prefix`: APRS bulletin prefix (ALLWX, BLN, etc.)
- `maxLength`: Maximum bulletin length (67 chars for APRS)
- `repeatExternal`: Re-beacon external weather bulletins

### SAME Code Examples

**North Carolina:**
- Wake County: `037183`
- Mecklenburg County: `037119`
- Durham County: `037063`

**Virginia:**
- Fairfax County: `051059`
- Arlington County: `051013`

---

## NexNet Mesh

Configure advanced mesh networking. See [NEXNET.md](NEXNET.md) for complete guide.

### Quick Start

```json
{
  "nexnet": {
    "enabled": true,
    "nodeId": "node-w4xyz",
    "mode": "mesh",
    "security": {
      "enabled": true,
      "keyPair": {
        "publicKey": "generated-on-first-start",
        "privateKey": "generated-on-first-start"
      },
      "trustedNodes": []
    },
    "routing": {
      "algorithm": "dijkstra",
      "metricType": "hop-count",
      "preferInternet": true
    },
    "qos": {
      "enabled": true,
      "queues": {
        "emergency": { "priority": 4, "rateLimit": 10 },
        "high": { "priority": 3, "rateLimit": 30 },
        "normal": { "priority": 2, "rateLimit": 60 },
        "low": { "priority": 1, "rateLimit": 120 }
      }
    },
    "peers": [],
    "channels": ["vhf-tnc", "uhf-tnc"]
  }
}
```

For complete NexNet documentation, see [NEXNET.md](NEXNET.md).

---

## Advanced Settings

### Logging

```json
{
  "logging": {
    "level": "info",
    "file": {
      "enabled": true,
      "path": "logs/nexdigi.log",
      "maxSize": "10m",
      "maxFiles": 5
    },
    "console": {
      "enabled": true,
      "colorize": true
    }
  }
}
```

**Log Levels:** `error`, `warn`, `info`, `verbose`, `debug`, `silly`

### Performance Tuning

```json
{
  "performance": {
    "cacheSize": 1000,
    "duplicateWindow": 30,
    "messageQueueSize": 500,
    "wsHeartbeat": 30000,
    "dbCleanupInterval": 3600
  }
}
```

### Web UI Settings

```json
{
  "ui": {
    "port": 3000,
    "uiPassword": "your-secure-password",
    "corsOrigins": ["*"],
    "rateLimit": {
      "windowMs": 900000,
      "maxRequests": 100
    }
  }
}
```

---

## Configuration via Web UI

Most settings can be configured through the web interface:

1. **Channels:** Settings → Channels
2. **Digipeater:** Settings → Digipeater
3. **IGate:** Settings → IGate
4. **BBS:** Settings → BBS
5. **Winlink:** Settings → Winlink
6. **Weather:** Settings → Weather
7. **NexNet:** Settings → NexNet

Changes made via UI are saved to `config.json` and applied immediately.

---

## Example Configurations

See the [examples/](../examples/) directory for complete configuration examples:

- `basic-digipeater.json` - Simple VHF digipeater
- `igate-only.json` - RX-only IGate
- `full-featured.json` - All features enabled
- `mesh-node.json` - NexNet mesh participant
- `headless-server.json` - Server without UI

---

## Configuration Validation

NexDigi validates configuration on startup. Common validation errors:

**Invalid JSON:**
```
Error: Unexpected token } in JSON at position 123
```
Fix: Check for missing commas, extra brackets, or syntax errors.

**Missing Required Fields:**
```
Error: Configuration missing required field: callsign
```
Fix: Add the required field to your config.

**Invalid Values:**
```
Error: Invalid port number: must be between 1024 and 65535
```
Fix: Use a valid value for the field.

---

## Getting Help

- **Installation Guide:** [INSTALL.md](INSTALL.md)
- **NexNet Guide:** [NEXNET.md](NEXNET.md)
- **API Reference:** [API.md](API.md)
- **Troubleshooting:** [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- **GitHub Issues:** [https://github.com/na4wx/NexDigi/issues](https://github.com/na4wx/NexDigi/issues)
