# NexNet Mesh Networking Guide

Complete guide to NexNet, NexDigi's advanced mesh networking system.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Network Topologies](#network-topologies)
- [Getting Started](#getting-started)
- [Security](#security)
- [Routing](#routing)
- [Quality of Service](#quality-of-service)
- [Load Balancing](#load-balancing)
- [BBS Synchronization](#bbs-synchronization)
- [Weather Distribution](#weather-distribution)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

---

## Overview

NexNet is a self-healing mesh networking system designed for amateur radio packet networks. It provides:

- **Automatic Routing:** Dynamic path discovery using Dijkstra's algorithm
- **Multiple Transports:** RF (AX.25) and Internet (TCP) hybrid networks
- **Cryptographic Security:** Ed25519 public key authentication
- **Quality of Service:** 4-level priority queuing (Emergency → Low)
- **Load Balancing:** Multiple paths with automatic failover
- **Content Distribution:** BBS message sync, weather alerts, APRS data

### Key Features

✅ **Self-Healing:** Automatic route recalculation on link failure  
✅ **Hybrid Links:** Mix RF and Internet connections transparently  
✅ **Zero Configuration:** Automatic peer discovery and trust relationships  
✅ **Bandwidth Management:** QoS queuing and rate limiting  
✅ **Security:** Challenge-response authentication with replay protection  
✅ **Scalability:** Supports networks of 50+ nodes  

---

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│                      NexNet Node                        │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Backbone   │  │   Routing    │  │   Security   │ │
│  │   Manager    │←→│    Engine    │←→│   Manager    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│         ↑                  ↑                  ↑         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │     QoS      │  │     LSA      │  │     Mesh     │ │
│  │   Queuing    │  │   Flooding   │  │   Monitor    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
           ↓                                    ↓
    ┌─────────────┐                      ┌─────────────┐
    │  RF Links   │                      │ IP Links    │
    │  (AX.25)    │                      │  (TCP)      │
    └─────────────┘                      └─────────────┘
```

### Message Flow

1. **Application** generates message (BBS, weather, chat, etc.)
2. **QoS Manager** assigns priority queue
3. **Routing Engine** selects best path
4. **Security Manager** authenticates/encrypts
5. **Backbone Manager** transmits via RF or Internet
6. **Remote Node** receives, validates, and processes

---

## Network Topologies

### Mesh Mode (Peer-to-Peer)

Each node connects directly to multiple peers. Optimal for distributed networks.

```
       Node A
      /  |  \
     /   |   \
 Node B─Node C─Node D
     \   |   /
      \  |  /
       Node E
```

**Configuration:**
```json
{
  "nexnet": {
    "enabled": true,
    "mode": "mesh",
    "nodeId": "node-w4xyz",
    "peers": [
      {
        "nodeId": "node-w4abc",
        "type": "rf",
        "channel": "vhf-tnc"
      },
      {
        "nodeId": "node-k4def",
        "type": "internet",
        "host": "k4def.example.com",
        "port": 5000
      }
    ]
  }
}
```

**Best For:**
- Wide-area networks
- Multiple RF links
- High redundancy requirements
- Distributed architecture

### Hub Mode (Aggregation Point)

Central hub with multiple spoke nodes. Good for centralized services.

```
    Node B    Node C    Node D
       \        |        /
        \       |       /
         \      |      /
        Hub Node A (You)
         /      |      \
        /       |       \
       /        |        \
    Node E    Node F    Node G
```

**Configuration:**
```json
{
  "nexnet": {
    "enabled": true,
    "mode": "hub",
    "nodeId": "hub-w4xyz",
    "peers": [],
    "hubConfig": {
      "acceptConnections": true,
      "listenPort": 5000,
      "maxClients": 20,
      "requireAuth": true
    }
  }
}
```

**Best For:**
- Central BBS servers
- Weather distribution points
- Gateway nodes
- Simplified management

### Client Mode (Spoke Connection)

Connect to a hub node only. Simplest configuration.

```
         Hub Node
            |
            |
    Your Node (Client)
```

**Configuration:**
```json
{
  "nexnet": {
    "enabled": true,
    "mode": "client",
    "nodeId": "client-w4xyz",
    "peers": [
      {
        "nodeId": "hub-w4abc",
        "type": "internet",
        "host": "hub.w4abc.net",
        "port": 5000
      }
    ]
  }
}
```

**Best For:**
- Home stations
- Mobile nodes
- Simple deployments
- Learning NexNet

---

## Getting Started

### Step 1: Enable NexNet

Edit `server/config.json`:
```json
{
  "nexnet": {
    "enabled": true,
    "nodeId": "node-w4xyz",
    "mode": "mesh"
  }
}
```

Or via Web UI: Settings → NexNet → Enable

### Step 2: Generate Key Pair

NexNet automatically generates Ed25519 keys on first start. Keys are saved to `server/data/nexnet-keys.json`.

**Manual Generation:**
```bash
node server/tools/generate-nexnet-keys.js
```

View your public key:
```bash
cat server/data/nexnet-keys.json
```

### Step 3: Add Peers

**Via Web UI:**
1. Settings → NexNet → Peers
2. Click "Add Peer"
3. Enter Node ID, select transport (RF/Internet)
4. Save

**Via Config File:**
```json
{
  "nexnet": {
    "peers": [
      {
        "nodeId": "node-k4abc",
        "type": "internet",
        "host": "k4abc.example.com",
        "port": 5000,
        "publicKey": "their-public-key-here"
      }
    ]
  }
}
```

### Step 4: Exchange Public Keys

**Method 1: Manual Exchange**
1. Share your public key with peer (email, QSO, etc.)
2. Add peer's public key to your config
3. Both nodes add each other

**Method 2: Trust-on-First-Use (TOFU)**
```json
{
  "nexnet": {
    "security": {
      "trustOnFirstUse": true
    }
  }
}
```

⚠️ **Security Note:** TOFU is convenient but less secure. Use manual key exchange for sensitive networks.

### Step 5: Verify Connection

**Via Web UI:**
- NexNet → Status
- Check peer list for "Connected" status
- View topology map

**Via Logs:**
```bash
# Linux
journalctl -u nexdigi | grep NexNet

# Windows
Get-Content C:\NexDigi\nexdigi.log | Select-String "NexNet"
```

Look for:
```
[NexNet] Connected to peer: node-k4abc
[NexNet] Route established: node-k4abc -> 1 hop
```

---

## Security

NexNet uses **Ed25519 public key cryptography** for authentication.

### Key Generation

Keys are automatically generated on first start and stored in `server/data/nexnet-keys.json`:

```json
{
  "publicKey": "base64-encoded-public-key",
  "privateKey": "base64-encoded-private-key",
  "generated": "2025-10-17T12:34:56.789Z"
}
```

**⚠️ Important:**
- Backup your private key securely
- Never share your private key
- Public key can be shared freely
- Regenerating keys requires re-establishing all trust relationships

### Authentication Process

1. **Node A** initiates connection to **Node B**
2. **Node B** sends challenge (random nonce)
3. **Node A** signs challenge with private key
4. **Node B** verifies signature using Node A's public key
5. Connection established if signature valid

### Trust Relationships

**Explicit Trust (Recommended):**
```json
{
  "nexnet": {
    "security": {
      "enabled": true,
      "trustedNodes": [
        {
          "nodeId": "node-k4abc",
          "publicKey": "their-public-key",
          "added": "2025-10-17",
          "note": "Verified via QSO on 10/17"
        }
      ]
    }
  }
}
```

**Trust-on-First-Use (TOFU):**
```json
{
  "nexnet": {
    "security": {
      "enabled": true,
      "trustOnFirstUse": true,
      "autoSaveTrusted": true
    }
  }
}
```

### Security Features

- **Challenge-Response:** Prevents replay attacks
- **Timestamp Validation:** Rejects old messages (5-minute window)
- **Rate Limiting:** Max 10 auth attempts per minute
- **Session Timeout:** Re-authenticate after 24 hours
- **Nonce Tracking:** Prevents nonce reuse

### Disabling Security (NOT RECOMMENDED)

For testing only:
```json
{
  "nexnet": {
    "security": {
      "enabled": false
    }
  }
}
```

⚠️ **WARNING:** Disabling security allows anyone to join your network!

---

## Routing

NexNet uses **Link State Routing** with **Dijkstra's shortest path algorithm**.

### How It Works

1. **Link State Advertisements (LSA):**
   - Each node broadcasts its neighbors every 60 seconds
   - LSAs flood to all nodes (max 3 hops)

2. **Topology Map:**
   - Each node builds complete network topology
   - Calculates shortest path to every destination

3. **Route Selection:**
   - Dijkstra's algorithm finds optimal path
   - Considers link cost (hop count, bandwidth, latency)

4. **Automatic Updates:**
   - Link failures detected via heartbeat timeout
   - Topology recalculated automatically
   - New routes propagated within seconds

### Routing Metrics

**Hop Count (Default):**
```json
{
  "nexnet": {
    "routing": {
      "metricType": "hop-count"
    }
  }
}
```

**Bandwidth:**
```json
{
  "nexnet": {
    "routing": {
      "metricType": "bandwidth",
      "linkCapacity": {
        "rf": 1200,
        "internet": 100000
      }
    }
  }
}
```

**Latency:**
```json
{
  "nexnet": {
    "routing": {
      "metricType": "latency",
      "measureInterval": 60
    }
  }
}
```

### Route Preferences

**Prefer Internet Links:**
```json
{
  "nexnet": {
    "routing": {
      "preferInternet": true,
      "internetCostMultiplier": 0.5
    }
  }
}
```

**Prefer RF Links:**
```json
{
  "nexnet": {
    "routing": {
      "preferRF": true,
      "rfCostMultiplier": 0.5
    }
  }
}
```

### Static Routes

Override automatic routing for specific destinations:
```json
{
  "nexnet": {
    "routing": {
      "staticRoutes": [
        {
          "destination": "node-k4abc",
          "nextHop": "node-w4def",
          "priority": 10
        }
      ]
    }
  }
}
```

---

## Quality of Service

NexNet implements **4-level priority queuing** for traffic management.

### Priority Levels

| Level | Name | Use Case | Default Rate Limit |
|-------|------|----------|-------------------|
| 4 | Emergency | TOR/SVR/FFW weather | 10 pkt/min |
| 3 | High | Bulletins, urgent messages | 30 pkt/min |
| 2 | Normal | Standard traffic, BBS sync | 60 pkt/min |
| 1 | Low | Routine beacons, bulk data | 120 pkt/min |

### Configuration

```json
{
  "nexnet": {
    "qos": {
      "enabled": true,
      "queues": {
        "emergency": {
          "priority": 4,
          "rateLimit": 10,
          "maxQueueSize": 50
        },
        "high": {
          "priority": 3,
          "rateLimit": 30,
          "maxQueueSize": 100
        },
        "normal": {
          "priority": 2,
          "rateLimit": 60,
          "maxQueueSize": 200
        },
        "low": {
          "priority": 1,
          "rateLimit": 120,
          "maxQueueSize": 500
        }
      },
      "tokenBucket": {
        "enabled": true,
        "refillRate": 10,
        "maxTokens": 50
      }
    }
  }
}
```

### Traffic Classification

**Automatic Classification:**
- Weather Alerts (TOR/SVR/FFW) → Emergency
- BBS Bulletins → High
- Personal Messages → Normal
- APRS Beacons → Low

**Manual Classification:**
```javascript
// In your application code
nexnet.send({
  destination: 'node-k4abc',
  data: messageData,
  priority: 'high'
});
```

### Bandwidth Management

**Token Bucket Algorithm:**
- Tokens refill at constant rate
- Each packet consumes tokens
- Queue blocks when tokens exhausted
- Prevents bursts from overwhelming network

**Configuration:**
```json
{
  "nexnet": {
    "qos": {
      "tokenBucket": {
        "enabled": true,
        "refillRate": 10,
        "maxTokens": 50,
        "tokensPerPacket": 1
      }
    }
  }
}
```

---

## Load Balancing

NexNet supports **multiple paths** to the same destination with automatic failover.

### Load Balancing Algorithms

**Round-Robin (Default):**
```json
{
  "nexnet": {
    "loadBalancing": {
      "algorithm": "round-robin",
      "enabled": true
    }
  }
}
```

**Least-Loaded:**
```json
{
  "nexnet": {
    "loadBalancing": {
      "algorithm": "least-loaded",
      "enabled": true,
      "considerQueueDepth": true
    }
  }
}
```

**Weighted:**
```json
{
  "nexnet": {
    "loadBalancing": {
      "algorithm": "weighted",
      "enabled": true,
      "weights": {
        "internet": 80,
        "rf": 20
      }
    }
  }
}
```

### Failover Configuration

```json
{
  "nexnet": {
    "loadBalancing": {
      "failover": {
        "enabled": true,
        "threshold": 3,
        "timeout": 30,
        "healthCheck": {
          "enabled": true,
          "interval": 10,
          "maxFailures": 3
        }
      }
    }
  }
}
```

**Parameters:**
- `threshold`: Max failed attempts before failover
- `timeout`: Seconds to wait for response
- `interval`: Seconds between health checks
- `maxFailures`: Consecutive failures to mark link down

### Example: Dual-Path Configuration

```json
{
  "nexnet": {
    "peers": [
      {
        "nodeId": "node-k4abc",
        "type": "internet",
        "host": "primary.k4abc.net",
        "port": 5000,
        "weight": 80
      },
      {
        "nodeId": "node-k4abc",
        "type": "rf",
        "channel": "vhf-tnc",
        "weight": 20
      }
    ],
    "loadBalancing": {
      "algorithm": "weighted",
      "enabled": true,
      "failover": {
        "enabled": true,
        "threshold": 2
      }
    }
  }
}
```

---

## BBS Synchronization

NexNet can automatically synchronize BBS messages across mesh nodes.

### Configuration

```json
{
  "nexnet": {
    "bbs": {
      "syncEnabled": true,
      "syncInterval": 300,
      "bulletinSync": true,
      "personalMessageSync": false,
      "conflictResolution": "vector-clock",
      "maxSyncAge": 86400
    }
  }
}
```

### Sync Process

1. **Periodic Sync:** Every 5 minutes (default)
2. **Query Remote Node:** "Messages since timestamp X"
3. **Receive Delta:** Only new/modified messages
4. **Conflict Resolution:** Use vector clocks
5. **Deduplicate:** Check message hash
6. **Import:** Add to local BBS

### Conflict Resolution

**Vector Clocks:**
```json
{
  "message": {
    "id": "msg-12345",
    "from": "W4ABC",
    "to": "W4XYZ",
    "subject": "Test",
    "body": "Message text",
    "vectorClock": {
      "node-w4abc": 5,
      "node-k4def": 3
    }
  }
}
```

**Latest Write Wins:**
```json
{
  "nexnet": {
    "bbs": {
      "conflictResolution": "latest-write"
    }
  }
}
```

### Selective Sync

Sync only specific bulletin categories:
```json
{
  "nexnet": {
    "bbs": {
      "syncEnabled": true,
      "syncCategories": ["WX", "INFO", "SALE"]
    }
  }
}
```

---

## Weather Distribution

Distribute NWS weather alerts across the mesh network.

### Configuration

```json
{
  "nexnet": {
    "weather": {
      "distributionEnabled": true,
      "floodingEnabled": true,
      "maxHops": 3,
      "deduplicationWindow": 300,
      "alertTypes": ["TOR", "SVR", "FFW"],
      "priority": "emergency"
    }
  }
}
```

### Distribution Process

1. **Local Node** receives NWS alert
2. **Parse & Format:** Extract critical info
3. **Flood to Mesh:** Send to all neighbors (max 3 hops)
4. **Deduplication:** Each node checks hash, drops duplicates
5. **Local Action:** Generate APRS bulletin, post to BBS

### Alert Priority

Emergency weather automatically uses highest priority queue:
```json
{
  "alertType": "TOR",
  "priority": "emergency",
  "qos": 4
}
```

---

## Monitoring

### Web UI Dashboard

**NexNet Status Page:**
- Settings → NexNet → Status
- Live topology map
- Peer connection status
- Traffic metrics
- Route table

### Metrics

**Real-Time:**
- Packets sent/received
- Queue depths by priority
- Link latency
- Route changes
- Failed authentication attempts

**Historical:**
- 5-minute aggregates
- Stored for 7 days
- Exportable to JSON/CSV

### CLI Monitoring

```bash
# View NexNet status
curl -H "X-UI-Password: your-password" http://localhost:3000/api/nexnet/status

# View peers
curl -H "X-UI-Password: your-password" http://localhost:3000/api/nexnet/peers

# View routes
curl -H "X-UI-Password: your-password" http://localhost:3000/api/nexnet/routes

# View metrics
curl -H "X-UI-Password: your-password" http://localhost:3000/api/nexnet/metrics
```

### Alerting

Configure alerts for network events:
```json
{
  "nexnet": {
    "alerting": {
      "enabled": true,
      "alerts": [
        {
          "type": "peer-down",
          "action": "log",
          "threshold": 3
        },
        {
          "type": "high-latency",
          "action": "webhook",
          "threshold": 5000,
          "url": "https://alerting.example.com/webhook"
        }
      ]
    }
  }
}
```

---

## Troubleshooting

### Peer Won't Connect

**Check 1: Network Connectivity**
```bash
# Test TCP connection
telnet peer-host 5000

# Or use nc
nc -zv peer-host 5000
```

**Check 2: Firewall**
```bash
# Linux - Allow NexNet port
sudo ufw allow 5000/tcp

# Windows
New-NetFirewallRule -DisplayName "NexNet" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow
```

**Check 3: Authentication**
- Verify public keys exchanged correctly
- Check for typos in config
- Review auth logs: `journalctl -u nexdigi | grep "Auth failed"`

### Routes Not Propagating

**Check LSA Flooding:**
```bash
# View routing table
curl http://localhost:3000/api/nexnet/routes

# Enable debug logging
# In config.json:
{
  "logging": {
    "level": "debug"
  }
}
```

**Common Causes:**
- Max hop limit reached (increase if needed)
- LSA interval too long (reduce from 60s)
- Link down (check peer status)

### High Latency

**Diagnose:**
```bash
# Check ping times
curl http://localhost:3000/api/nexnet/metrics | grep latency

# View per-peer metrics
curl http://localhost:3000/api/nexnet/peers/{nodeId}/metrics
```

**Solutions:**
- Switch to faster link (Internet vs RF)
- Enable QoS to prioritize critical traffic
- Reduce LSA flood frequency
- Check for network congestion

### Message Loss

**Check Queue Depths:**
```bash
curl http://localhost:3000/api/nexnet/queues
```

**Common Causes:**
- Queue full (increase maxQueueSize)
- Rate limit exceeded (increase rateLimit)
- Link down (check connectivity)
- Token bucket exhausted (increase refillRate)

**Solutions:**
```json
{
  "nexnet": {
    "qos": {
      "queues": {
        "normal": {
          "maxQueueSize": 500,
          "rateLimit": 120
        }
      },
      "tokenBucket": {
        "refillRate": 20,
        "maxTokens": 100
      }
    }
  }
}
```

### Security Issues

**Authentication Failures:**
```bash
# Check auth logs
journalctl -u nexdigi | grep "Authentication failed"
```

**Common Causes:**
- Mismatched public keys
- Clock skew (timestamps outside 5-minute window)
- Rate limit exceeded (too many auth attempts)

**Solutions:**
1. Verify public key exchange
2. Sync system clocks (use NTP)
3. Check rate limit settings

---

## Best Practices

### Network Design

1. **Redundancy:** Each node should have 2-3 peer connections
2. **Hub Placement:** Put hubs at network center, not edges
3. **Link Types:** Mix RF and Internet for resilience
4. **Hop Limits:** Keep networks under 5 hops for best performance

### Security

1. **Always enable authentication** in production
2. **Manually verify public keys** for high-security networks
3. **Backup private keys** securely
4. **Rotate keys annually** or after compromise

### Performance

1. **Use QoS** to prioritize critical traffic
2. **Tune rate limits** based on link capacity
3. **Monitor queue depths** regularly
4. **Enable load balancing** for multiple paths

### Operations

1. **Monitor peer status** daily
2. **Review logs** for errors/warnings
3. **Test failover** periodically
4. **Keep software updated**

---

## Advanced Topics

### Custom Message Types

Extend NexNet for custom applications:
```javascript
const nexnet = require('./lib/nexnet');

nexnet.registerHandler('custom-app', (message) => {
  console.log('Received custom message:', message);
  // Your processing logic
});

nexnet.send({
  type: 'custom-app',
  destination: 'node-k4abc',
  data: { custom: 'payload' }
});
```

### Performance Tuning

**High-Bandwidth Networks:**
```json
{
  "nexnet": {
    "qos": {
      "queues": {
        "normal": {
          "rateLimit": 300,
          "maxQueueSize": 1000
        }
      }
    },
    "routing": {
      "lsaInterval": 30
    }
  }
}
```

**Low-Bandwidth RF Networks:**
```json
{
  "nexnet": {
    "qos": {
      "queues": {
        "normal": {
          "rateLimit": 10,
          "maxQueueSize": 50
        }
      }
    },
    "routing": {
      "lsaInterval": 300
    }
  }
}
```

---

## Getting Help

- **Configuration Guide:** [CONFIGURATION.md](CONFIGURATION.md)
- **API Reference:** [API.md](API.md)
- **Troubleshooting:** [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- **GitHub Issues:** [https://github.com/na4wx/NexDigi/issues](https://github.com/na4wx/NexDigi/issues)
- **GitHub Discussions:** [https://github.com/na4wx/NexDigi/discussions](https://github.com/na4wx/NexDigi/discussions)

---

**Next Steps:**
- [Install NexDigi](INSTALL.md)
- [Configure Channels](CONFIGURATION.md#channel-configuration)
- [Set Up Security](NEXNET.md#security)
- [Monitor Your Network](NEXNET.md#monitoring)
