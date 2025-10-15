# NexDigi Backbone Network Module

## Overview

The backbone module provides mesh networking capabilities for connecting multiple NexDigi nodes across RF (packet radio) and Internet transports. This enables distributed operations, message forwarding, service sharing, and resilient communications.

## Architecture

```
BackboneManager (coordinator)
    ├── RFTransport (AX.25 over packet radio)
    ├── InternetTransport (TCP/IP with TLS)
    └── PacketFormat (encoding/decoding)
```

## Quick Start

### 1. Configure Backbone

Edit `server/data/backboneSettings.json`:

```json
{
  "enabled": true,
  "localCallsign": "W1ABC-10",
  "transports": {
    "rf": {
      "enabled": true,
      "channelId": "channel-1",
      "services": ["bbs", "aprs-is"]
    },
    "internet": {
      "enabled": true,
      "port": 14240,
      "peers": [
        {
          "host": "node2.example.com",
          "port": 14240,
          "callsign": "W2DEF-10"
        }
      ]
    }
  }
}
```

### 2. Initialize in Your Application

```javascript
const BackboneManager = require('./lib/backbone/BackboneManager');
const channelManager = require('./lib/channelManager');

const backbone = new BackboneManager(channelManager);

// Initialize
await backbone.initialize();

// Listen for incoming data
backbone.on('data', (packet) => {
  console.log(`Received from ${packet.source}:`, packet.data.toString());
});

// Send data
const messageId = await backbone.sendData(
  'W2DEF-10',
  Buffer.from('Hello, world!'),
  { priority: Priority.NORMAL }
);

// Get status
const status = backbone.getStatus();
console.log('Neighbors:', status.neighbors);
console.log('Services:', status.services);
```

## Transport Types

### RF Transport

- Uses AX.25 protocol over packet radio
- Connected-mode (I-frames) for reliable delivery
- UI frames for broadcasts
- Automatic fragmentation for 200-byte MTU
- Integrates with existing ChannelManager

**Cost**: 500 (higher latency, lower bandwidth)

### Internet Transport

- TCP/IP with optional TLS encryption
- Default port: 14240
- Higher MTU: 8192 bytes
- Peer-to-peer architecture
- Automatic reconnection

**Cost**: 10 (lower latency, higher bandwidth)

## Packet Format

All backbone packets use a standardized format:

### Header (64 bytes)
- Version (1 byte)
- Type (1 byte): HELLO, LSA, DATA, ACK, etc.
- Flags (1 byte): COMPRESSED, ENCRYPTED, FRAGMENTED, URGENT
- Source/Destination callsigns (10 bytes each)
- Message ID (16 bytes)
- TTL, Priority, Payload length
- CRC16 checksum

### Routing Info (variable, TLV format)
- Via path
- Service type
- Cost metric

### Payload (variable)
- User data

## Packet Types

- **HELLO**: Node announcement with services offered
- **LSA**: Link State Advertisement (for routing)
- **DATA**: User data packet
- **ACK**: Acknowledgment
- **SERVICE_QUERY**: Request for service discovery
- **SERVICE_REPLY**: Response to service query
- **KEEPALIVE**: Connection health check
- **ERROR**: Error notification

## API Reference

### BackboneManager

#### Methods

- `initialize()` - Load config and start all transports
- `sendData(destination, data, options)` - Send data packet
- `getStatus()` - Get current backbone status
- `saveConfig()` - Save configuration to disk
- `shutdown()` - Gracefully shutdown all transports

#### Events

- `ready` - Backbone initialized and ready
- `data` - Incoming data packet
- `ack` - Acknowledgment received
- `neighbor-update` - Neighbor table updated

### Transport (Base Class)

#### Methods

- `connect(options)` - Connect to transport
- `disconnect()` - Disconnect from transport
- `send(destination, data, options)` - Send packet
- `isAvailable()` - Check if transport is ready
- `getCost()` - Get routing cost metric
- `getMTU()` - Get maximum transmission unit
- `getMetrics()` - Get performance metrics

#### Events

- `packet` - Incoming packet
- `connection` - New peer connected
- `disconnect` - Peer disconnected
- `error` - Transport error

### PacketFormat

#### Static Methods

- `encode(packet)` - Encode packet to Buffer
- `decode(buffer)` - Decode Buffer to packet
- `createHello(source, info)` - Create HELLO packet
- `createData(source, dest, data, options)` - Create DATA packet
- `createAck(source, dest, messageId)` - Create ACK packet

## Testing

Run the Phase 1 test suite:

```bash
cd server
node test_backbone_phase1.js
```

Tests include:
- Packet encoding/decoding
- HELLO packet creation
- DATA packet creation
- Large payload handling
- Checksum validation
- Routing info TLV encoding

## Current Status

**Phase 1: Foundation ✅ COMPLETE**
- Transport abstraction layer
- RF and Internet transports
- Packet format with CRC16
- BackboneManager coordinator
- Configuration system

**Phase 2: Routing ⬜ NOT STARTED**
- Link-state routing algorithm
- LSA flooding
- Shortest path calculation

**Phase 3: Service Discovery ⬜ NOT STARTED**
- Service query/reply protocol
- Gateway election
- Service-based routing

See `Backbone.md` for complete roadmap.

## Configuration Reference

### backboneSettings.json Schema

```typescript
{
  enabled: boolean;
  localCallsign: string;  // e.g., "W1ABC-10"
  transports: {
    rf: {
      enabled: boolean;
      channelId: string;  // Channel to use for backbone
      services: string[]; // Services offered via RF
    };
    internet: {
      enabled: boolean;
      port: number;       // Default: 14240
      bindAddress: string; // Default: "0.0.0.0"
      tls: boolean;       // Enable TLS encryption
      tlsOptions: {
        key: string;      // Path to private key
        cert: string;     // Path to certificate
        ca: string;       // Path to CA cert (optional)
      };
      peers: Array<{
        host: string;
        port: number;
        callsign: string;
      }>;
      services: string[];
    };
  };
  routing: {
    algorithm: "link-state";
    updateInterval: number; // ms, default: 300000 (5 min)
    maxHops: number;        // Default: 7
    preferInternet: boolean; // Prefer Internet over RF
  };
  services: {
    offer: string[];   // Services this node offers
    request: string[]; // Services this node needs
  };
}
```

## Future Phases

- **Phase 2**: Link-state routing with LSA flooding
- **Phase 3**: Service discovery and gateway election
- **Phase 4**: Message queuing and store-and-forward
- **Phase 5**: Content-based routing policies
- **Phase 6**: Performance optimization and load balancing
- **Phase 7**: Security (authentication, authorization)
- **Phase 8**: Monitoring and diagnostics
- **Phase 9**: Advanced features (compression, NAT traversal)
- **Phase 10**: Integration testing and deployment

## Contributing

When adding new features:
1. Update `Backbone.md` with design decisions
2. Write tests in `test_backbone_*.js`
3. Update this README with API changes
4. Mark completed tasks in `Backbone.md`

## License

See main project LICENSE file.
