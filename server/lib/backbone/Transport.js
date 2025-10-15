/**
 * Transport.js
 * Abstract base class for backbone transport mechanisms (RF, Internet)
 * 
 * All transport implementations must extend this class and implement
 * the required methods for connection management and data exchange.
 */

const EventEmitter = require('events');

class Transport extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.connected = false;
    this.type = 'unknown'; // 'rf' or 'internet'
    this.localCallsign = config.localCallsign || '';
    this.metrics = {
      packetsSent: 0,
      packetsReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
      errors: 0,
      lastActivity: null
    };
  }

  /**
   * Connect to the transport medium
   * @param {Object} options - Transport-specific connection options
   * @returns {Promise<void>}
   */
  async connect(options = {}) {
    throw new Error('connect() must be implemented by subclass');
  }

  /**
   * Disconnect from the transport medium
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('disconnect() must be implemented by subclass');
  }

  /**
   * Send a packet to a destination
   * @param {String} destination - Destination callsign
   * @param {Buffer} data - Packet data to send
   * @param {Object} options - Transport-specific send options (priority, path, etc.)
   * @returns {Promise<Boolean>} - Success/failure
   */
  async send(destination, data, options = {}) {
    throw new Error('send() must be implemented by subclass');
  }

  /**
   * Check if transport is available and ready
   * @returns {Boolean}
   */
  isAvailable() {
    return this.connected;
  }

  /**
   * Get transport cost metric (for routing decisions)
   * Lower is better. RF typically 100-1000, Internet typically 10-50
   * @returns {Number}
   */
  getCost() {
    throw new Error('getCost() must be implemented by subclass');
  }

  /**
   * Get maximum transmission unit (MTU) for this transport
   * @returns {Number} - MTU in bytes
   */
  getMTU() {
    throw new Error('getMTU() must be implemented by subclass');
  }

  /**
   * Get transport metrics for monitoring
   * @returns {Object}
   */
  getMetrics() {
    return {
      ...this.metrics,
      connected: this.connected,
      type: this.type
    };
  }

  /**
   * Reset metrics counters
   */
  resetMetrics() {
    this.metrics = {
      packetsSent: 0,
      packetsReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
      errors: 0,
      lastActivity: null
    };
  }

  /**
   * Update metrics after send/receive
   * @param {String} direction - 'send' or 'receive'
   * @param {Number} bytes - Number of bytes transferred
   */
  _updateMetrics(direction, bytes) {
    this.metrics.lastActivity = Date.now();
    if (direction === 'send') {
      this.metrics.packetsSent++;
      this.metrics.bytesSent += bytes;
    } else if (direction === 'receive') {
      this.metrics.packetsReceived++;
      this.metrics.bytesReceived += bytes;
    }
  }

  /**
   * Record an error
   * @param {Error} error
   */
  _recordError(error) {
    this.metrics.errors++;
    this.emit('error', error);
  }
}

module.exports = Transport;
