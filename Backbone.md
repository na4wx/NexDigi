# NexDigi Backbone Network Implementation

## Overview

The NexDigi Backbone Network provides a transport-agnostic mesh networking system that connects multiple NexDigi nodes via RF (packet radio) and/or Internet (TCP/IP). This enables message forwarding, service sharing, and distributed operations across wide geographic areas.

## Architecture

### Core Design Principles

1. **Transport Agnostic**: Protocol works over RF, Internet, or both simultaneously
2. **Intelligent Routing**: Link-state routing with path optimization based on transport type and content
3. **Service Discovery**: Distributed directory of node capabilities and services
4. **Resilient**: Automatic failover, partition tolerance, and recovery
5. **Scalable**: Support from 2 nodes to 100+ nodes
6. **Secure**: TLS encryption for Internet backbone (where legal), authentication between nodes

### Network Components

```
┌─────────────────────────────────────────────────────────────┐
│                    NexDigi Node                              │
├─────────────────────────────────────────────────────────────┤
│  Application Layer                                           │
│  ┌──────────┬──────────┬──────────┬──────────┐             │
│  │ Winlink  │   BBS    │ Weather  │  APRS    │             │
│  └──────────┴──────────┴──────────┴──────────┘             │
├─────────────────────────────────────────────────────────────┤
│  Backbone Manager (MeshManager)                             │
│  ┌────────────────────────────────────────────┐             │
│  │ • Routing Engine                            │             │
│  │ • Service Directory                         │             │
│  │ • Message Queue & Forwarding                │             │
│  │ • Topology Management                       │             │
│  └────────────────────────────────────────────┘             │
├─────────────────────────────────────────────────────────────┤
│  Transport Abstraction Layer                                │
│  ┌──────────────────┬──────────────────────────┐            │
│  │  RF Transport    │  Internet Transport      │            │
│  │  • AX.25         │  • TCP/IP + TLS          │            │
│  │  • KISS          │  • WebSocket (optional)  │            │
│  └──────────────────┴──────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### Node Types

1. **RF-Only Node**: Connects via packet radio only
2. **Internet-Only Node**: Connects via Internet only (e.g., CMS gateway, remote node)
3. **Hybrid Node**: Has both RF and Internet connectivity (acts as gateway)

### Example Network Topology

```
     [RF Mesh - Mountain Region]              [RF Mesh - Valley Region]
            Node A (RF)                              Node E (RF)
               |                                         |
            Node B (RF)                              Node F (RF)
               |                                         |
         Node C (RF+Internet)───────Internet────────Node G (RF+Internet)
               |                                         |
         [Internet Backbone]                      [Internet Backbone]
               └─────────────────┬─────────────────────┘
                                 |
                         Node D (Internet)
                       [CMS Gateway + Services]
```

---

## Implementation Roadmap

### Phase 1: Foundation & Transport Abstraction ✅ COMPLETE

**Goal**: Create the basic infrastructure for multi-transport backbone

#### 1.1 Transport Interface Design ✅
- [x] Define abstract `Transport` interface
  - Methods: `connect()`, `disconnect()`, `send()`, `isAvailable()`, `getCost()`, `getMTU()`
  - Event emitters for packet, connection, disconnect, error
- [x] Define backbone packet format specification
  - Header (64 bytes): version, type, flags, source, dest, msgID, TTL, priority, payload length, CRC16
  - Routing info: TLV format (via path, service type, cost metric)
  - Payload: variable length user data
- [x] Define packet types enum
  - HELLO, LSA, DATA, ACK, SERVICE_QUERY, SERVICE_REPLY, KEEPALIVE, ERROR

#### 1.2 RF Transport Implementation ✅
- [x] Create `RFTransport` class implementing Transport interface
- [x] Integrate with existing ChannelManager
- [x] AX.25 connected-mode (I-frames) for reliable delivery
- [x] AX.25 UI frames for broadcast (HELLO packets)
- [x] Use PID 0xF0 for backbone traffic
- [x] Configure backbone channel in settings
- [x] Session management (SABM/UA/DISC handling)
- [x] Packet fragmentation for MTU compliance (200 bytes)

#### 1.3 Internet Transport Implementation ✅
- [x] Create `InternetTransport` class implementing Transport interface
- [x] TCP server implementation (listen for peer connections on port 14240)
- [x] TCP client implementation (connect to configured peers)
- [x] TLS/SSL encryption support
  - Configurable via tlsOptions (key, cert, ca)
  - Mutual TLS authentication supported
- [x] Keep-alive via HELLO/KEEPALIVE packets
- [x] Connection state management
- [x] Length-prefixed packet framing (backbone packet header includes length)

#### 1.4 Multi-Transport Manager ✅
- [x] Create `BackboneManager` class
- [x] Manage multiple transports (RF + Internet)
- [x] Unified neighbor table with transport tracking
- [x] Packet routing to appropriate transport based on neighbor info and cost
- [x] Configuration structure for backbone settings (backboneSettings.json)
- [x] Message cache for duplicate detection
- [x] Service registry for tracking node capabilities
- [x] Periodic maintenance (cleanup stale neighbors, expired messages)

**Deliverables**: ✅ ALL COMPLETE
- ✅ `lib/backbone/Transport.js` - Base interface/class
- ✅ `lib/backbone/RFTransport.js` - RF implementation with AX.25 integration
- ✅ `lib/backbone/InternetTransport.js` - Internet implementation with TLS
- ✅ `lib/backbone/BackboneManager.js` - Main coordinator class
- ✅ `lib/backbone/PacketFormat.js` - Packet encoding/decoding with CRC16
- ✅ `server/data/backboneSettings.json` - Default configuration
- ✅ `server/test_backbone_phase1.js` - Unit tests (all passing)

---

### Phase 1.5: Hub-and-Spoke Mode (Central Server) ✅ COMPLETE

**Goal**: Add client/server mode to simplify deployment and improve NAT traversal

#### 1.5.1 Configuration Schema Updates ✅
- [x] Add `mode` field to Internet transport config
  - Values: `"mesh"` (default, P2P), `"server"` (hub), `"client"` (edge node)
- [x] Add `hubServer` configuration for client mode
  - `host`: Hub server hostname/IP
  - `port`: Hub server port
  - `callsign`: Hub server callsign
- [x] Add `hubServers` array for redundant hubs (optional)
- [x] Maintain backward compatibility (default to mesh mode)

#### 1.5.2 InternetTransport Mode Support ✅
- [x] Add mode-aware connection logic
  - Server mode: Only start TCP server, no outbound connections
  - Client mode: Only connect to hub(s), don't start TCP server
  - Mesh mode: Existing P2P behavior (start server + connect to peers)
- [x] Implement `_connectToHub()` method
  - Connect to primary hub
  - Automatic failover to secondary hubs if primary fails
  - Reconnection logic with exponential backoff (5s → 5min with jitter)
- [x] Update `_startServer()` to skip in client mode
- [x] Add mode indicator to connection logs

#### 1.5.3 Hub Routing & Relay Logic ✅
- [x] Update `BackboneManager._selectTransport()`
  - Client mode: Always route via hub for Internet destinations
  - Server mode: Direct routing to connected clients
- [x] Implement hub relay functionality
  - `_relayPacket()` method for hub to forward between clients
  - Relay packets when hub is neither source nor destination
  - Update metrics for relayed packets (packetsRelayed counter)
- [x] Add relay statistics to hub status
  - Total packets relayed
  - Connected clients count
  - Hub mode displayed in UI

#### 1.5.4 Client Discovery via Hub ✅
- [x] Hub maintains client registry
  - Map of callsign → client connection info + services
  - Extract services from client HELLO packets
  - `getClientRegistry()` returns all connected clients
- [x] Client receives peer list from hub
  - Hub sends periodic NEIGHBOR_LIST packets (every 30s)
  - Clients update neighbor table with hub-provided info
  - `_handleNeighborList()` processes hub updates
- [x] Hub-mediated service discovery
  - Hub aggregates services from all clients
  - Services included in neighbor list broadcasts
  - Clients learn about services via hub

#### 1.5.5 UI Updates ✅
- [x] Backbone.jsx status display enhancements
  - Display current mode (mesh/server/client) with colored badges
  - Show hub connection status for client mode (hub callsign, address)
  - Display hub statistics for server mode (connected clients, packets relayed, bandwidth, uptime)
  - Show "via hub" indicator for neighbors learned through hub discovery
- [x] BackboneSettings.jsx configuration page
  - Enable/disable backbone network
  - Configure local callsign and services (multi-select)
  - Select operating mode (mesh/client/server) with descriptions
  - Configure hub server for client mode with fallback support
  - Add/remove peers for mesh mode
  - Configure RF transport and channel selection
  - Routing preferences (prefer Internet, max hops slider)
- [x] API endpoint enhancements
  - Enhanced getStatus() to include mode-specific info
  - Existing /api/backbone routes support all features

#### 1.5.6 Integration Testing ✅
- [x] Comprehensive test suite (test_backbone_hub.js)
  - Hub startup and listening
  - Client connections to hub (3 clients)
  - HELLO packet exchange
  - Neighbor discovery via hub broadcasts
  - Service discovery across network
  - Client-to-client messaging through hub relay
  - Hub statistics validation
  - Bidirectional communication
- [x] **All 8 tests passing (100%)**
- [x] Validated NAT-friendly operation (clients don't need port forwarding)
- [x] Confirmed hub relay functionality with metrics tracking

#### 1.5.7 Hybrid Mode (Optional) ⬜ DEFERRED
- [ ] Support both hub and direct peer connections
- [ ] Configuration: `hubServers` + `directPeers` arrays
- [ ] Routing preference: Direct peers first, hub as fallback
- [ ] Use hub for discovery, direct links for efficiency
- *Note: Deferred to future enhancement. Current modes sufficient for most use cases.*

**Deliverables**: ✅ ALL COMPLETE
- ✅ Modified `lib/backbone/InternetTransport.js` (mode support, hub connection, relay)
- ✅ Modified `lib/backbone/BackboneManager.js` (hub relay logic, neighbor discovery)
- ✅ Modified `lib/backbone/PacketFormat.js` (NEIGHBOR_LIST packet type)
- ✅ Updated `server/data/backboneSettings.json` schema (mode, hubServer, hubServers)
- ✅ Updated `client/src/pages/Backbone.jsx` (mode display, hub status)
- ✅ Created `client/src/pages/BackboneSettings.jsx` (comprehensive settings page)
- ✅ Updated `client/src/App.jsx` (added BackboneSettings route)
- ✅ Hub configuration examples in backboneSettings.json (_examples section)
- ✅ Client configuration examples in backboneSettings.json (_examples section)
- ✅ Integration tests: `server/test_backbone_hub.js` (8/8 tests passing)

**Benefits**: ✅ ALL VALIDATED
- ✅ NAT-friendly: Clients don't need port forwarding (validated in tests)
- ✅ Simple setup: Clients only need hub address (configuration working)
- ✅ Centralized visibility: Hub sees all network activity (statistics tracked)
- ✅ Automatic discovery: Hub provides peer information (NEIGHBOR_LIST broadcasts)
- ✅ Familiar model: Similar to APRS-IS, Winlink CMS (operator-friendly)
- ✅ Backward compatible: Mesh mode remains default (no breaking changes)

**Test Results**: ✅ 100% PASSING
- ✅ Hub startup: Listening on port 14240
- ✅ Client connections: 3 clients connected successfully
- ✅ HELLO exchange: All nodes authenticated
- ✅ Neighbor discovery: Clients learned about each other via hub
- ✅ Service discovery: Services propagated across network
- ✅ Hub relay: Client-to-client messaging working (38 bytes relayed)
- ✅ Hub statistics: Metrics tracked correctly (packetsRelayed counter)
- ✅ Bidirectional communication: Messages flow both directions through hub

---

### Phase 2: Routing & Link-State Protocol ⬜

**Goal**: Implement automatic neighbor discovery and topology awareness

#### 2.1 Heartbeat Protocol ⬜
- [ ] Design heartbeat packet format
  - Node identity (callsign-SSID, unique ID)
  - Protocol version
  - Services offered (array: 'winlink-cms', 'bbs', 'aprs-is', 'weather', 'time')
  - Connected users (callsigns on local RF)
  - Link quality metrics
  - Timestamp
- [ ] Implement periodic heartbeat transmission
  - Configurable interval (default: 5 minutes)
  - Broadcast to all transports
  - Adaptive interval (more frequent during changes)
- [ ] Implement heartbeat reception
  - Update neighbor table
  - Extract node info (services, users, metrics)
  - Timestamp last seen

#### 2.2 Neighbor Management ⬜
- [ ] Neighbor table data structure
  - Key: node ID (callsign-SSID)
  - Data: last seen, transport(s), link quality, services, users, node info
- [ ] Neighbor timeout mechanism
  - Remove neighbor after X minutes of no heartbeat
  - Configurable timeout (default: 15 minutes)
- [ ] Multi-transport neighbor handling
  - Track which transport(s) can reach each neighbor
  - Aggregate link quality across transports
- [ ] Neighbor state change events
  - Emit events: neighbor_added, neighbor_lost, neighbor_updated
  - Trigger routing updates on topology changes

#### 2.3 Service Directory ⬜
- [ ] Service registry data structure
  - Map: service type → list of nodes offering that service
- [ ] Service announcement in heartbeat
- [ ] Service query API
  - `findServiceProvider(serviceType)` → list of nodes
  - `findClosestService(serviceType)` → node with lowest cost
- [ ] Service priority/capability levels
  - Nodes can advertise capability score (e.g., bandwidth, reliability)
  - Used for gateway election

**Deliverables**:
- `lib/backbone/Heartbeat.js` - Heartbeat protocol
- `lib/backbone/NeighborTable.js` - Neighbor management
- `lib/backbone/ServiceDirectory.js` - Service registry
- Configuration: heartbeat interval, timeout settings
- Tests for neighbor lifecycle

---

### Phase 3: Routing Engine ⬜

**Goal**: Implement intelligent link-state routing with multi-transport support

#### 3.1 Link-State Database ⬜
- [ ] Network topology data structure
  - Graph: nodes as vertices, links as edges
  - Edge properties: transport type, cost, quality, bandwidth
- [ ] Link-state packet format
  - Node's view of its direct links
  - Sequence number (for freshness)
  - Link metrics per neighbor
- [ ] Link-state propagation
  - Flood link-state updates on topology change
  - Sequence number tracking (ignore old updates)
  - TTL to prevent loops

#### 3.2 Routing Table Calculation ⬜
- [ ] Dijkstra's shortest path algorithm implementation
- [ ] Link cost calculation
  - Base cost by transport type (Internet=1, RF=10)
  - Adjust for link quality (SNR, packet loss)
  - Adjust for node congestion
  - Adjust for service-specific routing
- [ ] Routing table structure
  - Destination → (next hop, cost, path)
- [ ] Periodic recalculation (on topology changes)
- [ ] Multiple path support (ECMP - Equal Cost Multi-Path)

#### 3.3 Content-Based Routing Policies ⬜
- [ ] Define routing policy engine
- [ ] Policy rules configuration
  - `winlink_to_cms`: prefer Internet paths
  - `local_traffic`: prefer RF paths
  - `emergency`: prefer RF paths (Internet might be down)
  - `bulk_sync`: prefer Internet (high bandwidth)
- [ ] Policy-aware path selection
  - Select best path based on message type and policies
- [ ] Override mechanism for special cases

#### 3.4 Route Maintenance ⬜
- [ ] Route caching with TTL
- [ ] Route invalidation on link failure
- [ ] Alternate path calculation
- [ ] Route convergence optimization
  - Triggered updates on critical changes
  - Damping to prevent route flapping

**Deliverables**:
- `lib/backbone/LinkState.js` - Link-state protocol
- `lib/backbone/RoutingEngine.js` - Path calculation
- `lib/backbone/RoutingPolicy.js` - Policy engine
- `lib/backbone/TopologyGraph.js` - Network graph structure
- Configuration: routing policies, link costs
- Tests for routing algorithm correctness

---

### Phase 4: Message Forwarding & Reliability ⬜

**Goal**: Reliable packet delivery with priority handling

#### 4.1 Message Queue & Forwarding ⬜
- [ ] Priority queues per transport
  - Queues: EMERGENCY, HIGH, NORMAL, LOW
  - FIFO within each priority
- [ ] Message forwarding logic
  - Look up route in routing table
  - Select transport for next hop
  - Enqueue packet with appropriate priority
  - Send when transport available
- [ ] Message ID tracking for deduplication
  - Cache of recently seen message IDs
  - Configurable cache size and TTL
- [ ] TTL enforcement
  - Decrement TTL on each hop
  - Discard if TTL reaches 0

#### 4.2 Acknowledgment Protocol ⬜
- [ ] ACK packet format
- [ ] Selective ACK requirement
  - High-priority and Winlink messages require ACK
  - Low-priority may be fire-and-forget
- [ ] ACK timeout and retransmission
  - Exponential backoff (1s, 2s, 4s, 8s, ...)
  - Max retries (default: 5)
  - Mark route as failed after max retries
- [ ] NACK handling
  - Receiver sends NACK if can't process
  - Sender tries alternate path or gives up

#### 4.3 Fragmentation & Reassembly ⬜
- [ ] Packet fragmentation for large messages
  - Max packet size per transport (RF: 256 bytes, Internet: larger)
  - Fragment header: message ID, fragment number, total fragments
- [ ] Fragment reassembly at destination
  - Reassembly buffer per message ID
  - Timeout for incomplete messages
- [ ] Selective retransmission of lost fragments

#### 4.4 Congestion Management ⬜
- [ ] Queue depth monitoring
- [ ] Backpressure mechanism
  - Slow down sending if queues filling
  - Send SLOW signal to upstream nodes
- [ ] Low-priority packet dropping when congested
- [ ] Rate limiting per source node

**Deliverables**:
- `lib/backbone/MessageQueue.js` - Priority queuing
- `lib/backbone/Forwarder.js` - Message forwarding logic
- `lib/backbone/Reliability.js` - ACK/NACK, retransmission
- `lib/backbone/Fragmentation.js` - Large message handling
- Configuration: queue sizes, retry limits, timeouts
- Tests for reliability and congestion handling

---

### Phase 5: Winlink Integration ⬜

**Goal**: Enable Winlink message forwarding across backbone

#### 5.1 User Registry ⬜
- [ ] User home node concept
  - Each callsign has a "home node" where inbox resides
  - Registry: callsign → home node ID
- [ ] Home node advertisement
  - Nodes announce their local users in heartbeat
  - Build distributed user registry
- [ ] Home node assignment strategies
  - Static: Configured per user
  - Dynamic: Auto-assign to most frequently used node
  - Explicit: User selects home node

#### 5.2 Winlink Message Forwarding ⬜
- [ ] Detect Winlink message for non-local user
- [ ] Query user registry for home node
- [ ] Encapsulate Winlink message in backbone packet
  - Packet type: WINLINK_MESSAGE
  - Payload: Winlink B2F formatted message
  - Metadata: sender, recipient, priority
- [ ] Route to home node via backbone
- [ ] Deliver to local Winlink queue at home node
- [ ] ACK back to source node

#### 5.3 Store-and-Forward ⬜
- [ ] Message queue per user at home node
- [ ] Queue persistence (survive node restart)
- [ ] Notify user on connect (you have messages)
- [ ] Retrieve messages on demand
- [ ] Message expiration (configurable, e.g., 7 days)

#### 5.4 CMS Gateway Routing ⬜
- [ ] CMS gateway service announcement
- [ ] Route Winlink-to-CMS messages to gateway node
  - Prefer Internet path for speed
  - Gateway node forwards to real CMS
- [ ] Response routing back to origin node
- [ ] Gateway failover (multiple gateways, elect primary)

#### 5.5 User Roaming Support ⬜
- [ ] Detect user connecting to non-home node
- [ ] Proxy mode: Forward Winlink requests to home node
- [ ] Fetch user's inbox from home node
- [ ] Send new messages via home node
- [ ] Optional: Home node migration (move inbox to new node)

**Deliverables**:
- `lib/backbone/UserRegistry.js` - User/home node tracking
- `lib/backbone/WinlinkForwarder.js` - Winlink over backbone
- Extend `WinlinkManager` to use backbone for non-local users
- Configuration: home node settings, CMS gateway priority
- Tests for Winlink forwarding scenarios

---

### Phase 6: BBS Synchronization ⬜

**Goal**: Synchronize BBS messages across nodes

#### 6.1 BBS Sync Protocol ⬜
- [ ] Sync request/response packet format
  - Request: "Send me BBS messages since timestamp X"
  - Response: List of message IDs and metadata
- [ ] Message fetch protocol
  - Request specific messages by ID
  - Receive full message content
- [ ] Sync scheduling
  - Periodic sync (e.g., every 30 minutes)
  - Triggered sync on new message arrival
- [ ] Bandwidth-aware sync
  - Full sync over Internet
  - Incremental sync over RF

#### 6.2 Conflict Resolution ⬜
- [ ] Message versioning with timestamps
- [ ] Conflict detection
  - Two nodes have different versions of same message
- [ ] Resolution strategies
  - Last-write-wins (by timestamp)
  - Vector clocks for causality
  - Manual resolution for critical conflicts

#### 6.3 Selective Sync ⬜
- [ ] Configuration: Which BBS areas to sync
  - Sync all vs. selective areas
  - Per-node sync policies
- [ ] Area-specific sync schedules
- [ ] Bloom filters for efficient sync
  - "Do you have messages in area X since time Y?"
  - Reduce bandwidth for sync queries

#### 6.4 Message Deduplication ⬜
- [ ] Message ID uniqueness
  - Format: `node_id:timestamp:sequence`
  - Ensures global uniqueness
- [ ] Duplicate detection in BBS
- [ ] Storage optimization (don't store duplicates)

**Deliverables**:
- `lib/backbone/BBSSync.js` - BBS synchronization protocol
- Extend `BBS` class to use backbone sync
- Configuration: sync schedule, areas to sync
- Tests for sync and conflict resolution

---

### Phase 7: Weather & APRS Distribution ⬜

**Goal**: Distribute weather alerts and APRS data efficiently

#### 7.1 Weather Alert Distribution ⬜
- [ ] Weather alert packet format
  - Alert ID, type, severity, affected areas, text
- [ ] Alert origination
  - Node receives NWS alert (via API)
  - Encapsulate in backbone packet
  - Broadcast to all nodes
- [ ] Alert propagation
  - Controlled flooding (each node forwards once)
  - TTL and deduplication
  - Fast propagation (high priority)
- [ ] Alert caching at each node
  - Store active alerts
  - Broadcast on local RF at intervals
  - Clear expired alerts

#### 7.2 APRS Backbone Integration ⬜
- [ ] APRS packet forwarding options
  - Option A: Backbone as wide-area digipeater
  - Option B: Forward specific APRS packets (emergency, weather)
  - Option C: APRS-IS gateway at one node, distribute to others
- [ ] APRS packet filtering
  - Only forward interesting packets (not all local traffic)
  - Configurable filters by packet type
- [ ] APRS deduplication
  - Track APRS message IDs
  - Don't re-forward same packet

#### 7.3 Distributed APRS-IS Gateway ⬜
- [ ] Single APRS-IS connection at one (or more) nodes
- [ ] Distribute APRS-IS data to all nodes via backbone
- [ ] Each node gates relevant packets to local RF
- [ ] Reverse: Aggregate APRS from all nodes, single upload to APRS-IS

**Deliverables**:
- `lib/backbone/WeatherDistribution.js` - Weather alert protocol
- `lib/backbone/APRSBackbone.js` - APRS over backbone
- Extend `WeatherAlerts` and APRS modules
- Configuration: distribution policies
- Tests for alert propagation

---

### Phase 8: Security & Authentication ⬜

**Goal**: Secure Internet backbone, prevent unauthorized access

#### 8.1 TLS/SSL for Internet Transport ⬜
- [ ] Certificate generation per node
  - Self-signed or CA-signed certificates
  - Certificate management (renewal, revocation)
- [ ] Mutual TLS authentication
  - Server and client both present certificates
  - Verify peer certificate before accepting connection
- [ ] Certificate pinning (optional)
  - Trust specific certificates only
  - Protect against MITM attacks

#### 8.2 Node Authentication ⬜
- [ ] Authentication challenge-response
  - Challenge on connection: "Prove you are node X"
  - Response: Signed challenge with node's private key
- [ ] Shared secret authentication (simpler)
  - Configured secret per node
  - HMAC-based authentication
- [ ] Authentication failure handling
  - Reject unauthenticated connections
  - Log security events

#### 8.3 Message Integrity ⬜
- [ ] Message signing (optional)
  - Sign critical messages (Winlink, BBS from sysop)
  - Verify signature at destination
  - Detect tampering
- [ ] Checksum/CRC for all packets
  - Detect corruption
  - Discard corrupt packets

#### 8.4 Access Control ⬜
- [ ] Node whitelist/blacklist
  - Only allow connections from trusted nodes
  - Block known bad actors
- [ ] Service-level access control
  - Node X can use Winlink but not BBS
  - Configurable permissions per node

**Deliverables**:
- `lib/backbone/Security.js` - Authentication and encryption
- Certificate generation script
- Configuration: auth settings, trusted nodes
- Tests for security mechanisms

---

### Phase 9: Monitoring & Administration ⬜

**Goal**: Visibility and control over backbone network

#### 9.1 Network Health Monitoring ⬜
- [ ] Collect statistics at each node
  - Packets sent/received per transport
  - Routing table size
  - Queue depths
  - Link quality metrics
  - Error counts
- [ ] Expose stats via API
  - REST endpoints for stats retrieval
  - WebSocket for real-time updates
- [ ] Health status indicators
  - Green: All good
  - Yellow: Degraded (high latency, packet loss)
  - Red: Critical (link down, congestion)

#### 9.2 Topology Visualization ⬜
- [ ] Export topology data
  - Nodes list with positions (lat/lon if available)
  - Links between nodes with metrics
  - Format: JSON or GraphML
- [ ] Web UI for topology map
  - Visual graph of network
  - Show link quality (color-coded)
  - Show traffic flow (animated)
  - Click nodes for details

#### 9.3 Remote Management ⬜
- [ ] Management protocol over backbone
  - Packet type: MGMT_COMMAND
  - Authentication required
- [ ] Remote commands
  - Restart services
  - Update configuration
  - Fetch logs
  - Trace route to destination
  - Ping test
- [ ] Sysop access control
  - Only authorized callsigns can manage
  - Audit log of management actions

#### 9.4 Logging & Diagnostics ⬜
- [ ] Structured logging of backbone events
  - Neighbor up/down
  - Route changes
  - Packet forwarded/dropped
  - Errors and warnings
- [ ] Log levels (DEBUG, INFO, WARN, ERROR)
- [ ] Log rotation and archival
- [ ] Diagnostic tools
  - Traceroute: Show path to destination
  - Ping: Test reachability
  - Link test: Measure quality between two nodes

**Deliverables**:
- `lib/backbone/Monitoring.js` - Stats collection
- `lib/backbone/Management.js` - Remote admin protocol
- Web UI page for topology visualization
- API endpoints for monitoring data
- Configuration: logging settings, admin access
- Tests for monitoring and management

---

### Phase 10: Advanced Features & Optimization ⬜

**Goal**: Performance, scalability, and advanced use cases

#### 10.1 NAT Traversal ⬜
- [ ] Detect NAT'd nodes
  - Node can't accept incoming connections
  - Only outbound connections possible
- [ ] NAT-friendly mode
  - Node initiates connections to peers
  - Peers must have public IP or port forwarding
- [ ] Relay mechanism for fully NAT'd nodes
  - Third node acts as relay
  - NAT'd node connects to relay
  - Traffic routed through relay

#### 10.2 Directory Server (Optional) ⬜
- [ ] Central directory service
  - Nodes register with directory on startup
  - Directory provides peer list
- [ ] Directory protocol
  - Registration: Send node info to directory
  - Query: Get list of active nodes
  - Heartbeat to directory
- [ ] Fallback to static configuration
  - If directory unavailable, use configured peers
- [ ] Multiple directory servers for redundancy

#### 10.3 Load Balancing ⬜
- [ ] Distribute users across nodes
  - Balance RF load
  - Balance Winlink traffic
- [ ] Service load metrics
  - Track active connections, CPU, memory
  - Advertise load in heartbeat
- [ ] User assignment strategies
  - New user assigned to least-loaded node
  - Re-balance periodically

#### 10.4 Protocol Versioning ⬜
- [ ] Protocol version in all packets
- [ ] Backward compatibility
  - Support older protocol versions
  - Graceful degradation
- [ ] Version negotiation
  - Nodes agree on common protocol version
  - Use highest version both support
- [ ] Upgrade path
  - Incremental rollout of new versions
  - Test compatibility

#### 10.5 Performance Optimization ⬜
- [ ] Packet compression (for Internet transport)
  - Reduce bandwidth usage
  - Trade CPU for bandwidth
- [ ] Caching and memoization
  - Cache routing calculations
  - Cache service lookups
- [ ] Batch processing
  - Combine multiple small packets
  - Reduce overhead
- [ ] Zero-copy optimizations
  - Minimize buffer copies
  - Use streams where possible

**Deliverables**:
- `lib/backbone/NATTraversal.js` - NAT handling
- `lib/backbone/DirectoryClient.js` - Directory service integration
- `lib/backbone/LoadBalancer.js` - Load balancing logic
- `lib/backbone/Compression.js` - Packet compression
- Performance benchmarks and profiling
- Configuration: advanced features toggles
- Tests for edge cases

---

## Configuration Schema

### Backbone Configuration (`config.json`)

```json
{
  "backbone": {
    "enabled": true,
    "nodeId": "NA4WX-10",
    "location": {
      "latitude": 35.6854,
      "longitude": -83.9961,
      "elevation": 300,
      "grid": "EM85AP"
    },
    
    "rf": {
      "enabled": true,
      "channel": "radio2",
      "beaconInterval": 300000,
      "maxPacketSize": 256
    },
    
    "internet": {
      "enabled": true,
      "listenPort": 14240,
      "listenAddress": "0.0.0.0",
      "publicAddress": "node.example.com:14240",
      "peers": [
        {
          "nodeId": "W1XYZ-10",
          "address": "node1.example.com:14240",
          "priority": 1,
          "autoReconnect": true
        },
        {
          "nodeId": "K2ABC-10",
          "address": "192.168.1.50:14240",
          "priority": 2,
          "autoReconnect": true
        }
      ],
      "tls": {
        "enabled": true,
        "certPath": "./certs/node.crt",
        "keyPath": "./certs/node.key",
        "caPath": "./certs/ca.crt",
        "verifyPeer": true
      },
      "natMode": false,
      "maxPacketSize": 8192
    },
    
    "routing": {
      "algorithm": "link-state",
      "maxHops": 10,
      "updateInterval": 60000,
      "linkCosts": {
        "rf": 10,
        "internet": 1
      },
      "policies": {
        "winlink_to_cms": "prefer_internet",
        "local_traffic": "prefer_rf",
        "emergency": "prefer_rf",
        "bulk_sync": "prefer_internet"
      }
    },
    
    "services": {
      "offered": [
        "winlink-rms",
        "bbs",
        "weather",
        "aprs"
      ],
      "winlink": {
        "cmsGateway": false,
        "cmsHost": "server.winlink.org",
        "cmsPort": 8772
      },
      "bbs": {
        "sync": true,
        "syncInterval": 1800000,
        "syncAreas": ["general", "emergency", "weather"]
      },
      "weather": {
        "distribute": true,
        "broadcastInterval": 300000
      }
    },
    
    "reliability": {
      "ackRequired": ["winlink", "emergency"],
      "maxRetries": 5,
      "retryBackoff": [1000, 2000, 4000, 8000, 16000],
      "fragmentSize": {
        "rf": 200,
        "internet": 4096
      }
    },
    
    "qos": {
      "priorities": {
        "emergency": 0,
        "high": 1,
        "normal": 2,
        "low": 3
      },
      "queueSizes": {
        "emergency": 100,
        "high": 200,
        "normal": 500,
        "low": 1000
      }
    },
    
    "security": {
      "authentication": true,
      "whitelist": ["W1XYZ-10", "K2ABC-10"],
      "blacklist": [],
      "adminCallsigns": ["NA4WX"]
    },
    
    "monitoring": {
      "statsInterval": 60000,
      "logLevel": "info",
      "metricsEnabled": true
    }
  }
}
```

---

## Testing Strategy

### Unit Tests
- [ ] Packet encoding/decoding
- [ ] Routing algorithm correctness
- [ ] Message queue priority handling
- [ ] Fragmentation and reassembly
- [ ] Authentication mechanisms

### Integration Tests
- [ ] Two-node communication (RF only)
- [ ] Two-node communication (Internet only)
- [ ] Multi-hop routing (3+ nodes)
- [ ] Transport failover (Internet → RF)
- [ ] Service discovery
- [ ] Winlink message forwarding end-to-end

### Performance Tests
- [ ] Throughput (messages per second)
- [ ] Latency (end-to-end delay)
- [ ] Scalability (10, 50, 100 nodes)
- [ ] Convergence time (topology change → stable routes)
- [ ] Memory and CPU usage

### Resilience Tests
- [ ] Link failure recovery
- [ ] Node crash and rejoin
- [ ] Network partition and merge
- [ ] Message loss and retransmission
- [ ] Congestion handling

---

## Documentation

### User Documentation
- [ ] Backbone setup guide
- [ ] Configuration reference
- [ ] Troubleshooting guide
- [ ] FAQ

### Developer Documentation
- [ ] Architecture overview
- [ ] Protocol specification
- [ ] API reference
- [ ] Contributing guide

### Network Operations
- [ ] Network planning guide
- [ ] Deployment best practices
- [ ] Monitoring and maintenance
- [ ] Security hardening

---

## Progress Tracking

**Phase 1**: ✅ **COMPLETE** (Transport abstraction, RF/Internet transports, BackboneManager, packet format)  
**Phase 1.5**: ✅ **COMPLETE** (Hub-and-spoke mode with client/server/mesh modes, full testing)  
**Phase 2**: 🔄 **STARTING** (Routing & Link-State Protocol)  
**Phase 3**: ⬜ Not Started  
**Phase 4**: ⬜ Not Started  
**Phase 5**: ⬜ Not Started  
**Phase 6**: ⬜ Not Started  
**Phase 7**: ⬜ Not Started  
**Phase 8**: ⬜ Not Started  
**Phase 9**: ⬜ Not Started  
**Phase 10**: ⬜ Not Started  

**Overall Completion**: 19% (1.5/10.5 phases complete, Phase 2 starting)

---

## Notes

### Design Decisions Log

**Date**: 2025-10-15  
**Decision**: Use transport-agnostic design with RF and Internet support  
**Rationale**: Provides maximum flexibility and scalability. Hybrid nodes can bridge RF networks to Internet backbone.

**Date**: 2025-10-15  
**Decision**: Add hub-and-spoke mode (Phase 1.5) before routing implementation  
**Rationale**: Most amateur radio operators are behind NAT/firewalls and need simplified configuration. Hub-and-spoke aligns with familiar models (APRS-IS, Winlink CMS) and provides better operational visibility. Can coexist with mesh mode for advanced users.  
**Outcome**: Successfully implemented with 100% test coverage. Three modes (mesh/server/client) working correctly with automatic failover, neighbor discovery, and packet relay.

**Date**: 2025-10-15  
**Decision**: Link-state routing algorithm  
**Rationale**: Better convergence and flexibility compared to distance-vector. Scales well for expected network sizes (< 100 nodes).

**Date**: 2025-10-15  
**Decision**: TLS encryption for Internet backbone  
**Rationale**: Internet backbone is not amateur radio transmission, so encryption is legal and recommended for security.

**Date**: 2025-10-15  
**Decision**: Content-based routing policies  
**Rationale**: Different traffic types have different requirements. Winlink-to-CMS should prefer fast Internet paths, while emergency traffic should prefer resilient RF paths.

### Open Questions

- Should we implement multicast/broadcast over Internet (for weather alerts)? Or point-to-point only?
- NAT traversal: Implement STUN/TURN-like mechanism, or keep it simple with relay nodes?
- Protocol version: Start with v1 and iterate, or design for v2 from the beginning?
- Performance target: What's the expected message throughput? 10 msgs/sec? 100 msgs/sec?

### Future Enhancements (Post-v1)

- Mesh routing for APRS digipeating (WIDE1-1 becomes "send to all neighbors")
- Voice over backbone (compressed audio forwarding)
- Video streaming (low-res, for emergency operations)
- Integration with other ham radio protocols (D-STAR, DMR, etc.)
- Mobile node support (handle dynamic IP addresses, frequent topology changes)
- Satellite uplink support (backbone via satellite)

---

## References

- FBB Protocol Specification: http://www.f6fbb.org/protocole.html
- Winlink B2F Protocol: https://winlink.org/B2F
- OSPF Routing Protocol: RFC 2328
- AX.25 Protocol: https://www.tapr.org/pdf/AX25.2.2.pdf
- Link-State Routing: https://en.wikipedia.org/wiki/Link-state_routing_protocol

---

*This document is a living specification. Update as implementation progresses.*
