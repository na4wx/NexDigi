/**
 * Heartbeat.js
 * Manages periodic heartbeat broadcasts for neighbor discovery and topology awareness
 * 
 * Heartbeats are distinct from HELLO packets:
 * - HELLO: One-time announcement on connection establishment
 * - HEARTBEAT: Periodic keepalive with updated node state
 */

const EventEmitter = require('events');

class Heartbeat extends EventEmitter {
  /**
   * Create heartbeat manager
   * @param {Object} config - Heartbeat configuration
   * @param {String} config.nodeId - Local node callsign-SSID
   * @param {Number} config.interval - Heartbeat interval in ms (default: 300000 = 5 min)
   * @param {Number} config.timeout - Neighbor timeout in ms (default: 900000 = 15 min)
   * @param {Function} config.getServices - Function to get current services offered
   * @param {Function} config.getMetrics - Function to get link quality metrics
   */
  constructor(config) {
    super();
    
    this.nodeId = config.nodeId;
    this.interval = config.interval || 300000; // 5 minutes default
    this.timeout = config.timeout || 900000; // 15 minutes default
    this.getServices = config.getServices || (() => []);
    this.getMetrics = config.getMetrics || (() => ({}));
    
    this.timer = null;
    this.running = false;
    this.sequence = 0; // Incrementing sequence number for heartbeats
    this.protocolVersion = '1.0.0';
  }

  /**
   * Start sending periodic heartbeats
   */
  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this._sendHeartbeat(); // Send immediately
    this.timer = setInterval(() => this._sendHeartbeat(), this.interval);
    
    console.log(`[Heartbeat] Started (interval: ${this.interval}ms, timeout: ${this.timeout}ms)`);
  }

  /**
   * Stop sending heartbeats
   */
  stop() {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    
    console.log('[Heartbeat] Stopped');
  }

  /**
   * Change heartbeat interval (e.g., faster during topology changes)
   * @param {Number} newInterval - New interval in ms
   */
  setInterval(newInterval) {
    if (newInterval === this.interval) {
      return;
    }

    const wasRunning = this.running;
    if (wasRunning) {
      this.stop();
    }

    this.interval = newInterval;
    console.log(`[Heartbeat] Interval changed to ${newInterval}ms`);

    if (wasRunning) {
      this.start();
    }
  }

  /**
   * Send a heartbeat packet
   * @private
   */
  _sendHeartbeat() {
    this.sequence++;

    const heartbeat = {
      // Node identity
      nodeId: this.nodeId,
      sequence: this.sequence,
      protocolVersion: this.protocolVersion,
      timestamp: Date.now(),

      // Services offered
      services: this.getServices(),

      // Link quality metrics (transport-specific)
      metrics: this.getMetrics(),

      // Node capabilities
      capabilities: {
        maxHops: 10,
        supportedPacketTypes: ['HELLO', 'DATA', 'ACK', 'KEEPALIVE', 'LSA', 'SERVICE_QUERY', 'SERVICE_REPLY', 'NEIGHBOR_LIST'],
        maxPayloadSize: 4096
      }
    };

    // Emit event for BackboneManager to send via all transports
    this.emit('heartbeat', heartbeat);
  }

  /**
   * Process received heartbeat from neighbor
   * @param {Object} heartbeat - Received heartbeat data
   * @param {String} transportId - Transport that received the heartbeat
   * @returns {Object} Processed neighbor info
   */
  processHeartbeat(heartbeat, transportId) {
    try {
      // Validate heartbeat structure
      if (!heartbeat.nodeId || !heartbeat.timestamp) {
        throw new Error('Invalid heartbeat: missing nodeId or timestamp');
      }

      // Check if heartbeat is too old (possible replay attack or clock skew)
      const age = Date.now() - heartbeat.timestamp;
      if (age > 600000) { // 10 minutes
        console.warn(`[Heartbeat] Received old heartbeat from ${heartbeat.nodeId} (age: ${age}ms)`);
      }

      // Extract neighbor information
      const neighborInfo = {
        nodeId: heartbeat.nodeId,
        lastSeen: Date.now(),
        lastHeartbeat: heartbeat.timestamp,
        sequence: heartbeat.sequence,
        protocolVersion: heartbeat.protocolVersion,
        services: heartbeat.services || [],
        metrics: heartbeat.metrics || {},
        capabilities: heartbeat.capabilities || {},
        transport: transportId,
        age: age
      };

      return neighborInfo;

    } catch (error) {
      console.error('[Heartbeat] Error processing heartbeat:', error.message);
      return null;
    }
  }

  /**
   * Check if a neighbor has timed out
   * @param {Number} lastSeen - Timestamp of last heartbeat from neighbor
   * @returns {Boolean} True if neighbor has timed out
   */
  isTimeout(lastSeen) {
    return (Date.now() - lastSeen) > this.timeout;
  }

  /**
   * Get suggested interval for current network conditions
   * @param {Object} conditions - Network conditions
   * @param {Boolean} conditions.topologyChange - True if topology recently changed
   * @param {Number} conditions.neighborCount - Number of active neighbors
   * @param {Boolean} conditions.congestion - True if network is congested
   * @returns {Number} Suggested interval in ms
   */
  getSuggestedInterval(conditions = {}) {
    let interval = 300000; // 5 minutes default

    // Faster heartbeats during topology changes
    if (conditions.topologyChange) {
      interval = 60000; // 1 minute
    }
    
    // Faster heartbeats with few neighbors (faster convergence)
    else if (conditions.neighborCount < 3) {
      interval = 120000; // 2 minutes
    }
    
    // Slower heartbeats with many neighbors (reduce bandwidth)
    else if (conditions.neighborCount > 10) {
      interval = 600000; // 10 minutes
    }
    
    // Much slower heartbeats if congested
    if (conditions.congestion) {
      interval = Math.max(interval * 2, 600000); // At least double, max 10 min
    }

    return interval;
  }

  /**
   * Create a KEEPALIVE packet (lightweight heartbeat)
   * Used between full heartbeats to maintain connection
   * @returns {Object} Keepalive data
   */
  createKeepalive() {
    return {
      nodeId: this.nodeId,
      timestamp: Date.now(),
      sequence: this.sequence
    };
  }
}

module.exports = Heartbeat;
