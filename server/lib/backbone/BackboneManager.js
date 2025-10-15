/**
 * BackboneManager.js
 * Central coordinator for backbone mesh networking
 * 
 * Manages multiple transports (RF, Internet), routing, and service discovery
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const RFTransport = require('./RFTransport');
const InternetTransport = require('./InternetTransport');
const { PacketFormat, PacketType, PacketFlags, Priority } = require('./PacketFormat');
const Heartbeat = require('./Heartbeat');
const NeighborTable = require('./NeighborTable');
const TopologyGraph = require('./TopologyGraph');
const RoutingEngine = require('./RoutingEngine');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../data/backboneSettings.json');

class BackboneManager extends EventEmitter {
  constructor(channelManager, configPath = DEFAULT_CONFIG_PATH) {
    super();
    this.channelManager = channelManager;
    this.configPath = configPath;
    this.config = null;
    this.transports = new Map(); // transportId -> Transport instance
    this.routingTable = new Map(); // destination -> { nextHop, cost, transport, lastUpdate }
    this.neighborTable = null; // Will be initialized in initialize()
    this.neighbors = new Map(); // DEPRECATED: Keeping for backward compatibility, use neighborTable instead
    this.services = new Map(); // serviceType -> Set of callsigns offering service
    this.messageCache = new Map(); // messageId -> { timestamp, delivered }
    this.localCallsign = '';
    this.enabled = false;
    this.heartbeat = null; // Will be initialized in initialize()
    this.topologyGraph = null; // Will be initialized in initialize()
    this.routingEngine = null; // Will be initialized in initialize()

    // Periodic maintenance
    this.maintenanceInterval = null;
    this.routingUpdateTimer = null;
  }

  /**
   * Initialize backbone system
   * @returns {Promise<void>}
   */
  async initialize() {
    console.log('[BackboneManager] Initializing...');

    // Load configuration
    await this._loadConfig();

    if (!this.config || !this.config.enabled) {
      console.log('[BackboneManager] Disabled in configuration');
      return;
    }

    this.enabled = true;
    this.localCallsign = this.config.localCallsign;

    // Initialize neighbor table
    this.neighborTable = new NeighborTable({
      timeout: this.config.neighborTimeout || 900000, // 15 minutes default
      cleanupInterval: this.config.neighborCleanupInterval || 60000 // 1 minute default
    });

    // Listen to neighbor events
    this.neighborTable.on('neighbor-added', (callsign, neighbor) => {
      console.log(`[BackboneManager] Neighbor added: ${callsign}`);
      this.emit('neighbor-added', callsign, neighbor);
      // Trigger routing table update
      this._triggerRoutingUpdate();
    });

    this.neighborTable.on('neighbor-removed', (callsign, neighbor, reason) => {
      console.log(`[BackboneManager] Neighbor removed: ${callsign} (${reason})`);
      this.emit('neighbor-removed', callsign, neighbor);
      // Trigger routing table update
      this._triggerRoutingUpdate();
    });

    this.neighborTable.on('neighbor-updated', (callsign, neighbor) => {
      this.emit('neighbor-updated', callsign, neighbor);
    });

    // Initialize heartbeat manager
    this.heartbeat = new Heartbeat({
      nodeId: this.localCallsign,
      interval: this.config.heartbeatInterval || 300000, // 5 minutes default
      timeout: this.config.neighborTimeout || 900000, // 15 minutes default
      getServices: () => this.config.services || [],
      getMetrics: () => this._collectMetrics()
    });

    // Listen to heartbeat events
    this.heartbeat.on('heartbeat', (heartbeatData) => {
      this._broadcastHeartbeat(heartbeatData);
    });

    // Initialize topology graph
    this.topologyGraph = new TopologyGraph();
    console.log('[BackboneManager] Topology graph initialized');

    // Initialize routing engine
    this.routingEngine = new RoutingEngine({
      localCallsign: this.localCallsign,
      policies: this.config.routing?.policies || {}
    });

    this.routingEngine.on('routes-updated', (routingTable) => {
      console.log(`[BackboneManager] Routing table updated: ${routingTable.size} routes`);
      this.emit('routes-updated', routingTable);
    });

    console.log('[BackboneManager] Routing engine initialized');

    // Initialize transports
    await this._initializeTransports();

    // Connect all transports
    await this._connectTransports();

    // Start maintenance tasks
    this._startMaintenance();

    console.log('[BackboneManager] Initialized successfully');
    this.emit('ready');
  }

  /**
   * Load configuration from file
   * @private
   */
  async _loadConfig() {
    try {
      console.log(`[BackboneManager] Loading config from: ${this.configPath}`);
      const data = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(data);
      console.log(`[BackboneManager] Configuration loaded, enabled: ${this.config.enabled}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Create default configuration
        console.log('[BackboneManager] Creating default configuration');
        this.config = this._getDefaultConfig();
        await this.saveConfig();
      } else {
        console.error(`[BackboneManager] Error loading config:`, error.message);
        throw error;
      }
    }
  }

  /**
   * Get default configuration
   * @private
   */
  _getDefaultConfig() {
    return {
      enabled: false,
      localCallsign: 'N0CALL-10',
      transports: {
        rf: {
          enabled: false,
          channelId: null,
          services: ['bbs', 'aprs-is']
        },
        internet: {
          enabled: false,
          port: 14240,
          bindAddress: '0.0.0.0',
          tls: true,
          peers: [],
          services: ['winlink-cms', 'bbs']
        }
      },
      routing: {
        algorithm: 'link-state',
        updateInterval: 300000, // 5 minutes
        maxHops: 7,
        preferInternet: true
      },
      services: {
        offer: ['bbs'],
        request: []
      }
    };
  }

  /**
   * Save configuration to file
   * @returns {Promise<void>}
   */
  async saveConfig() {
    await fs.writeFile(
      this.configPath,
      JSON.stringify(this.config, null, 2),
      'utf8'
    );
    console.log('[BackboneManager] Configuration saved');
  }

  /**
   * Initialize transport layers
   * @private
   */
  async _initializeTransports() {
    const { transports } = this.config;

    // Initialize RF transport
    if (transports.rf && transports.rf.enabled) {
      const rfConfig = {
        ...transports.rf,
        localCallsign: this.localCallsign
      };
      const rfTransport = new RFTransport(rfConfig, this.channelManager);
      this._setupTransportListeners(rfTransport, 'rf');
      this.transports.set('rf', rfTransport);
      console.log('[BackboneManager] RF transport initialized');
    }

    // Initialize Internet transport
    if (transports.internet && transports.internet.enabled) {
      const internetConfig = {
        ...transports.internet,
        localCallsign: this.localCallsign
      };
      const internetTransport = new InternetTransport(internetConfig);
      this._setupTransportListeners(internetTransport, 'internet');
      this.transports.set('internet', internetTransport);
      console.log('[BackboneManager] Internet transport initialized');
    }
  }

  /**
   * Setup listeners for a transport
   * @private
   */
  _setupTransportListeners(transport, transportId) {
    transport.on('packet', (packet) => {
      this._handlePacket(packet, transportId);
    });

    transport.on('connection', (peer) => {
      console.log(`[BackboneManager] New connection from ${peer} via ${transportId}`);
      this._updateNeighbor(peer, transportId);
    });

    transport.on('disconnect', (peer) => {
      console.log(`[BackboneManager] Disconnected from ${peer} via ${transportId}`);
      this._removeNeighbor(peer, transportId);
    });

    transport.on('error', (error) => {
      console.error(`[BackboneManager] Transport ${transportId} error:`, error.message);
    });
  }

  /**
   * Connect all transports
   * @private
   */
  async _connectTransports() {
    const promises = [];
    for (const [id, transport] of this.transports) {
      promises.push(
        transport.connect().catch(err => {
          console.error(`[BackboneManager] Failed to connect ${id} transport:`, err.message);
        })
      );
    }
    await Promise.all(promises);
  }

  /**
   * Handle incoming packet
   * @private
   */
  _handlePacket(packet, transportId) {
    const { type, messageId, source, destination } = packet;

    // Check message cache for duplicates
    if (this.messageCache.has(messageId)) {
      return; // Already processed
    }

    // Add to cache
    this.messageCache.set(messageId, {
      timestamp: Date.now(),
      delivered: false
    });

    // Handle by packet type
    switch (type) {
      case PacketType.HELLO:
        this._handleHello(packet, transportId);
        break;
      
      case PacketType.LSA:
        this._handleLSA(packet, transportId);
        break;
      
      case PacketType.DATA:
        this._handleData(packet, transportId);
        break;
      
      case PacketType.ACK:
        this._handleAck(packet, transportId);
        break;
      
      case PacketType.SERVICE_QUERY:
        this._handleServiceQuery(packet, transportId);
        break;
      
      case PacketType.SERVICE_REPLY:
        this._handleServiceReply(packet, transportId);
        break;
      
      case PacketType.KEEPALIVE:
        this._handleKeepalive(packet, transportId);
        break;
      
      case PacketType.NEIGHBOR_LIST:
        this._handleNeighborList(packet, transportId);
        break;
      
      default:
        console.log(`[BackboneManager] Unknown packet type: ${type}`);
    }
  }

  /**
   * Handle HELLO packet (node announcement)
   * @private
   */
  _handleHello(packet, transportId) {
    const { source, payload } = packet;
    
    try {
      const info = JSON.parse(payload.toString('utf8'));
      
      // Update neighbor information
      let neighbor = this.neighbors.get(source);
      if (!neighbor) {
        neighbor = {
          transports: [],
          lastSeen: Date.now(),
          services: []
        };
        this.neighbors.set(source, neighbor);
      }

      if (!neighbor.transports.includes(transportId)) {
        neighbor.transports.push(transportId);
      }
      neighbor.lastSeen = Date.now();
      neighbor.services = info.services || [];

      // Update services map
      for (const service of neighbor.services) {
        if (!this.services.has(service)) {
          this.services.set(service, new Set());
        }
        this.services.get(service).add(source);
      }

      console.log(`[BackboneManager] HELLO from ${source} via ${transportId}, services: ${neighbor.services.join(', ')}`);
      this.emit('neighbor-update', source, neighbor);

    } catch (error) {
      console.error('[BackboneManager] Failed to parse HELLO payload:', error.message);
    }
  }

  /**
   * Handle LSA packet
   * @private
   */
  _handleLSA(packet, transportId) {
    // TODO: Implement link-state routing (Phase 2)
    console.log(`[BackboneManager] LSA from ${packet.source} - routing not yet implemented`);
  }

  /**
   * Handle KEEPALIVE packet (heartbeat)
   * @private
   */
  _handleKeepalive(packet, transportId) {
    const { source, payload } = packet;
    
    try {
      const heartbeatData = JSON.parse(payload.toString('utf8'));
      
      // Process heartbeat using Heartbeat module
      const neighborInfo = this.heartbeat.processHeartbeat(heartbeatData, transportId);
      
      if (!neighborInfo) {
        return; // Invalid heartbeat
      }

      // Update neighbor table (new system)
      if (this.neighborTable) {
        this.neighborTable.update(source, transportId, {
          services: heartbeatData.services || [],
          capabilities: heartbeatData.capabilities || {},
          protocolVersion: heartbeatData.protocolVersion || '1.0.0',
          sequence: heartbeatData.sequence,
          metrics: heartbeatData.metrics || {},
          viaHub: false // Direct heartbeat, not via hub
        });
      }

      // Update old neighbor map for backward compatibility
      let neighbor = this.neighbors.get(source);
      if (!neighbor) {
        neighbor = {
          transports: [],
          lastSeen: Date.now(),
          services: []
        };
        this.neighbors.set(source, neighbor);
      }

      if (!neighbor.transports.includes(transportId)) {
        neighbor.transports.push(transportId);
      }
      neighbor.lastSeen = Date.now();
      neighbor.services = heartbeatData.services || [];

      // Update services map
      for (const service of neighbor.services) {
        if (!this.services.has(service)) {
          this.services.set(service, new Set());
        }
        this.services.get(service).add(source);
      }

      console.log(`[BackboneManager] KEEPALIVE from ${source} via ${transportId} (seq: ${heartbeatData.sequence})`);

    } catch (error) {
      console.error(`[BackboneManager] Error handling KEEPALIVE from ${source}:`, error.message);
    }
  }

  /**
   * Handle DATA packet
   * @private
   */
  _handleData(packet, transportId) {
    const { destination, source, payload, messageId } = packet;

    // Is this for us?
    if (destination === this.localCallsign || destination === 'CQ') {
      console.log(`[BackboneManager] Received data from ${source}, ${payload.length} bytes`);
      this.emit('data', {
        source,
        destination,
        data: payload,
        messageId,
        transport: transportId
      });

      // Send ACK if not broadcast
      if (destination !== 'CQ') {
        this._sendAck(source, messageId);
      }

      // Mark as delivered
      const cached = this.messageCache.get(messageId);
      if (cached) {
        cached.delivered = true;
      }

    } else {
      // Try to relay packet if we're a hub
      const relayed = this._relayPacket(packet, transportId);
      if (!relayed) {
        console.log(`[BackboneManager] Unable to forward packet: ${source} -> ${destination}`);
      }
    }
  }

  /**
   * Handle ACK packet
   * @private
   */
  _handleAck(packet, transportId) {
    const { source, messageId } = packet;
    console.log(`[BackboneManager] ACK from ${source} for message ${messageId}`);
    this.emit('ack', { source, messageId, transport: transportId });
  }

  /**
   * Handle service query
   * @private
   */
  _handleServiceQuery(packet, transportId) {
    // TODO: Implement service discovery (Phase 3)
    console.log(`[BackboneManager] Service query from ${packet.source} - not yet implemented`);
  }

  /**
   * Handle service reply
   * @private
   */
  _handleServiceReply(packet, transportId) {
    // TODO: Implement service discovery (Phase 3)
    console.log(`[BackboneManager] Service reply from ${packet.source} - not yet implemented`);
  }

  /**
   * Handle neighbor list from hub (client mode)
   * @private
   */
  _handleNeighborList(packet, transportId) {
    const { source, payload } = packet;
    
    try {
      const neighborList = JSON.parse(payload.toString('utf8'));
      const { timestamp, hub, neighbors } = neighborList;
      
      console.log(`[BackboneManager] Received neighbor list from hub ${hub}, ${neighbors.length} neighbors`);
      
      // Update our neighbor table with hub-provided information
      for (const neighborInfo of neighbors) {
        const { callsign, services, transport } = neighborInfo;
        
        // Skip ourselves
        if (callsign === this.localCallsign) {
          continue;
        }
        
        // Update or create neighbor entry
        let neighbor = this.neighbors.get(callsign);
        if (!neighbor) {
          neighbor = {
            transports: [],
            lastSeen: Date.now(),
            services: [],
            viaHub: true // Mark that we learned about this from hub
          };
          this.neighbors.set(callsign, neighbor);
        }
        
        // Add transport if not already present
        if (!neighbor.transports.includes(transportId)) {
          neighbor.transports.push(transportId);
        }
        
        neighbor.lastSeen = Date.now();
        neighbor.services = services || [];
        neighbor.viaHub = true;
        
        // Update services map
        for (const service of neighbor.services) {
          if (!this.services.has(service)) {
            this.services.set(service, new Set());
          }
          this.services.get(service).add(callsign);
        }
      }
      
      // Emit event for UI updates
      this.emit('neighbor-list-update', {
        hub: hub,
        count: neighbors.length,
        timestamp: timestamp
      });
      
    } catch (error) {
      console.error('[BackboneManager] Failed to parse neighbor list:', error.message);
    }
  }

  /**
   * Send data to destination
   * @param {String} destination - Destination callsign
   * @param {Buffer} data - User data
   * @param {Object} options
   * @returns {Promise<String>} - Message ID
   */
  async sendData(destination, data, options = {}) {
    if (!this.enabled) {
      throw new Error('Backbone not enabled');
    }

    // Create DATA packet
    const packet = PacketFormat.createData(
      this.localCallsign,
      destination,
      data,
      options
    );

    // Select best transport
    const transport = this._selectTransport(destination, options);
    if (!transport) {
      throw new Error('No transport available to reach destination');
    }

    // Send packet
    await transport.send(destination, packet, options);

    // Extract message ID
    const decoded = PacketFormat.decode(packet);
    return decoded.messageId;
  }

  /**
   * Send ACK
   * @private
   */
  async _sendAck(destination, messageId) {
    const ackPacket = PacketFormat.createAck(
      this.localCallsign,
      destination,
      messageId
    );

    const transport = this._selectTransport(destination);
    if (transport) {
      await transport.send(destination, ackPacket);
    }
  }

  /**
   * Select best transport for destination
   * @private
   */
  /**
   * Select best transport for destination
   * @private
   * @param {String} destination - Destination callsign
   * @param {Object} options - Routing options
   * @returns {Transport|null} Selected transport or null
   */
  _selectTransport(destination, options = {}) {
    const availableTransports = Array.from(this.transports.values())
      .filter(t => t.isAvailable());

    if (availableTransports.length === 0) {
      return null;
    }

    // Hub-and-spoke mode routing
    const internet = this.transports.get('internet');
    if (internet && internet.isAvailable()) {
      const mode = internet.mode || 'mesh';

      // Client mode: Always route through hub for Internet traffic
      if (mode === 'client') {
        console.log(`[BackboneManager] Client mode: routing to ${destination} via hub`);
        return internet;
      }

      // Server (hub) mode: Route directly to connected clients
      if (mode === 'server') {
        // Check if destination is a connected client
        if (internet.clients && internet.clients.has(destination)) {
          console.log(`[BackboneManager] Hub mode: direct route to client ${destination}`);
          return internet;
        }
        // If destination is not a connected client, use normal routing
        // (might be reachable via RF or needs relay through another hub)
      }

      // Mesh mode continues to normal routing logic below
    }

    // Use routing engine if available (Phase 3)
    if (this.routingEngine && this.routingEngine.isReachable(destination)) {
      const route = this.routingEngine.selectRoute(destination, options);
      
      if (route) {
        // Get transport for next hop
        const nextHop = route.nextHop;
        const transportId = route.transport;
        const transport = this.transports.get(transportId);
        
        if (transport && transport.isAvailable()) {
          console.log(`[BackboneManager] Routing: ${destination} via ${nextHop} on ${transportId} (cost: ${route.cost})`);
          return transport;
        }
      }
    }

    // Fallback to simple neighbor lookup (backward compatibility)
    const neighbor = this.neighbors.get(destination);
    if (neighbor) {
      // Prefer Internet if configured
      if (this.config.routing?.preferInternet) {
        if (internet && internet.isAvailable() && neighbor.transports.includes('internet')) {
          return internet;
        }
      }

      // Use first available transport that reaches this neighbor
      for (const transportId of neighbor.transports) {
        const transport = this.transports.get(transportId);
        if (transport && transport.isAvailable()) {
          return transport;
        }
      }
    }

    // Default: prefer lowest cost transport
    return availableTransports.sort((a, b) => a.getCost() - b.getCost())[0];
  }

  /**
   * Relay packet to another client (hub mode only)
   * @private
   */
  _relayPacket(packet, transportId) {
    const internet = this.transports.get('internet');
    if (!internet || !internet.isAvailable()) {
      console.warn('[BackboneManager] Cannot relay: Internet transport not available');
      return false;
    }

    const mode = internet.mode || 'mesh';
    if (mode !== 'server') {
      console.warn('[BackboneManager] Cannot relay: Not in server (hub) mode');
      return false;
    }

    const { destination } = packet;

    // Check if destination is a connected client
    if (!internet.clients || !internet.clients.has(destination)) {
      console.log(`[BackboneManager] Cannot relay to ${destination}: Not a connected client`);
      return false;
    }

    // Get client socket
    const clientSocket = internet.clients.get(destination);
    if (!clientSocket || clientSocket.destroyed) {
      console.warn(`[BackboneManager] Cannot relay to ${destination}: Socket destroyed`);
      internet.clients.delete(destination);
      return false;
    }

    try {
      // Serialize packet and send
      const buffer = PacketFormat.encode(packet);
      clientSocket.socket.write(buffer);
      
      // Track relay metrics
      if (!internet.metrics.packetsRelayed) {
        internet.metrics.packetsRelayed = 0;
      }
      internet.metrics.packetsRelayed++;
      
      console.log(`[BackboneManager] Relayed packet from ${packet.source} to ${destination} (${buffer.length} bytes)`);
      return true;
    } catch (error) {
      console.error(`[BackboneManager] Failed to relay packet to ${destination}:`, error.message);
      return false;
    }
  }

  /**
   * Update neighbor information
   * @private
   */
  _updateNeighbor(callsign, transportId) {
    let neighbor = this.neighbors.get(callsign);
    if (!neighbor) {
      neighbor = {
        transports: [],
        lastSeen: Date.now(),
        services: []
      };
      this.neighbors.set(callsign, neighbor);
    }

    if (!neighbor.transports.includes(transportId)) {
      neighbor.transports.push(transportId);
    }
    neighbor.lastSeen = Date.now();
  }

  /**
   * Remove neighbor
   * @private
   */
  _removeNeighbor(callsign, transportId) {
    const neighbor = this.neighbors.get(callsign);
    if (neighbor) {
      neighbor.transports = neighbor.transports.filter(t => t !== transportId);
      
      if (neighbor.transports.length === 0) {
        this.neighbors.delete(callsign);
        
        // Remove from services
        for (const [service, providers] of this.services) {
          providers.delete(callsign);
        }
      }
    }
  }

  /**
   * Broadcast heartbeat to all transports
   * @private
   */
  _broadcastHeartbeat(heartbeatData) {
    try {
      const packet = {
        source: this.localCallsign,
        destination: 'BROADCAST',
        type: PacketType.KEEPALIVE,
        flags: PacketFlags.NONE,
        priority: Priority.LOW,
        ttl: 1, // Heartbeats are not forwarded
        payload: Buffer.from(JSON.stringify(heartbeatData), 'utf8')
      };

      // Broadcast to all available transports
      for (const [transportId, transport] of this.transports) {
        if (transport.isAvailable()) {
          transport.broadcast(PacketFormat.encode(packet))
            .catch(err => {
              console.error(`[BackboneManager] Failed to broadcast heartbeat on ${transportId}:`, err.message);
            });
        }
      }
    } catch (error) {
      console.error('[BackboneManager] Error broadcasting heartbeat:', error);
    }
  }

  /**
   * Collect current metrics for heartbeat
   * @private
   */
  _collectMetrics() {
    const metrics = {};

    for (const [transportId, transport] of this.transports) {
      if (transport.isAvailable() && transport.metrics) {
        metrics[transportId] = {
          packetsSent: transport.metrics.packetsSent || 0,
          packetsReceived: transport.metrics.packetsReceived || 0,
          bytesSent: transport.metrics.bytesSent || 0,
          bytesReceived: transport.metrics.bytesReceived || 0,
          errors: transport.metrics.errors || 0
        };
      }
    }

    return metrics;
  }

  /**
   * Trigger routing table update (placeholder for Phase 3)
   * @private
   */
  /**
   * Trigger routing table update
   * @private
   */
  _triggerRoutingUpdate() {
    if (!this.topologyGraph || !this.routingEngine) {
      return;
    }

    // Update topology graph from neighbor table
    this.topologyGraph.updateFromNeighborTable(this.localCallsign, this.neighborTable);

    // Recalculate routes
    const routes = this.routingEngine.calculateRoutes(this.topologyGraph);

    // Update old routing table for backward compatibility
    this.routingTable.clear();
    for (const [dest, route] of routes) {
      this.routingTable.set(dest, {
        nextHop: route.nextHop,
        cost: route.cost,
        transport: route.transport,
        lastUpdate: route.lastUpdate
      });
    }

    console.log(`[BackboneManager] Routing update complete: ${routes.size} routes calculated`);
  }

  /**
   * Collect metrics for heartbeat
   * @private
   * @returns {Object} Metrics object
   */
  _collectMetrics() {
    const metrics = {};

    // Collect metrics from each transport
    for (const [id, transport] of this.transports) {
      if (transport.connected) {
        const transportMetrics = transport.getMetrics();
        metrics[id] = {
          packetsSent: transportMetrics.packetsSent || 0,
          packetsReceived: transportMetrics.packetsReceived || 0,
          bytesSent: transportMetrics.bytesSent || 0,
          bytesReceived: transportMetrics.bytesReceived || 0,
          errors: transportMetrics.errors || 0
        };
      }
    }

    return metrics;
  }

  /**
   * Broadcast heartbeat on all transports
   * @private
   * @param {Object} heartbeatData - Heartbeat data to broadcast
   */
  async _broadcastHeartbeat(heartbeatData) {
    const payload = Buffer.from(JSON.stringify(heartbeatData), 'utf8');

    for (const [id, transport] of this.transports) {
      if (!transport.connected || !transport.isAvailable()) {
        continue;
      }

      try {
        const packet = PacketFormat.create({
          type: PacketType.KEEPALIVE,
          source: this.localCallsign,
          destination: '*', // Broadcast
          payload: payload,
          priority: Priority.LOW
        });

        await transport.broadcast(packet);
      } catch (error) {
        console.error(`[BackboneManager] Failed to broadcast heartbeat on ${id}:`, error.message);
      }
    }
  }

  /**
   * Start maintenance tasks
   * @private
   */
  _startMaintenance() {
    this.maintenanceInterval = setInterval(() => {
      this._maintenance();
    }, 60000); // Every minute

    // Start heartbeat broadcasts
    if (this.heartbeat) {
      this.heartbeat.start();
      console.log('[BackboneManager] Heartbeat broadcasts started');
    }

    // Start neighbor table cleanup
    if (this.neighborTable) {
      this.neighborTable.startCleanup();
    }

    // Start neighbor broadcast if we're a hub (server mode)
    const internet = this.transports.get('internet');
    if (internet && internet.mode === 'server') {
      console.log('[BackboneManager] Starting hub neighbor broadcast');
      internet.startNeighborBroadcast(this.localCallsign, 30000); // Broadcast every 30s
    }

    // Start periodic routing updates
    this.routingUpdateTimer = setInterval(() => {
      this._triggerRoutingUpdate();
    }, this.config.routingUpdateInterval || 60000); // Every minute by default

    console.log('[BackboneManager] Periodic routing updates started');
  }

  /**
   * Periodic maintenance
   * @private
   */
  _maintenance() {
    const now = Date.now();

    // Cleanup old message cache entries
    for (const [messageId, info] of this.messageCache) {
      if (now - info.timestamp > 300000) { // 5 minutes
        this.messageCache.delete(messageId);
      }
    }

    // Check for stale neighbors
    for (const [callsign, neighbor] of this.neighbors) {
      if (now - neighbor.lastSeen > 600000) { // 10 minutes
        console.log(`[BackboneManager] Neighbor ${callsign} timed out`);
        this.neighbors.delete(callsign);
      }
    }

    // Log status
    console.log(`[BackboneManager] Status: ${this.neighbors.size} neighbors, ${this.messageCache.size} cached messages`);
  }

  /**
   * Shutdown backbone system
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (!this.enabled) {
      return;
    }

    console.log('[BackboneManager] Shutting down...');

    // Stop heartbeat
    if (this.heartbeat) {
      this.heartbeat.stop();
    }

    // Stop neighbor table cleanup
    if (this.neighborTable) {
      this.neighborTable.stopCleanup();
    }

    // Stop maintenance
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
    }

    // Stop routing updates
    if (this.routingUpdateTimer) {
      clearInterval(this.routingUpdateTimer);
    }

    // Stop neighbor broadcasts if running
    const internet = this.transports.get('internet');
    if (internet) {
      internet.stopNeighborBroadcast();
    }

    // Disconnect all transports
    const promises = [];
    for (const [id, transport] of this.transports) {
      promises.push(
        transport.disconnect().catch(err => {
          console.error(`[BackboneManager] Error disconnecting ${id}:`, err.message);
        })
      );
    }
    await Promise.all(promises);

    this.enabled = false;
    console.log('[BackboneManager] Shutdown complete');
  }

  /**
   * Get backbone status
   * @returns {Object}
   */
  getStatus() {
    const status = {
      enabled: this.enabled,
      localCallsign: this.localCallsign,
      transports: {},
      neighbors: Array.from(this.neighbors.entries()).map(([callsign, info]) => ({
        callsign,
        ...info,
        lastSeenAgo: Date.now() - info.lastSeen
      })),
      services: {},
      messageCache: this.messageCache.size,
      heartbeat: null,
      neighborTable: null,
      topologyGraph: null,
      routingEngine: null
    };

    // Heartbeat status
    if (this.heartbeat) {
      status.heartbeat = {
        running: this.heartbeat.running,
        interval: this.heartbeat.interval,
        sequence: this.heartbeat.sequence
      };
    }

    // Neighbor table status (new system)
    if (this.neighborTable) {
      const stats = this.neighborTable.getStats();
      status.neighborTable = {
        total: stats.total,
        direct: stats.direct,
        viaHub: stats.viaHub,
        rf: stats.rf,
        internet: stats.internet,
        services: stats.services,
        neighbors: this.neighborTable.toArray() // Detailed list
      };
    }

    // Topology graph status
    if (this.topologyGraph) {
      const graphStats = this.topologyGraph.getStats();
      status.topologyGraph = {
        nodes: graphStats.nodes,
        edges: graphStats.edges,
        avgCost: graphStats.avgCost,
        transports: graphStats.transports
      };
    }

    // Routing engine status
    if (this.routingEngine) {
      const routeStats = this.routingEngine.getStats();
      status.routingEngine = {
        routes: routeStats.routes,
        avgCost: routeStats.avgCost,
        avgHops: routeStats.avgHops,
        minHops: routeStats.minHops,
        maxHops: routeStats.maxHops,
        transports: routeStats.transports,
        lastCalculation: routeStats.lastCalculation,
        routingTable: this.routingEngine.toArray() // Detailed routes
      };
    }

    // Transport status
    for (const [id, transport] of this.transports) {
      const transportStatus = {
        connected: transport.connected,
        metrics: transport.getMetrics()
      };

      // Add mode-specific information for Internet transport
      if (id === 'internet' && transport.mode) {
        transportStatus.mode = transport.mode;

        // Client mode: Add hub connection info
        if (transport.mode === 'client') {
          transportStatus.hubCallsign = transport._getHubCallsign ? transport._getHubCallsign() : null;
          transportStatus.reconnectAttempts = transport.reconnectAttempts || 0;
        }

        // Server mode: Add hub statistics
        if (transport.mode === 'server') {
          const connectedClients = transport.getConnectedPeers ? transport.getConnectedPeers().length : 0;
          transportStatus.connectedClients = connectedClients;
          transportStatus.packetsRelayed = transport.metrics?.packetsRelayed || 0;
          transportStatus.bytesSent = transport.metrics?.bytesSent || 0;
          transportStatus.bytesReceived = transport.metrics?.bytesReceived || 0;
          transportStatus.uptime = transport.metrics?.uptime || 0;
        }
      }

      status.transports[id] = transportStatus;
    }

    // Services offered by neighbors
    for (const [service, providers] of this.services) {
      status.services[service] = Array.from(providers);
    }

    return status;
  }
}

module.exports = BackboneManager;
