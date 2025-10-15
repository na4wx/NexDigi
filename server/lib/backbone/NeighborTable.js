/**
 * NeighborTable.js
 * Manages the neighbor table with timeout, multi-transport tracking, and state changes
 */

const EventEmitter = require('events');

class NeighborTable extends EventEmitter {
  /**
   * Create neighbor table
   * @param {Object} config - Configuration
   * @param {Number} config.timeout - Neighbor timeout in ms (default: 900000 = 15 min)
   * @param {Number} config.cleanupInterval - Cleanup check interval in ms (default: 60000 = 1 min)
   */
  constructor(config = {}) {
    super();
    
    this.timeout = config.timeout || 900000; // 15 minutes default
    this.cleanupInterval = config.cleanupInterval || 60000; // 1 minute
    
    // Map: callsign -> neighbor data
    this.neighbors = new Map();
    
    // Cleanup timer
    this.cleanupTimer = null;
  }

  /**
   * Start periodic cleanup of stale neighbors
   */
  startCleanup() {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => this._cleanup(), this.cleanupInterval);
    console.log(`[NeighborTable] Cleanup started (interval: ${this.cleanupInterval}ms, timeout: ${this.timeout}ms)`);
  }

  /**
   * Stop cleanup
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.log('[NeighborTable] Cleanup stopped');
    }
  }

  /**
   * Add or update a neighbor
   * @param {String} callsign - Neighbor callsign
   * @param {String} transportId - Transport ID (e.g., 'internet', 'rf')
   * @param {Object} info - Neighbor information
   * @param {Array} info.services - Services offered by neighbor
   * @param {Object} info.metrics - Link quality metrics
   * @param {Object} info.capabilities - Node capabilities
   * @param {String} info.protocolVersion - Protocol version
   * @param {Number} info.sequence - Heartbeat sequence number
   * @param {Boolean} info.viaHub - True if learned via hub (not direct connection)
   * @returns {Object} Updated neighbor entry
   */
  update(callsign, transportId, info = {}) {
    const now = Date.now();
    let neighbor = this.neighbors.get(callsign);
    const isNew = !neighbor;

    if (isNew) {
      // New neighbor
      neighbor = {
        callsign,
        transports: new Map(), // transportId -> { lastSeen, metrics, cost }
        services: [],
        capabilities: {},
        protocolVersion: '1.0.0',
        sequence: 0,
        firstSeen: now,
        lastSeen: now,
        lastUpdate: now,
        viaHub: info.viaHub || false
      };
      this.neighbors.set(callsign, neighbor);
    }

    // Update transport-specific info
    if (!neighbor.transports.has(transportId)) {
      neighbor.transports.set(transportId, {
        lastSeen: now,
        metrics: {},
        cost: this._calculateCost(transportId, info.metrics || {})
      });
    }

    const transport = neighbor.transports.get(transportId);
    transport.lastSeen = now;
    transport.metrics = info.metrics || transport.metrics;
    transport.cost = this._calculateCost(transportId, transport.metrics);

    // Update global neighbor info
    neighbor.lastSeen = now;
    neighbor.lastUpdate = now;
    neighbor.services = info.services || neighbor.services;
    neighbor.capabilities = info.capabilities || neighbor.capabilities;
    neighbor.protocolVersion = info.protocolVersion || neighbor.protocolVersion;
    neighbor.viaHub = info.viaHub !== undefined ? info.viaHub : neighbor.viaHub;
    
    // Track sequence number for duplicate/replay detection
    if (info.sequence !== undefined && info.sequence > neighbor.sequence) {
      neighbor.sequence = info.sequence;
    }

    // Emit event
    if (isNew) {
      console.log(`[NeighborTable] New neighbor: ${callsign} via ${transportId}`);
      this.emit('neighbor-added', callsign, neighbor);
    } else {
      this.emit('neighbor-updated', callsign, neighbor);
    }

    return neighbor;
  }

  /**
   * Get neighbor by callsign
   * @param {String} callsign - Neighbor callsign
   * @returns {Object|null} Neighbor info or null if not found
   */
  get(callsign) {
    return this.neighbors.get(callsign) || null;
  }

  /**
   * Get all neighbors
   * @returns {Map} Map of callsign -> neighbor info
   */
  getAll() {
    return this.neighbors;
  }

  /**
   * Get neighbors by transport
   * @param {String} transportId - Transport ID
   * @returns {Array} Array of neighbor callsigns reachable via this transport
   */
  getByTransport(transportId) {
    const result = [];
    for (const [callsign, neighbor] of this.neighbors) {
      if (neighbor.transports.has(transportId)) {
        result.push(callsign);
      }
    }
    return result;
  }

  /**
   * Get neighbors offering a specific service
   * @param {String} service - Service name
   * @returns {Array} Array of neighbor callsigns offering this service
   */
  getByService(service) {
    const result = [];
    for (const [callsign, neighbor] of this.neighbors) {
      if (neighbor.services.includes(service)) {
        result.push(callsign);
      }
    }
    return result;
  }

  /**
   * Check if neighbor exists and is not timed out
   * @param {String} callsign - Neighbor callsign
   * @returns {Boolean} True if neighbor is active
   */
  isActive(callsign) {
    const neighbor = this.neighbors.get(callsign);
    if (!neighbor) {
      return false;
    }
    return (Date.now() - neighbor.lastSeen) < this.timeout;
  }

  /**
   * Remove a neighbor
   * @param {String} callsign - Neighbor callsign
   * @param {String} reason - Reason for removal
   * @returns {Boolean} True if neighbor was removed
   */
  remove(callsign, reason = 'Unknown') {
    const neighbor = this.neighbors.get(callsign);
    if (!neighbor) {
      return false;
    }

    this.neighbors.delete(callsign);
    console.log(`[NeighborTable] Removed neighbor: ${callsign} (${reason})`);
    this.emit('neighbor-removed', callsign, neighbor, reason);
    return true;
  }

  /**
   * Remove a specific transport from a neighbor
   * If neighbor has no more transports, remove the neighbor entirely
   * @param {String} callsign - Neighbor callsign
   * @param {String} transportId - Transport ID
   * @returns {Boolean} True if transport was removed
   */
  removeTransport(callsign, transportId) {
    const neighbor = this.neighbors.get(callsign);
    if (!neighbor || !neighbor.transports.has(transportId)) {
      return false;
    }

    neighbor.transports.delete(transportId);
    console.log(`[NeighborTable] Removed transport ${transportId} from neighbor ${callsign}`);

    // If neighbor has no more transports, remove it
    if (neighbor.transports.size === 0) {
      this.remove(callsign, 'No transports available');
    } else {
      // Update lastSeen to most recent transport
      let mostRecent = 0;
      for (const transport of neighbor.transports.values()) {
        if (transport.lastSeen > mostRecent) {
          mostRecent = transport.lastSeen;
        }
      }
      neighbor.lastSeen = mostRecent;
      this.emit('neighbor-updated', callsign, neighbor);
    }

    return true;
  }

  /**
   * Get neighbor count
   * @returns {Number} Number of neighbors
   */
  size() {
    return this.neighbors.size;
  }

  /**
   * Clear all neighbors
   */
  clear() {
    const count = this.neighbors.size;
    this.neighbors.clear();
    console.log(`[NeighborTable] Cleared ${count} neighbors`);
    this.emit('cleared');
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    let directNeighbors = 0;
    let hubNeighbors = 0;
    let rfNeighbors = 0;
    let internetNeighbors = 0;
    const serviceCount = new Map();

    for (const neighbor of this.neighbors.values()) {
      if (neighbor.viaHub) {
        hubNeighbors++;
      } else {
        directNeighbors++;
      }

      if (neighbor.transports.has('rf')) {
        rfNeighbors++;
      }
      if (neighbor.transports.has('internet')) {
        internetNeighbors++;
      }

      for (const service of neighbor.services) {
        serviceCount.set(service, (serviceCount.get(service) || 0) + 1);
      }
    }

    return {
      total: this.neighbors.size,
      direct: directNeighbors,
      viaHub: hubNeighbors,
      rf: rfNeighbors,
      internet: internetNeighbors,
      services: Object.fromEntries(serviceCount)
    };
  }

  /**
   * Cleanup stale neighbors
   * @private
   */
  _cleanup() {
    const now = Date.now();
    const removed = [];

    for (const [callsign, neighbor] of this.neighbors) {
      const age = now - neighbor.lastSeen;
      
      if (age > this.timeout) {
        this.neighbors.delete(callsign);
        removed.push(callsign);
        console.log(`[NeighborTable] Removed stale neighbor: ${callsign} (last seen ${Math.round(age / 1000)}s ago)`);
        this.emit('neighbor-removed', callsign, neighbor, 'Timeout');
      }
    }

    if (removed.length > 0) {
      console.log(`[NeighborTable] Cleanup removed ${removed.length} stale neighbor(s)`);
    }
  }

  /**
   * Calculate link cost based on transport type and metrics
   * @private
   * @param {String} transportId - Transport ID
   * @param {Object} metrics - Link metrics (SNR, packet loss, latency, etc.)
   * @returns {Number} Link cost (lower is better)
   */
  _calculateCost(transportId, metrics) {
    let baseCost = 10; // Default

    // Base cost by transport type
    if (transportId === 'internet') {
      baseCost = 1;
    } else if (transportId === 'rf') {
      baseCost = 10;
    }

    // Adjust for link quality
    if (metrics.packetLoss) {
      baseCost += metrics.packetLoss * 100; // Add 100 cost per 100% loss
    }

    if (metrics.latency) {
      baseCost += metrics.latency / 100; // Add 1 cost per 100ms latency
    }

    if (metrics.snr && metrics.snr < 10) {
      baseCost += (10 - metrics.snr); // Poor SNR increases cost
    }

    return baseCost;
  }

  /**
   * Export neighbor table for debugging/UI
   * @returns {Array} Array of neighbor objects
   */
  toArray() {
    return Array.from(this.neighbors.entries()).map(([callsign, neighbor]) => ({
      callsign,
      transports: Array.from(neighbor.transports.entries()).map(([id, t]) => ({
        id,
        lastSeen: t.lastSeen,
        cost: t.cost,
        metrics: t.metrics
      })),
      services: neighbor.services,
      lastSeen: neighbor.lastSeen,
      age: Date.now() - neighbor.lastSeen,
      viaHub: neighbor.viaHub,
      protocolVersion: neighbor.protocolVersion
    }));
  }
}

module.exports = NeighborTable;
