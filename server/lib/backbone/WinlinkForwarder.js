/**
 * WinlinkForwarder.js
 * Handles Winlink message forwarding across the backbone network
 * 
 * Responsibilities:
 * - Detect Winlink messages for non-local users
 * - Query UserRegistry for recipient's home node
 * - Encapsulate Winlink messages in backbone DATA packets
 * - Forward messages to home nodes via routing engine
 * - Handle delivery notifications and failures
 * - Support CMS gateway routing
 * 
 * Design:
 * - Messages are encapsulated with metadata (sender, recipient, type)
 * - Uses backbone routing for multi-hop delivery
 * - Tracks message delivery status
 * - Integrates with ReliabilityManager for ACKs
 */

const EventEmitter = require('events');
const crypto = require('crypto');

// Winlink message types
const MessageType = {
  P2P: 'p2p',           // Peer-to-peer (user to user)
  TO_CMS: 'to-cms',     // User to CMS (outbound to internet)
  FROM_CMS: 'from-cms', // CMS to user (inbound from internet)
  POSITION: 'position', // Position report
  BULLETIN: 'bulletin'  // Bulletin message
};

// Message status
const MessageStatus = {
  PENDING: 'pending',
  FORWARDED: 'forwarded',
  DELIVERED: 'delivered',
  FAILED: 'failed'
};

class WinlinkForwarder extends EventEmitter {
  /**
   * Create a Winlink forwarder
   * @param {Object} config - Configuration
   * @param {Object} config.backboneManager - BackboneManager instance
   * @param {Object} config.userRegistry - UserRegistry instance
   * @param {String} config.localCallsign - This node's callsign
   * @param {Boolean} config.cmsGateway - Is this node a CMS gateway?
   * @param {Number} config.messageTimeout - Message timeout (ms, default 3600000 = 1hr)
   * @param {Number} config.retryDelay - Retry delay (ms, default 300000 = 5min)
   */
  constructor(config = {}) {
    super();
    
    this.backboneManager = config.backboneManager;
    this.userRegistry = config.userRegistry;
    this.localCallsign = config.localCallsign || 'UNKNOWN';
    this.cmsGateway = config.cmsGateway || false;
    this.messageTimeout = config.messageTimeout || 3600000; // 1 hour
    this.retryDelay = config.retryDelay || 300000; // 5 minutes
    
    // Message tracking
    this.pendingMessages = new Map(); // messageId -> { message, status, timestamp, attempts }
    this.deliveredMessages = new Map(); // messageId -> { timestamp, recipient }
    
    // Statistics
    this.stats = {
      forwarded: 0,
      delivered: 0,
      failed: 0,
      toLocal: 0,
      toRemote: 0,
      toCMS: 0,
      fromCMS: 0,
      retries: 0
    };
    
    // Cleanup timer
    this.cleanupTimer = null;
    this.started = false;
  }
  
  /**
   * Start the forwarder
   */
  start() {
    if (this.started) return;
    
    console.log(`[WinlinkForwarder] Starting for node ${this.localCallsign}` +
      (this.cmsGateway ? ' (CMS Gateway)' : ''));
    
    // Listen for backbone events
    if (this.backboneManager) {
      this.backboneManager.on('message-acknowledged', (messageId, rtt) => {
        this._handleAck(messageId, rtt);
      });
      
      this.backboneManager.on('message-failed', (messageId, reason) => {
        this._handleFailure(messageId, reason);
      });
    }
    
    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this._cleanupOldMessages();
    }, 60000); // Every minute
    
    this.started = true;
    console.log('[WinlinkForwarder] Started');
  }
  
  /**
   * Stop the forwarder
   */
  stop() {
    if (!this.started) return;
    
    console.log('[WinlinkForwarder] Stopping...');
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    this.started = false;
    console.log('[WinlinkForwarder] Stopped');
  }
  
  /**
   * Forward a Winlink message
   * @param {Object} message - Winlink message
   * @param {String} message.from - Sender callsign
   * @param {String} message.to - Recipient callsign
   * @param {String} message.type - Message type (p2p, to-cms, from-cms, etc.)
   * @param {Buffer} message.data - Message data (RFC-822 format or B2F compressed)
   * @param {String} message.mid - Message ID (optional, will be generated if not provided)
   * @param {Object} message.metadata - Additional metadata
   * @returns {Promise<String>} Message ID
   */
  async forwardMessage(message) {
    if (!this.started) {
      throw new Error('WinlinkForwarder not started');
    }
    
    // Generate message ID if not provided
    const messageId = message.mid || this._generateMessageId();
    
    console.log(`[WinlinkForwarder] Forwarding message ${messageId}: ${message.from} → ${message.to} (${message.type})`);
    
    // Validate message
    if (!message.from || !message.to || !message.data) {
      throw new Error('Invalid message: missing required fields');
    }
    
    // Determine routing
    const route = await this._determineRoute(message);
    
    if (!route) {
      console.error(`[WinlinkForwarder] Cannot determine route for ${message.to}`);
      this.stats.failed++;
      this.emit('forward-failed', messageId, message, 'No route to destination');
      throw new Error(`No route to destination: ${message.to}`);
    }
    
    console.log(`[WinlinkForwarder] Route: ${route.type} to ${route.destination}`);
    
    // Track message
    this.pendingMessages.set(messageId, {
      message,
      route,
      status: MessageStatus.PENDING,
      timestamp: Date.now(),
      attempts: 0
    });
    
    // Send via backbone
    try {
      await this._sendViaBackbone(messageId, message, route);
      
      this.stats.forwarded++;
      this.emit('message-forwarded', messageId, message, route);
      
      return messageId;
      
    } catch (error) {
      console.error(`[WinlinkForwarder] Failed to send ${messageId}:`, error.message);
      this.stats.failed++;
      this.pendingMessages.delete(messageId);
      this.emit('forward-failed', messageId, message, error.message);
      throw error;
    }
  }
  
  /**
   * Receive a Winlink message from the backbone
   * @param {String} messageId - Message ID
   * @param {Buffer} payload - Encapsulated message payload
   * @returns {Object} Decoded message
   */
  receiveMessage(messageId, payload) {
    console.log(`[WinlinkForwarder] Receiving message ${messageId}`);
    
    try {
      // Decode the encapsulated message
      const message = this._decodeMessage(payload);
      
      console.log(`[WinlinkForwarder] Decoded: ${message.from} → ${message.to} (${message.type})`);
      
      // Check if recipient is local
      if (this.userRegistry && this.userRegistry.isLocalUser(message.to)) {
        console.log(`[WinlinkForwarder] Message for local user ${message.to}`);
        this.stats.toLocal++;
        this.emit('message-received', messageId, message);
        return message;
      }
      
      // Check if this is for CMS and we're a gateway
      if (message.type === MessageType.TO_CMS && this.cmsGateway) {
        console.log(`[WinlinkForwarder] Message for CMS, we are gateway`);
        this.stats.toCMS++;
        this.emit('message-for-cms', messageId, message);
        return message;
      }
      
      // Check if this is from CMS and recipient is local
      if (message.type === MessageType.FROM_CMS && this.userRegistry && this.userRegistry.isLocalUser(message.to)) {
        console.log(`[WinlinkForwarder] Message from CMS for local user ${message.to}`);
        this.stats.fromCMS++;
        this.emit('message-received', messageId, message);
        return message;
      }
      
      // Not for us - this shouldn't happen if routing is correct
      console.warn(`[WinlinkForwarder] Received message not for this node: ${message.to}`);
      this.emit('message-misrouted', messageId, message);
      
      return message;
      
    } catch (error) {
      console.error(`[WinlinkForwarder] Failed to decode message ${messageId}:`, error.message);
      this.emit('receive-error', messageId, error.message);
      throw error;
    }
  }
  
  /**
   * Get message status
   * @param {String} messageId - Message ID
   * @returns {Object|null} Message status or null if not found
   */
  getMessageStatus(messageId) {
    const pending = this.pendingMessages.get(messageId);
    if (pending) {
      return {
        messageId,
        status: pending.status,
        from: pending.message.from,
        to: pending.message.to,
        type: pending.message.type,
        timestamp: pending.timestamp,
        attempts: pending.attempts,
        destination: pending.route.destination
      };
    }
    
    const delivered = this.deliveredMessages.get(messageId);
    if (delivered) {
      return {
        messageId,
        status: MessageStatus.DELIVERED,
        recipient: delivered.recipient,
        timestamp: delivered.timestamp
      };
    }
    
    return null;
  }
  
  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      pending: this.pendingMessages.size,
      delivered: this.deliveredMessages.size
    };
  }
  
  // Private methods
  
  /**
   * Determine route for a message
   * @private
   */
  async _determineRoute(message) {
    const { to, type } = message;
    
    // CMS-bound messages
    if (type === MessageType.TO_CMS) {
      // Find CMS gateway
      // For now, if we're a gateway, handle it locally
      // Otherwise, look for a gateway in the network
      if (this.cmsGateway) {
        return {
          type: 'local-cms',
          destination: this.localCallsign
        };
      }
      
      // TODO: Query service registry for CMS gateway
      // For now, return null (no CMS gateway available)
      return null;
    }
    
    // P2P messages - look up recipient's home node
    if (this.userRegistry) {
      const homeNode = this.userRegistry.getHomeNode(to);
      
      if (homeNode) {
        if (homeNode === this.localCallsign) {
          // Local user
          return {
            type: 'local',
            destination: this.localCallsign
          };
        } else {
          // Remote user
          return {
            type: 'remote',
            destination: homeNode
          };
        }
      }
    }
    
    // Unknown user
    console.warn(`[WinlinkForwarder] Unknown recipient: ${to}`);
    return null;
  }
  
  /**
   * Send message via backbone
   * @private
   */
  async _sendViaBackbone(messageId, message, route) {
    if (!this.backboneManager) {
      throw new Error('BackboneManager not configured');
    }
    
    // Encode message
    const payload = this._encodeMessage(message);
    
    // Send via backbone DATA packet
    const backboneMessageId = await this.backboneManager.sendData(
      route.destination,
      payload,
      {
        priority: message.priority || 1, // Default to NORMAL priority
        messageId: messageId // Use our message ID for tracking
      }
    );
    
    console.log(`[WinlinkForwarder] Sent ${messageId} via backbone (backbone ID: ${backboneMessageId})`);
    
    // Update tracking
    const tracking = this.pendingMessages.get(messageId);
    if (tracking) {
      tracking.status = MessageStatus.FORWARDED;
      tracking.attempts++;
      tracking.backboneMessageId = backboneMessageId;
    }
    
    // Update stats
    if (route.type === 'remote') {
      this.stats.toRemote++;
    } else if (route.type === 'local') {
      this.stats.toLocal++;
    } else if (route.type === 'local-cms') {
      this.stats.toCMS++;
    }
  }
  
  /**
   * Encode message for backbone transmission
   * @private
   */
  _encodeMessage(message) {
    const encoded = {
      from: message.from,
      to: message.to,
      type: message.type,
      mid: message.mid,
      timestamp: Date.now(),
      metadata: message.metadata || {},
      data: message.data.toString('base64') // Base64 encode the data
    };
    
    return Buffer.from(JSON.stringify(encoded), 'utf8');
  }
  
  /**
   * Decode message from backbone
   * @private
   */
  _decodeMessage(payload) {
    const decoded = JSON.parse(payload.toString('utf8'));
    
    return {
      from: decoded.from,
      to: decoded.to,
      type: decoded.type,
      mid: decoded.mid,
      timestamp: decoded.timestamp,
      metadata: decoded.metadata || {},
      data: Buffer.from(decoded.data, 'base64') // Decode from base64
    };
  }
  
  /**
   * Handle ACK from backbone
   * @private
   */
  _handleAck(messageId, rtt) {
    const tracking = this.pendingMessages.get(messageId);
    if (!tracking) return;
    
    console.log(`[WinlinkForwarder] Message ${messageId} acknowledged (RTT: ${rtt}ms)`);
    
    // Mark as delivered
    tracking.status = MessageStatus.DELIVERED;
    
    this.deliveredMessages.set(messageId, {
      timestamp: Date.now(),
      recipient: tracking.message.to,
      rtt
    });
    
    this.pendingMessages.delete(messageId);
    this.stats.delivered++;
    
    this.emit('message-delivered', messageId, tracking.message, rtt);
  }
  
  /**
   * Handle failure from backbone
   * @private
   */
  _handleFailure(messageId, reason) {
    const tracking = this.pendingMessages.get(messageId);
    if (!tracking) return;
    
    console.error(`[WinlinkForwarder] Message ${messageId} failed: ${reason}`);
    
    // Check if we should retry
    if (tracking.attempts < 3) {
      console.log(`[WinlinkForwarder] Will retry message ${messageId} (attempt ${tracking.attempts + 1}/3)`);
      
      this.stats.retries++;
      
      // Schedule retry
      setTimeout(() => {
        this._retryMessage(messageId);
      }, this.retryDelay);
      
    } else {
      // Mark as failed
      tracking.status = MessageStatus.FAILED;
      this.pendingMessages.delete(messageId);
      this.stats.failed++;
      
      this.emit('message-failed', messageId, tracking.message, reason);
    }
  }
  
  /**
   * Retry a failed message
   * @private
   */
  async _retryMessage(messageId) {
    const tracking = this.pendingMessages.get(messageId);
    if (!tracking) return;
    
    console.log(`[WinlinkForwarder] Retrying message ${messageId}`);
    
    try {
      await this._sendViaBackbone(messageId, tracking.message, tracking.route);
      this.emit('message-retried', messageId, tracking.message);
    } catch (error) {
      console.error(`[WinlinkForwarder] Retry failed for ${messageId}:`, error.message);
      this._handleFailure(messageId, error.message);
    }
  }
  
  /**
   * Clean up old messages
   * @private
   */
  _cleanupOldMessages() {
    const now = Date.now();
    const toRemove = [];
    
    // Clean up old pending messages
    for (const [messageId, tracking] of this.pendingMessages) {
      const age = now - tracking.timestamp;
      if (age > this.messageTimeout) {
        console.log(`[WinlinkForwarder] Timing out message ${messageId} (age: ${Math.round(age / 1000)}s)`);
        toRemove.push(messageId);
      }
    }
    
    for (const messageId of toRemove) {
      const tracking = this.pendingMessages.get(messageId);
      this.pendingMessages.delete(messageId);
      this.stats.failed++;
      this.emit('message-timeout', messageId, tracking.message);
    }
    
    // Clean up old delivered messages (keep for 24 hours)
    const deliveredToRemove = [];
    for (const [messageId, info] of this.deliveredMessages) {
      const age = now - info.timestamp;
      if (age > 86400000) { // 24 hours
        deliveredToRemove.push(messageId);
      }
    }
    
    for (const messageId of deliveredToRemove) {
      this.deliveredMessages.delete(messageId);
    }
    
    if (toRemove.length > 0 || deliveredToRemove.length > 0) {
      console.log(`[WinlinkForwarder] Cleaned up ${toRemove.length} timed out, ${deliveredToRemove.length} old delivered`);
    }
  }
  
  /**
   * Generate a message ID
   * @private
   */
  _generateMessageId() {
    return crypto.randomBytes(16).toString('hex');
  }
}

// Export message types for external use
WinlinkForwarder.MessageType = MessageType;
WinlinkForwarder.MessageStatus = MessageStatus;

module.exports = WinlinkForwarder;
