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

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../data/backboneSettings.json');

class BackboneManager extends EventEmitter {
  constructor(channelManager, configPath = DEFAULT_CONFIG_PATH) {
    super();
    this.channelManager = channelManager;
    this.configPath = configPath;
    this.config = null;
    this.transports = new Map(); // transportId -> Transport instance
    this.routingTable = new Map(); // destination -> { nextHop, cost, transport, lastUpdate }
    this.neighbors = new Map(); // callsign -> { transports: [], lastSeen, services }
    this.services = new Map(); // serviceType -> Set of callsigns offering service
    this.messageCache = new Map(); // messageId -> { timestamp, delivered }
    this.localCallsign = '';
    this.enabled = false;

    // Periodic maintenance
    this.maintenanceInterval = null;
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
   * Handle Link State Advertisement
   * @private
   */
  _handleLSA(packet, transportId) {
    // TODO: Implement link-state routing (Phase 2)
    console.log(`[BackboneManager] LSA from ${packet.source} - routing not yet implemented`);
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

    // If only one transport available, use it
    if (availableTransports.length === 1) {
      return availableTransports[0];
    }

    // Check if destination is a neighbor
    const neighbor = this.neighbors.get(destination);
    if (neighbor) {
      // Prefer Internet if configured
      if (this.config.routing.preferInternet) {
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
   * Start maintenance tasks
   * @private
   */
  _startMaintenance() {
    this.maintenanceInterval = setInterval(() => {
      this._maintenance();
    }, 60000); // Every minute

    // Start neighbor broadcast if we're a hub (server mode)
    const internet = this.transports.get('internet');
    if (internet && internet.mode === 'server') {
      console.log('[BackboneManager] Starting hub neighbor broadcast');
      internet.startNeighborBroadcast(this.localCallsign, 30000); // Broadcast every 30s
    }
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

    // Stop maintenance
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
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
      messageCache: this.messageCache.size
    };

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
