# NexNet Settings UI Reference

## Settings Page Structure

```
┌─────────────────────────────────────────────────────────────┐
│  NexNet Settings                                             │
└─────────────────────────────────────────────────────────────┘

╔═══════════════════════════════════════════════════════════╗
║  Basic Configuration                                       ║
╠═══════════════════════════════════════════════════════════╣
║  ☑ Enable NexNet                                          ║
║  Callsign: [W1ABC-10________________]                     ║
║  Services: [BBS] [Winlink] [APRS] [Weather] [Time]       ║
╚═══════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════╗
║  Internet Transport Mode                                   ║
╠═══════════════════════════════════════════════════════════╣
║  ☑ Enable Internet Transport                              ║
║  Mode: [🔗 Mesh (Peer-to-Peer)      ▼]                   ║
║  ℹ️ Mesh mode: Connect directly to configured peers      ║
║  Listen Port: [14240____]                                 ║
║  ☑ Enable TLS Encryption                                  ║
╚═══════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════╗
║  RF Transport (AX.25)                                      ║
╠═══════════════════════════════════════════════════════════╣
║  ☑ Enable RF Transport                                    ║
║  Channel: [VHF (KISS Serial)       ▼]                     ║
╚═══════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════╗
║  Routing Configuration                                     ║
╠═══════════════════════════════════════════════════════════╣
║  ☑ Prefer Internet over RF                                ║
║  Maximum Hops: [7____] (forwarding limit)                 ║
╚═══════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════╗
║  Quality of Service (QoS)                        ⭐ NEW   ║
╠═══════════════════════════════════════════════════════════╣
║  ☑ Enable QoS Priority Queuing                            ║
║  Bandwidth Limit: [10000__] bytes/sec (0=unlimited)       ║
║                                                            ║
║  Emergency Queue: [100___] Priority 0 (TOR/SVR/FFW)       ║
║  High Priority:   [200___] Priority 1 (bulletins/weather) ║
║  Normal Queue:    [500___] Priority 2 (standard traffic)  ║
║  Low Priority:    [1000__] Priority 3 (routine messages)  ║
╚═══════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════╗
║  Load Balancing                                  ⭐ NEW   ║
╠═══════════════════════════════════════════════════════════╣
║  ☑ Enable Load Balancing                                  ║
║  Algorithm: [⚖️ Weighted (Prefer Better Routes) ▼]       ║
║             [🔄 Round-Robin (Alternate Evenly)]           ║
║             [📊 Least-Loaded (Choose Least Used)]         ║
║  Failover Threshold: [3___] consecutive failures          ║
╚═══════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════╗
║  Mesh Self-Healing                               ⭐ NEW   ║
╠═══════════════════════════════════════════════════════════╣
║  ☑ Enable Mesh Self-Healing                               ║
║  LSA Broadcast Interval: [60___] seconds                  ║
║     (Link State Advertisement frequency)                  ║
║  Link Timeout:     [120__] seconds (declare link down)    ║
║  Discovery Timeout: [30___] seconds (wait for route)      ║
╚═══════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════╗
║  Security & Authentication                       ⭐ NEW   ║
╠═══════════════════════════════════════════════════════════╣
║  ☑ Enable Security                                        ║
║  🔐 Ed25519 public key cryptography with challenge-       ║
║     response authentication                               ║
║                                                            ║
║  Your Public Key:                                         ║
║  ┌───────────────────────────────────────────────────┐   ║
║  │302a300506032b6570032100a1b2c3d4e5f6...          │   ║
║  │...789abcdef0123456789abcdef01234567890            │   ║
║  └───────────────────────────────────────────────────┘   ║
║  [🔑 Generate New Keys]                                   ║
║                                                            ║
║  ─────────────────────────────────────────────────────    ║
║                                                            ║
║  Session Timeout: [300__] seconds (auth session)          ║
║  Max Auth Attempts: [5____] per minute (rate limit)       ║
║                                                            ║
║  ─────────────────────────────────────────────────────    ║
║                                                            ║
║  Trusted Nodes                      [+ Add Trusted Node]  ║
║  ┌────────────────────────────────────────────────────┐  ║
║  │ Callsign │ Public Key              │ Actions       │  ║
║  ├────────────────────────────────────────────────────┤  ║
║  │ W1DEF-5  │ 302a30050603...a1b2c3  │ [🗑️ Delete] │  ║
║  │ K2GHI-10 │ 302a30050603...d4e5f6  │ [🗑️ Delete] │  ║
║  └────────────────────────────────────────────────────┘  ║
╚═══════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════╗
║  Monitoring & Administration                     ⭐ NEW   ║
╠═══════════════════════════════════════════════════════════╣
║  ☑ Enable Monitoring                                      ║
║  Health Check Interval: [30___] seconds (check nodes)     ║
║  Aggregation Interval: [300__] seconds (historical data)  ║
║                                                            ║
║  Alert Thresholds:                                        ║
║  High Latency: [1000__] ms (alert when exceeds)           ║
║  High Packet Loss: [10____] % (alert when exceeds)        ║
╚═══════════════════════════════════════════════════════════╝

                            [Cancel]  [Save Settings]
```

## Dialog Examples

### Add Trusted Node Dialog
```
╔════════════════════════════════════════════════╗
║  Add Trusted Node                              ║
╠════════════════════════════════════════════════╣
║                                                ║
║  Callsign: [W1DEF-5_____________________]     ║
║                                                ║
║  Public Key:                                   ║
║  ┌──────────────────────────────────────────┐ ║
║  │302a300506032b6570032100a1b2c3d4e5f6...   │ ║
║  │...789abcdef0123456789abcdef0123456789     │ ║
║  │                                           │ ║
║  └──────────────────────────────────────────┘ ║
║  Paste the Ed25519 public key from the        ║
║  remote node                                   ║
║                                                ║
║                       [Cancel]  [Add]          ║
╚════════════════════════════════════════════════╝
```

### Key Generation Confirmation
```
╔════════════════════════════════════════════════╗
║  Confirm Key Generation                        ║
╠════════════════════════════════════════════════╣
║                                                ║
║  Generate new security keys?                   ║
║                                                ║
║  This will invalidate existing trusted node   ║
║  connections.                                  ║
║                                                ║
║                       [Cancel]  [Generate]     ║
╚════════════════════════════════════════════════╝
```

## Settings Categories Summary

| Category | Settings Count | Description |
|----------|----------------|-------------|
| **Basic Configuration** | 3 | Enable, callsign, services |
| **Internet Transport** | 5 | Enable, mode, port, TLS, peers/hub |
| **RF Transport** | 2 | Enable, channel selection |
| **Routing** | 2 | Internet preference, max hops |
| **QoS** ⭐ | 6 | Enable, bandwidth, 4 queue sizes, interval |
| **Load Balancing** ⭐ | 3 | Enable, algorithm, failover threshold |
| **Mesh Healing** ⭐ | 4 | Enable, LSA interval, link timeout, discovery timeout |
| **Security** ⭐ | 5+ | Enable, keys, session timeout, auth attempts, trusted nodes |
| **Monitoring** ⭐ | 5 | Enable, health interval, aggregation, 2 alert thresholds |

**Total Configurable Parameters**: 35+ settings

⭐ = New in this implementation (Phase 8-10 features)

## Feature Highlights

### Priority-Based Traffic Management
- **Emergency**: Tornado/severe weather warnings bypass all queues
- **High**: Weather bulletins and important messages prioritized
- **Normal**: Standard BBS messages and APRS traffic
- **Low**: Routine pings and status updates

### Intelligent Route Selection
- **Weighted**: Automatically prefers fast, reliable routes (87% vs 13% in tests)
- **Round-Robin**: Fair distribution for equal-quality routes
- **Least-Loaded**: Prevents route congestion by spreading traffic

### Self-Healing Network
- Automatic route discovery when links fail
- LSA broadcasts keep all nodes aware of network topology
- Dijkstra algorithm finds optimal paths through mesh

### Military-Grade Security
- Ed25519 elliptic curve cryptography (same as SSH)
- Challenge-response prevents replay attacks
- Rate limiting stops authentication flooding
- Per-node trust relationships

### Real-Time Monitoring
- Track latency, throughput, packet loss per node
- Automatic alerts for network issues
- Historical data for trend analysis
- Health status dashboard

## Usage Tips

1. **Start Simple**: Enable basic features first, test, then enable advanced features
2. **QoS Tuning**: Adjust queue sizes based on your traffic patterns
3. **Security**: Generate keys immediately if using Internet transport
4. **Monitoring**: Start with default thresholds, adjust based on your network performance
5. **Load Balancing**: Use "weighted" for most scenarios, "round-robin" for equal routes
6. **Mesh Healing**: Lower LSA interval for faster failover, higher for less overhead

## Integration with Existing NexNet Page

The main NexNet status page now shows:
- Current operating mode (🌐 Hub / 📡 Client / 🔗 Mesh)
- Number of connected neighbors
- Transport status (Internet/RF)
- Hub connection status (for client mode)
- Connected clients count (for hub mode)
- Service availability across the network

All settings are accessible via the "⚙️ Settings" button on the main NexNet page.
