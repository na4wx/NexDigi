/**
 * InternetTransport.js
 * Internet transport for backbone using TCP/IP with TLS encryption
 * 
 * Provides secure, high-speed connectivity between NexDigi nodes
 * over the Internet. Uses port 14240 by default (similar to Winlink).
 */

const Transport = require('./Transport');
const { PacketFormat, PacketType } = require('./PacketFormat');
const net = require('net');
const tls = require('tls');
const EventEmitter = require('events');

// Default port for backbone Internet connections
const DEFAULT_PORT = 14240;

// Internet transport cost (lower than RF, reflects faster/more reliable medium)
const INTERNET_COST = 10;

// TCP MTU (can handle larger packets)
const INTERNET_MTU = 8192;

class InternetTransport extends Transport {
  constructor(config) {
    super(config);
    this.type = 'internet';
    this.mode = (config.mode || 'mesh').toLowerCase(); // 'mesh', 'server', 'client'
    this.server = null;
    this.clients = new Map(); // callsign -> { socket, buffer }
    this.useTLS = config.tls !== false; // TLS enabled by default
    this.port = config.port || DEFAULT_PORT;
    this.bindAddress = config.bindAddress || '0.0.0.0';
    this.peers = config.peers || []; // { host, port, callsign } - used in mesh mode
    this.hubServer = config.hubServer || null; // { host, port, callsign } - used in client mode
    this.hubServers = (config.hubServers && config.hubServers.servers) || []; // Fallback hubs
    this.tlsOptions = config.tlsOptions || {};
    this.currentHubIndex = -1; // Track which hub we're connected to
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    
    // Validate mode
    if (!['mesh', 'server', 'client'].includes(this.mode)) {
      console.warn(`[InternetTransport] Invalid mode '${this.mode}', defaulting to 'mesh'`);
      this.mode = 'mesh';
    }
    
    // Validate client mode configuration
    if (this.mode === 'client' && !this.hubServer && this.hubServers.length === 0) {
      throw new Error('Client mode requires hubServer or hubServers configuration');
    }
    
    console.log(`[InternetTransport] Mode: ${this.mode}`);
  }

  /**
   * Connect to the Internet transport (start server and connect to peers)
   * @param {Object} options
   * @returns {Promise<void>}
   */
  async connect(options = {}) {
    if (this.connected) {
      return;
    }

    console.log(`[InternetTransport] Connecting in ${this.mode} mode...`);

    // Mode-specific connection logic
    if (this.mode === 'server') {
      // Hub/Server mode: Only listen for incoming connections
      await this._startServer();
      console.log(`[InternetTransport] Hub server started on port ${this.port}`);
      
    } else if (this.mode === 'client') {
      // Client mode: Only connect to hub(s), no server
      await this._connectToHub();
      console.log(`[InternetTransport] Client mode, connected to hub`);
      
    } else {
      // Mesh mode: Start server AND connect to peers (existing P2P behavior)
      await this._startServer();
      
      // Connect to configured peers
      for (const peer of this.peers) {
        this._connectToPeer(peer).catch(err => {
          console.error(`[InternetTransport] Failed to connect to ${peer.callsign}:`, err.message);
        });
      }
      console.log(`[InternetTransport] Mesh mode with ${this.peers.length} configured peers`);
    }

    this.connected = true;
    this.emit('connected');
  }

  /**
   * Start TCP/TLS server
   * @private
   */
  async _startServer() {
    // Don't start server in client mode
    if (this.mode === 'client') {
      console.log('[InternetTransport] Client mode - skipping server startup');
      return;
    }

    return new Promise((resolve, reject) => {
      const serverOptions = {
        ...this.tlsOptions
      };

      if (this.useTLS) {
        // TLS server
        if (!serverOptions.key || !serverOptions.cert) {
          return reject(new Error('TLS requires key and cert in tlsOptions'));
        }

        this.server = tls.createServer(serverOptions, (socket) => {
          this._handleConnection(socket);
        });
      } else {
        // Plain TCP server
        this.server = net.createServer((socket) => {
          this._handleConnection(socket);
        });
      }

      this.server.on('error', (err) => {
        console.error('[InternetTransport] Server error:', err.message);
        this._recordError(err);
      });

      this.server.listen(this.port, this.bindAddress, () => {
        console.log(`[InternetTransport] Server listening on ${this.bindAddress}:${this.port} (TLS: ${this.useTLS})`);
        resolve();
      });
    });
  }

  /**
   * Handle incoming connection
   * @private
   */
  _handleConnection(socket) {
    console.log(`[InternetTransport] New connection from ${socket.remoteAddress}:${socket.remotePort}`);

    const client = {
      socket,
      buffer: Buffer.alloc(0),
      callsign: null, // Will be set after HELLO packet
      authenticated: false
    };

    socket.on('data', (data) => {
      this._handleData(client, data);
    });

    socket.on('error', (err) => {
      console.error('[InternetTransport] Socket error:', err.message);
      this._recordError(err);
    });

    socket.on('close', () => {
      if (client.callsign) {
        console.log(`[InternetTransport] Disconnected from ${client.callsign}`);
        this.clients.delete(client.callsign);
        this.emit('disconnect', client.callsign);
      }
    });
  }

  /**
   * Handle incoming data
   * @private
   */
  _handleData(client, data) {
    // Append to buffer
    client.buffer = Buffer.concat([client.buffer, data]);

    // Try to extract complete packets
    while (client.buffer.length >= 64) { // Minimum header size
      try {
        // Try to decode packet
        const packet = PacketFormat.decode(client.buffer);
        const packetLength = 64 + packet.payload.length + this._getRoutingInfoLength(packet.routingInfo);
        
        // Remove processed packet from buffer
        client.buffer = client.buffer.slice(packetLength);

        // Process packet
        this._processPacket(client, packet);
        
        this._updateMetrics('receive', packetLength);

      } catch (error) {
        if (error.message.includes('too small') || error.message.includes('Incomplete')) {
          // Need more data
          break;
        } else {
          // Corrupted packet - skip and try to resync
          console.error('[InternetTransport] Corrupted packet, attempting resync:', error.message);
          client.buffer = client.buffer.slice(1); // Skip one byte and try again
          this._recordError(error);
        }
      }
    }
  }

  /**
   * Process received packet
   * @private
   */
  _processPacket(client, packet) {
    // First packet should be HELLO for authentication
    if (!client.authenticated && packet.type !== PacketType.HELLO) {
      console.warn('[InternetTransport] Received non-HELLO packet from unauthenticated client');
      client.socket.end();
      return;
    }

    if (packet.type === PacketType.HELLO && !client.authenticated) {
      // Extract callsign and authenticate
      client.callsign = packet.source;
      client.authenticated = true;
      client.lastSeen = Date.now();
      
      // Extract services from HELLO payload
      try {
        const info = JSON.parse(packet.payload.toString('utf8'));
        client.services = info.services || [];
      } catch (error) {
        console.warn('[InternetTransport] Failed to parse HELLO services:', error.message);
        client.services = [];
      }
      
      this.clients.set(client.callsign, client);
      
      console.log(`[InternetTransport] Authenticated ${client.callsign}, services: ${client.services.join(', ')}`);
      this.emit('connection', client.callsign);

      // Send our HELLO in response
      this._sendHello(client.socket);
      
      // If we're a hub, trigger an immediate neighbor broadcast to update all clients
      if (this.mode === 'server' && this._neighborBroadcastCallback) {
        this._neighborBroadcastCallback();
      }
      
      return;
    }

    // Emit packet for processing
    this.emit('packet', {
      ...packet,
      transport: 'internet',
      peer: client.callsign
    });
  }

  /**
   * Get routing info length (helper)
   * @private
   */
  _getRoutingInfoLength(routingInfo) {
    // Rough estimate based on TLV encoding
    let length = 3; // End marker
    if (routingInfo.viaPath) length += 3 + routingInfo.viaPath.join(',').length;
    if (routingInfo.service) length += 3 + routingInfo.service.length;
    if (routingInfo.cost !== undefined) length += 5;
    return length;
  }

  /**
   * Connect to a peer
   * @private
   */
  async _connectToPeer(peer) {
    return new Promise((resolve, reject) => {
      const { host, port, callsign } = peer;
      
      console.log(`[InternetTransport] Connecting to ${callsign} at ${host}:${port}`);

      let socket;
      if (this.useTLS) {
        socket = tls.connect({
          host,
          port,
          ...this.tlsOptions,
          rejectUnauthorized: false // Allow self-signed certs for amateur radio use
        }, () => {
          this._onPeerConnected(socket, callsign);
          resolve();
        });
      } else {
        socket = net.connect({ host, port }, () => {
          this._onPeerConnected(socket, callsign);
          resolve();
        });
      }

      socket.on('error', (err) => {
        console.error(`[InternetTransport] Connection error to ${callsign}:`, err.message);
        this._recordError(err);
        reject(err);
      });

      socket.on('close', () => {
        console.log(`[InternetTransport] Disconnected from ${callsign}`);
        this.clients.delete(callsign);
        this.emit('disconnect', callsign);
        
        // Auto-reconnect to hub in client mode
        if (this.mode === 'client' && callsign === this._getHubCallsign()) {
          console.log('[InternetTransport] Hub connection lost, attempting reconnect...');
          setTimeout(() => {
            if (this.connected) {
              this._connectToHub().catch(err => {
                console.error('[InternetTransport] Hub reconnect failed:', err.message);
              });
            }
          }, this._getReconnectDelay());
        }
      });

      const client = {
        socket,
        buffer: Buffer.alloc(0),
        callsign,
        authenticated: true // Outgoing connection
      };

      socket.on('data', (data) => {
        this._handleData(client, data);
      });

      this.clients.set(callsign, client);
    });
  }

  /**
   * Connect to hub server(s) in client mode
   * @private
   */
  async _connectToHub() {
    // Build list of hubs to try (primary + fallbacks)
    const hubs = [];
    if (this.hubServer && this.hubServer.host) {
      hubs.push(this.hubServer);
    }
    hubs.push(...this.hubServers);

    if (hubs.length === 0) {
      throw new Error('No hub servers configured');
    }

    // Try each hub in order
    for (let i = 0; i < hubs.length; i++) {
      const hub = hubs[i];
      if (!hub.host || !hub.port) {
        console.warn(`[InternetTransport] Invalid hub configuration at index ${i}`);
        continue;
      }

      try {
        console.log(`[InternetTransport] Trying hub ${i + 1}/${hubs.length}: ${hub.callsign || 'unknown'} at ${hub.host}:${hub.port}`);
        await this._connectToPeer(hub);
        this.currentHubIndex = i;
        this.reconnectAttempts = 0;
        console.log(`[InternetTransport] Successfully connected to hub: ${hub.callsign}`);
        return;
      } catch (error) {
        console.warn(`[InternetTransport] Failed to connect to hub ${i + 1}:`, error.message);
        // Continue to next hub
      }
    }

    // All hubs failed
    this.reconnectAttempts++;
    throw new Error(`Failed to connect to any hub (tried ${hubs.length} hubs)`);
  }

  /**
   * Get current hub callsign
   * @private
   */
  _getHubCallsign() {
    const hubs = [];
    if (this.hubServer && this.hubServer.host) hubs.push(this.hubServer);
    hubs.push(...this.hubServers);
    
    const currentHub = hubs[this.currentHubIndex];
    return currentHub ? currentHub.callsign : null;
  }

  /**
   * Calculate reconnect delay with exponential backoff
   * @private
   */
  _getReconnectDelay() {
    const baseDelay = 5000; // 5 seconds
    const maxDelay = 300000; // 5 minutes
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), maxDelay);
    return delay + Math.random() * 1000; // Add jitter
  }

  /**
   * Handle successful peer connection
   * @private
   */
  _onPeerConnected(socket, callsign) {
    console.log(`[InternetTransport] Connected to ${callsign}`);
    this.emit('connection', callsign);

    // Send HELLO packet
    this._sendHello(socket);
  }

  /**
   * Send HELLO packet
   * @private
   */
  _sendHello(socket) {
    const helloPacket = PacketFormat.createHello(this.localCallsign, {
      version: '1.0.0',
      services: this.config.services || []
    });

    socket.write(helloPacket);
  }

  /**
   * Disconnect from Internet transport
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this.connected) {
      return;
    }

    // Close all client connections
    for (const [callsign, client] of this.clients) {
      client.socket.end();
    }
    this.clients.clear();

    // Close server
    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(() => {
          console.log('[InternetTransport] Server closed');
          resolve();
        });
      });
      this.server = null;
    }

    this.connected = false;
    console.log('[InternetTransport] Disconnected');
    this.emit('disconnected');
  }

  /**
   * Send data to destination via Internet
   * @param {String} destination - Destination callsign
   * @param {Buffer} data - Backbone packet data
   * @param {Object} options
   * @returns {Promise<Boolean>}
   */
  async send(destination, data, options = {}) {
    if (!this.connected) {
      throw new Error('Internet transport not connected');
    }

    // Client mode: Send everything to hub
    if (this.mode === 'client') {
      // Get hub connection (should be the only client in our list)
      const hubConnection = Array.from(this.clients.values())[0];
      if (!hubConnection || !hubConnection.authenticated) {
        throw new Error('Not connected to hub');
      }
      hubConnection.socket.write(data);
      this._updateMetrics('send', data.length);
      return true;
    }

    // Server/Mesh mode: Broadcast to all connected clients
    if (destination === 'CQ' || destination === 'NODES') {
      for (const [callsign, client] of this.clients) {
        if (client.authenticated) {
          client.socket.write(data);
        }
      }
      this._updateMetrics('send', data.length * this.clients.size);
      return true;
    }

    // Server/Mesh mode: Send to specific peer
    const client = this.clients.get(destination);
    if (!client || !client.authenticated) {
      throw new Error(`Not connected to ${destination}`);
    }

    client.socket.write(data);
    this._updateMetrics('send', data.length);
    return true;
  }

  /**
   * Get Internet transport cost
   * @returns {Number}
   */
  getCost() {
    return INTERNET_COST;
  }

  /**
   * Get MTU for Internet transport
   * @returns {Number}
   */
  getMTU() {
    return INTERNET_MTU;
  }

  /**
   * Check if Internet transport is available
   * @returns {Boolean}
   */
  isAvailable() {
    // Client mode: Available if connected to hub
    if (this.mode === 'client') {
      return this.connected && this.clients.size > 0; // Has connection to hub
    }
    
    // Server/Mesh mode: Available if server is running
    return this.connected && this.server !== null;
  }

  /**
   * Add a peer dynamically
   * @param {Object} peer - { host, port, callsign }
   * @returns {Promise<void>}
   */
  async addPeer(peer) {
    if (!this.peers.find(p => p.callsign === peer.callsign)) {
      this.peers.push(peer);
    }

    if (this.connected) {
      await this._connectToPeer(peer);
    }
  }

  /**
   * Remove a peer
   * @param {String} callsign
   */
  removePeer(callsign) {
    this.peers = this.peers.filter(p => p.callsign !== callsign);
    
    const client = this.clients.get(callsign);
    if (client) {
      client.socket.end();
      this.clients.delete(callsign);
    }
  }

  /**
   * Get list of connected peers
   * @returns {Array}
   */
  getConnectedPeers() {
    return Array.from(this.clients.keys()).filter(callsign => {
      const client = this.clients.get(callsign);
      return client && client.authenticated;
    });
  }

  /**
   * Get client registry (hub mode only)
   * Returns information about all connected clients
   * @returns {Array} Array of client info objects
   */
  getClientRegistry() {
    if (this.mode !== 'server') {
      return [];
    }

    const registry = [];
    for (const [callsign, client] of this.clients.entries()) {
      if (client.authenticated && !client.socket.destroyed) {
        registry.push({
          callsign: callsign,
          services: client.services || [],
          lastSeen: client.lastSeen || Date.now(),
          address: client.socket.remoteAddress,
          port: client.socket.remotePort
        });
      }
    }
    return registry;
  }

  /**
   * Broadcast neighbor list to all clients (hub mode only)
   * Sends NEIGHBOR_LIST packet with info about all connected clients
   * @param {String} localCallsign - Hub's callsign
   */
  broadcastNeighborList(localCallsign) {
    if (this.mode !== 'server') {
      console.warn('[InternetTransport] broadcastNeighborList called but not in server mode');
      return;
    }

    const registry = this.getClientRegistry();
    if (registry.length === 0) {
      return; // No clients to broadcast to
    }

    // Build neighbor list payload
    const neighborList = {
      timestamp: Date.now(),
      hub: localCallsign,
      neighbors: registry.map(client => ({
        callsign: client.callsign,
        services: client.services,
        transport: 'internet',
        via: 'hub'
      }))
    };

    const payload = Buffer.from(JSON.stringify(neighborList), 'utf8');

    // Create NEIGHBOR_LIST packet
    const packet = {
      type: PacketType.NEIGHBOR_LIST,
      source: localCallsign,
      destination: 'CQ', // Broadcast to all
      messageId: require('crypto').randomBytes(16).toString('hex'),
      priority: 2, // High priority
      payload: payload
    };

    const packetBuffer = PacketFormat.encode(packet);

    // Send to all authenticated clients
    let sentCount = 0;
    for (const [callsign, client] of this.clients.entries()) {
      if (client.authenticated && !client.socket.destroyed) {
        try {
          client.socket.write(packetBuffer);
          sentCount++;
        } catch (error) {
          console.error(`[InternetTransport] Failed to send neighbor list to ${callsign}:`, error.message);
        }
      }
    }

    if (sentCount > 0) {
      console.log(`[InternetTransport] Broadcast neighbor list to ${sentCount} clients (${registry.length} neighbors)`);
    }
  }

  /**
   * Start periodic neighbor list broadcasts (hub mode only)
   * @param {String} localCallsign - Hub's callsign
   * @param {Number} interval - Broadcast interval in milliseconds (default: 30s)
   */
  startNeighborBroadcast(localCallsign, interval = 30000) {
    if (this.mode !== 'server') {
      return;
    }

    // Clear existing interval if any
    if (this._neighborBroadcastInterval) {
      clearInterval(this._neighborBroadcastInterval);
    }

    // Store callback for immediate broadcasts (e.g., when new client connects)
    this._neighborBroadcastCallback = () => {
      this.broadcastNeighborList(localCallsign);
    };

    // Broadcast immediately
    this.broadcastNeighborList(localCallsign);

    // Set up periodic broadcast
    this._neighborBroadcastInterval = setInterval(() => {
      this.broadcastNeighborList(localCallsign);
    }, interval);

    console.log(`[InternetTransport] Started neighbor broadcast (interval: ${interval}ms)`);
  }

  /**
   * Stop periodic neighbor broadcasts
   */
  stopNeighborBroadcast() {
    if (this._neighborBroadcastInterval) {
      clearInterval(this._neighborBroadcastInterval);
      this._neighborBroadcastInterval = null;
      console.log('[InternetTransport] Stopped neighbor broadcast');
    }
  }
}

module.exports = InternetTransport;
