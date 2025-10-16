/**
 * ReliabilityManager.js
 * Manages ACK/NACK protocol, retransmission, and timeouts
 * 
 * Features:
 * - ACK timeout tracking with exponential backoff
 * - Retransmission with max retry limit
 * - NACK handling with alternate route selection
 * - Message state tracking (pending, acknowledged, failed)
 */

const EventEmitter = require('events');

// Message states
const MessageState = {
  PENDING: 'pending',      // Waiting for ACK
  ACKNOWLEDGED: 'acknowledged', // ACK received
  FAILED: 'failed',        // Max retries exceeded
  TIMEOUT: 'timeout'       // ACK timeout
};

class ReliabilityManager extends EventEmitter {
  /**
   * Create reliability manager
   * @param {Object} config - Configuration
   * @param {Number} config.ackTimeout - Base ACK timeout in ms (default: 1000)
   * @param {Number} config.maxRetries - Max retransmission attempts (default: 5)
   * @param {Number} config.cleanupInterval - Cleanup interval in ms (default: 60000)
   */
  constructor(config = {}) {
    super();
    
    this.ackTimeout = config.ackTimeout || 1000; // 1 second base timeout
    this.maxRetries = config.maxRetries || 5;
    this.cleanupInterval = config.cleanupInterval || 60000; // 1 minute
    
    // Pending messages: messageId -> { message, sentAt, timeout, retries, nextTimeout }
    this.pending = new Map();
    
    // Acknowledged messages (recent history): messageId -> { acknowledgedAt, roundTripTime }
    this.acknowledged = new Map();
    
    // Failed messages: messageId -> { failedAt, reason }
    this.failed = new Map();
    
    // Cleanup timer
    this.cleanupTimer = null;
    
    // Statistics
    this.stats = {
      sent: 0,
      acknowledged: 0,
      failed: 0,
      retransmitted: 0,
      avgRoundTripTime: 0
    };
  }

  /**
   * Start cleanup of old message records
   */
  start() {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => this._cleanup(), this.cleanupInterval);
    console.log('[ReliabilityManager] Started');
  }

  /**
   * Stop cleanup
   */
  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.log('[ReliabilityManager] Stopped');
    }
  }

  /**
   * Track a sent message waiting for ACK
   * @param {String} messageId - Message ID
   * @param {Object} message - Message data
   * @param {String} message.destination - Destination callsign
   * @param {String} message.source - Source callsign
   * @param {Buffer} message.packet - Packet data
   * @param {Object} message.options - Send options
   */
  trackMessage(messageId, message) {
    const now = Date.now();
    const timeout = this._calculateTimeout(0); // Start with base timeout
    
    this.pending.set(messageId, {
      message: message,
      sentAt: now,
      timeout: now + timeout,
      retries: 0,
      nextTimeout: timeout
    });
    
    this.stats.sent++;
  }

  /**
   * Process received ACK
   * @param {String} messageId - Message ID being acknowledged
   * @returns {Boolean} True if message was pending, false otherwise
   */
  handleAck(messageId) {
    const pending = this.pending.get(messageId);
    
    if (!pending) {
      return false; // Not pending or already handled
    }

    const now = Date.now();
    const roundTripTime = now - pending.sentAt;
    
    // Move to acknowledged
    this.acknowledged.set(messageId, {
      acknowledgedAt: now,
      roundTripTime: roundTripTime
    });
    
    this.pending.delete(messageId);
    this.stats.acknowledged++;
    
    // Update avg RTT
    this._updateAvgRtt(roundTripTime);
    
    console.log(`[ReliabilityManager] ACK received for ${messageId} (RTT: ${roundTripTime}ms, retries: ${pending.retries})`);
    this.emit('acknowledged', messageId, roundTripTime);
    
    return true;
  }

  /**
   * Process received NACK
   * @param {String} messageId - Message ID being NACKed
   * @param {String} reason - NACK reason
   * @returns {Object|null} Message to retry or null
   */
  handleNack(messageId, reason) {
    const pending = this.pending.get(messageId);
    
    if (!pending) {
      return null; // Not pending
    }

    console.log(`[ReliabilityManager] NACK received for ${messageId}: ${reason}`);
    
    // Increment retries
    pending.retries++;
    
    if (pending.retries >= this.maxRetries) {
      // Max retries exceeded
      this._markFailed(messageId, `NACK: ${reason}, max retries exceeded`);
      return null;
    }
    
    // Return message for retransmission with alternate route
    this.stats.retransmitted++;
    this.emit('nack', messageId, reason);
    
    return pending.message;
  }

  /**
   * Check for timeouts and return messages needing retransmission
   * @returns {Array} Array of {messageId, message} to retransmit
   */
  checkTimeouts() {
    const now = Date.now();
    const toRetransmit = [];
    
    for (const [messageId, pending] of this.pending) {
      if (now >= pending.timeout) {
        pending.retries++;
        
        if (pending.retries >= this.maxRetries) {
          // Max retries exceeded
          this._markFailed(messageId, 'ACK timeout, max retries exceeded');
        } else {
          // Schedule retransmission with exponential backoff
          const nextTimeout = this._calculateTimeout(pending.retries);
          pending.sentAt = now;
          pending.timeout = now + nextTimeout;
          pending.nextTimeout = nextTimeout;
          
          toRetransmit.push({
            messageId: messageId,
            message: pending.message
          });
          
          this.stats.retransmitted++;
          console.log(`[ReliabilityManager] Timeout for ${messageId}, retry ${pending.retries}/${this.maxRetries} (backoff: ${nextTimeout}ms)`);
        }
      }
    }
    
    if (toRetransmit.length > 0) {
      this.emit('timeout', toRetransmit);
    }
    
    return toRetransmit;
  }

  /**
   * Calculate timeout with exponential backoff
   * @private
   * @param {Number} retries - Number of retries so far
   * @returns {Number} Timeout in ms
   */
  _calculateTimeout(retries) {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    return this.ackTimeout * Math.pow(2, retries);
  }

  /**
   * Mark message as failed
   * @private
   * @param {String} messageId - Message ID
   * @param {String} reason - Failure reason
   */
  _markFailed(messageId, reason) {
    const pending = this.pending.get(messageId);
    
    if (!pending) {
      return;
    }

    this.failed.set(messageId, {
      failedAt: Date.now(),
      reason: reason
    });
    
    this.pending.delete(messageId);
    this.stats.failed++;
    
    console.error(`[ReliabilityManager] Message ${messageId} failed: ${reason}`);
    this.emit('failed', messageId, reason);
  }

  /**
   * Update average round-trip time
   * @private
   * @param {Number} rtt - Latest RTT measurement
   */
  _updateAvgRtt(rtt) {
    if (this.stats.avgRoundTripTime === 0) {
      this.stats.avgRoundTripTime = rtt;
    } else {
      // Exponential moving average (alpha = 0.125)
      this.stats.avgRoundTripTime = 0.875 * this.stats.avgRoundTripTime + 0.125 * rtt;
    }
  }

  /**
   * Cleanup old message records
   * @private
   */
  _cleanup() {
    const now = Date.now();
    const ackMaxAge = 300000; // 5 minutes
    const failMaxAge = 600000; // 10 minutes
    
    // Cleanup old ACKs
    for (const [messageId, ack] of this.acknowledged) {
      if (now - ack.acknowledgedAt > ackMaxAge) {
        this.acknowledged.delete(messageId);
      }
    }
    
    // Cleanup old failures
    for (const [messageId, fail] of this.failed) {
      if (now - fail.failedAt > failMaxAge) {
        this.failed.delete(messageId);
      }
    }
  }

  /**
   * Get message state
   * @param {String} messageId - Message ID
   * @returns {String} Message state
   */
  getMessageState(messageId) {
    if (this.pending.has(messageId)) {
      return MessageState.PENDING;
    }
    if (this.acknowledged.has(messageId)) {
      return MessageState.ACKNOWLEDGED;
    }
    if (this.failed.has(messageId)) {
      return MessageState.FAILED;
    }
    return null;
  }

  /**
   * Check if message is pending
   * @param {String} messageId - Message ID
   * @returns {Boolean} True if pending
   */
  isPending(messageId) {
    return this.pending.has(messageId);
  }

  /**
   * Get pending message count
   * @returns {Number} Number of pending messages
   */
  getPendingCount() {
    return this.pending.size;
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      pending: this.pending.size,
      acknowledged: this.stats.acknowledged,
      failed: this.stats.failed,
      sent: this.stats.sent,
      retransmitted: this.stats.retransmitted,
      avgRoundTripTime: Math.round(this.stats.avgRoundTripTime),
      successRate: this.stats.sent > 0 
        ? Math.round((this.stats.acknowledged / this.stats.sent) * 100) 
        : 0
    };
  }

  /**
   * Export pending messages for debugging
   * @returns {Array} Pending messages
   */
  toArray() {
    const now = Date.now();
    return Array.from(this.pending.entries()).map(([messageId, pending]) => ({
      messageId,
      destination: pending.message.destination,
      retries: pending.retries,
      nextRetryIn: Math.max(0, pending.timeout - now),
      age: now - pending.sentAt
    }));
  }

  /**
   * Clear all tracked messages
   */
  clear() {
    this.pending.clear();
    this.acknowledged.clear();
    this.failed.clear();
  }
}

// Export state enum
ReliabilityManager.MessageState = MessageState;

module.exports = ReliabilityManager;
