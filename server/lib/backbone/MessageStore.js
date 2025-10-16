/**
 * MessageStore.js
 * Store-and-forward for OUTBOUND Winlink messages ONLY
 * 
 * CRITICAL DESIGN PRINCIPLE:
 * - ONLY stores outbound messages (from user to be forwarded)
 * - Does NOT store inbound messages (to user from remote)
 * - Rationale: Users must be able to retrieve inbound messages from ANY Winlink client
 *   (Pat, Winlink Express, etc.) via standard RMS protocols. If we store inbound messages,
 *   they become locked to NexDigi and unavailable to other clients.
 * 
 * Use Cases:
 * 1. User creates message offline → stored here → delivered when connection available
 * 2. User sends message but backbone unavailable → queued → retry when route available
 * 3. Message forwarding fails → queued → retry later
 * 
 * Responsibilities:
 * - Queue outbound messages per user (FROM user TO destination)
 * - Persist queue to disk (survive restarts)
 * - Retry delivery when routes become available
 * - Track delivery status
 * - Automatic expiration (default 7 days)
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Message status
const MessageStatus = {
  QUEUED: 'queued',       // Waiting for delivery
  FORWARDED: 'forwarded', // Sent to backbone
  DELIVERED: 'delivered', // Delivered successfully
  EXPIRED: 'expired',     // Expired before delivery
  FAILED: 'failed'        // Delivery failed permanently
};

class MessageStore extends EventEmitter {
  /**
   * Create a message store for OUTBOUND messages
   * @param {Object} config - Configuration
   * @param {String} config.dataDir - Directory for persistence
   * @param {Number} config.maxAge - Message expiration time (ms, default 604800000 = 7 days)
   * @param {Number} config.maxMessagesPerUser - Max queued messages per user (default 100)
   * @param {Number} config.cleanupInterval - Cleanup interval (ms, default 3600000 = 1 hour)
   */
  constructor(config = {}) {
    super();
    
    this.dataDir = config.dataDir || './data/message-store';
    this.maxAge = config.maxAge || 604800000; // 7 days
    this.maxMessagesPerUser = config.maxMessagesPerUser || 100;
    this.cleanupInterval = config.cleanupInterval || 3600000; // 1 hour
    
    // Message queues per user (OUTBOUND only)
    this.queues = new Map(); // callsign -> Array of messages
    
    // Statistics
    this.stats = {
      queued: 0,
      forwarded: 0,
      delivered: 0,
      expired: 0,
      failed: 0,
      totalSize: 0
    };
    
    // Cleanup timer
    this.cleanupTimer = null;
    this.started = false;
  }
  
  /**
   * Start the message store
   */
  async start() {
    if (this.started) return;
    
    console.log('[MessageStore] Starting...');
    
    // Load persisted messages
    await this.load();
    
    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.cleanupInterval);
    
    this.started = true;
    console.log(`[MessageStore] Started with ${this.getTotalMessages()} messages for ${this.queues.size} users`);
  }
  
  /**
   * Stop the message store
   */
  async stop() {
    if (!this.started) return;
    
    console.log('[MessageStore] Stopping...');
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // Save all queues
    await this.save();
    
    this.started = false;
    console.log('[MessageStore] Stopped');
  }
  
  /**
   * Queue an outbound message from a user
   * @param {String} userCallsign - User's callsign (sender)
   * @param {Object} message - Message to queue
   * @param {String} message.from - Sender (must match userCallsign)
   * @param {String} message.to - Recipient
   * @param {String} message.type - Message type
   * @param {Buffer} message.data - Message data
   * @param {String} message.mid - Message ID (optional)
   * @param {Object} message.metadata - Additional metadata
   * @returns {String} Message ID
   */
  async queueMessage(userCallsign, message) {
    userCallsign = userCallsign.toUpperCase();
    
    // CRITICAL: Validate this is an outbound message (FROM the user)
    if (message.from.toUpperCase() !== userCallsign) {
      console.warn(`[MessageStore] Rejecting message: from ${message.from} doesn't match user ${userCallsign}`);
      throw new Error('Can only queue outbound messages (from must match user)');
    }
    
    // Generate message ID if not provided
    const messageId = message.mid || this._generateMessageId();
    
    // Get or create queue for user
    if (!this.queues.has(userCallsign)) {
      this.queues.set(userCallsign, []);
    }
    
    const queue = this.queues.get(userCallsign);
    
    // Check queue size limit
    if (queue.length >= this.maxMessagesPerUser) {
      console.warn(`[MessageStore] Queue full for ${userCallsign} (${queue.length} messages)`);
      this.stats.failed++;
      throw new Error(`Message queue full for ${userCallsign}`);
    }
    
    // Create queue entry
    const entry = {
      messageId,
      from: message.from,
      to: message.to,
      type: message.type,
      data: message.data,
      metadata: message.metadata || {},
      status: MessageStatus.QUEUED,
      queuedAt: Date.now(),
      attempts: 0,
      size: message.data.length
    };
    
    queue.push(entry);
    
    this.stats.queued++;
    this.stats.totalSize += entry.size;
    
    console.log(`[MessageStore] Queued message ${messageId} for ${userCallsign} → ${message.to} (${entry.size} bytes)`);
    
    // Persist immediately
    await this._saveUserQueue(userCallsign);
    
    this.emit('message-queued', userCallsign, messageId, entry);
    
    return messageId;
  }
  
  /**
   * Get all queued (pending) messages for a user
   * @param {String} userCallsign - User's callsign
   * @returns {Array} Array of queued messages
   */
  getQueuedMessages(userCallsign) {
    userCallsign = userCallsign.toUpperCase();
    const queue = this.queues.get(userCallsign);
    
    if (!queue) {
      return [];
    }
    
    // Return only queued messages (not forwarded/delivered/failed/expired)
    return queue.filter(msg => msg.status === MessageStatus.QUEUED);
  }
  
  /**
   * Get count of queued messages for a user
   * @param {String} userCallsign - User's callsign
   * @returns {Number} Count of queued messages
   */
  getQueuedCount(userCallsign) {
    return this.getQueuedMessages(userCallsign).length;
  }
  
  /**
   * Mark a message as forwarded
   * @param {String} userCallsign - User's callsign
   * @param {String} messageId - Message ID
   * @returns {Boolean} Success
   */
  async markForwarded(userCallsign, messageId) {
    userCallsign = userCallsign.toUpperCase();
    const queue = this.queues.get(userCallsign);
    
    if (!queue) {
      return false;
    }
    
    const message = queue.find(msg => msg.messageId === messageId);
    
    if (!message) {
      return false;
    }
    
    message.status = MessageStatus.FORWARDED;
    message.forwardedAt = Date.now();
    message.attempts++;
    
    this.stats.forwarded++;
    
    console.log(`[MessageStore] Message ${messageId} forwarded (attempt ${message.attempts})`);
    
    // Persist
    await this._saveUserQueue(userCallsign);
    
    this.emit('message-forwarded', userCallsign, messageId);
    
    return true;
  }
  
  /**
   * Mark a message as delivered
   * @param {String} userCallsign - User's callsign
   * @param {String} messageId - Message ID
   * @returns {Boolean} Success
   */
  async markDelivered(userCallsign, messageId) {
    userCallsign = userCallsign.toUpperCase();
    const queue = this.queues.get(userCallsign);
    
    if (!queue) {
      return false;
    }
    
    const message = queue.find(msg => msg.messageId === messageId);
    
    if (!message) {
      return false;
    }
    
    message.status = MessageStatus.DELIVERED;
    message.deliveredAt = Date.now();
    
    this.stats.delivered++;
    
    console.log(`[MessageStore] Message ${messageId} delivered to ${message.to}`);
    
    // Persist
    await this._saveUserQueue(userCallsign);
    
    this.emit('message-delivered', userCallsign, messageId);
    
    return true;
  }
  
  /**
   * Mark a message as failed
   * @param {String} userCallsign - User's callsign
   * @param {String} messageId - Message ID
   * @param {String} reason - Failure reason
   * @returns {Boolean} Success
   */
  async markFailed(userCallsign, messageId, reason) {
    userCallsign = userCallsign.toUpperCase();
    const queue = this.queues.get(userCallsign);
    
    if (!queue) {
      return false;
    }
    
    const message = queue.find(msg => msg.messageId === messageId);
    
    if (!message) {
      return false;
    }
    
    message.status = MessageStatus.FAILED;
    message.failedAt = Date.now();
    message.failureReason = reason;
    
    this.stats.failed++;
    
    console.log(`[MessageStore] Message ${messageId} failed: ${reason}`);
    
    // Persist
    await this._saveUserQueue(userCallsign);
    
    this.emit('message-failed', userCallsign, messageId, reason);
    
    return true;
  }
  
  /**
   * Delete a message from the queue
   * @param {String} userCallsign - User's callsign
   * @param {String} messageId - Message ID
   * @returns {Boolean} Success
   */
  async deleteMessage(userCallsign, messageId) {
    userCallsign = userCallsign.toUpperCase();
    const queue = this.queues.get(userCallsign);
    
    if (!queue) {
      return false;
    }
    
    const index = queue.findIndex(msg => msg.messageId === messageId);
    
    if (index === -1) {
      return false;
    }
    
    const message = queue[index];
    this.stats.totalSize -= message.size;
    
    queue.splice(index, 1);
    
    console.log(`[MessageStore] Deleted message ${messageId} for ${userCallsign}`);
    
    // Clean up empty queues
    if (queue.length === 0) {
      this.queues.delete(userCallsign);
      await this._deleteUserQueue(userCallsign);
    } else {
      await this._saveUserQueue(userCallsign);
    }
    
    this.emit('message-deleted', userCallsign, messageId);
    
    return true;
  }
  
  /**
   * Clean up expired messages
   */
  async cleanupExpired() {
    const now = Date.now();
    let expiredCount = 0;
    const toCleanup = [];
    
    for (const [callsign, queue] of this.queues) {
      const expired = [];
      
      for (let i = queue.length - 1; i >= 0; i--) {
        const message = queue[i];
        
        // Skip already delivered/failed messages (they'll be cleaned separately)
        if (message.status !== MessageStatus.QUEUED && message.status !== MessageStatus.FORWARDED) {
          continue;
        }
        
        const age = now - message.queuedAt;
        
        if (age > this.maxAge) {
          message.status = MessageStatus.EXPIRED;
          message.expiredAt = now;
          expired.push(message.messageId);
          expiredCount++;
          
          this.stats.expired++;
          this.emit('message-expired', callsign, message.messageId);
        }
      }
      
      if (expired.length > 0) {
        toCleanup.push(callsign);
      }
    }
    
    // Save queues with expired messages
    for (const callsign of toCleanup) {
      await this._saveUserQueue(callsign);
    }
    
    // Clean up old delivered/failed/expired messages (keep for 24 hours then delete)
    for (const [callsign, queue] of this.queues) {
      let needsSave = false;
      
      for (let i = queue.length - 1; i >= 0; i--) {
        const message = queue[i];
        
        if (message.status === MessageStatus.DELIVERED && message.deliveredAt) {
          if (now - message.deliveredAt > 86400000) { // 24 hours
            this.stats.totalSize -= message.size;
            queue.splice(i, 1);
            needsSave = true;
          }
        } else if (message.status === MessageStatus.FAILED && message.failedAt) {
          if (now - message.failedAt > 86400000) {
            this.stats.totalSize -= message.size;
            queue.splice(i, 1);
            needsSave = true;
          }
        } else if (message.status === MessageStatus.EXPIRED && message.expiredAt) {
          if (now - message.expiredAt > 86400000) {
            this.stats.totalSize -= message.size;
            queue.splice(i, 1);
            needsSave = true;
          }
        }
      }
      
      if (needsSave) {
        if (queue.length === 0) {
          this.queues.delete(callsign);
          await this._deleteUserQueue(callsign);
        } else {
          await this._saveUserQueue(callsign);
        }
      }
    }
    
    if (expiredCount > 0) {
      console.log(`[MessageStore] Cleaned up ${expiredCount} expired messages`);
    }
  }
  
  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      users: this.queues.size,
      totalMessages: this.getTotalMessages(),
      queuedMessages: this._countByStatus(MessageStatus.QUEUED),
      forwardedMessages: this._countByStatus(MessageStatus.FORWARDED)
    };
  }
  
  /**
   * Get total message count
   * @returns {Number} Total messages
   */
  getTotalMessages() {
    let count = 0;
    for (const queue of this.queues.values()) {
      count += queue.length;
    }
    return count;
  }
  
  // Private methods
  
  /**
   * Count messages by status
   * @private
   */
  _countByStatus(status) {
    let count = 0;
    for (const queue of this.queues.values()) {
      count += queue.filter(msg => msg.status === status).length;
    }
    return count;
  }
  
  /**
   * Generate a message ID
   * @private
   */
  _generateMessageId() {
    return crypto.randomBytes(16).toString('hex');
  }
  
  /**
   * Load all persisted queues
   * @private
   */
  async load() {
    try {
      // Ensure data directory exists
      await fs.mkdir(this.dataDir, { recursive: true });
      
      // Read all .json files
      const files = await fs.readdir(this.dataDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const callsign = file.replace('.json', '');
          await this._loadUserQueue(callsign);
        }
      }
      
      console.log(`[MessageStore] Loaded queues for ${this.queues.size} users`);
      
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[MessageStore] Error loading queues:', error.message);
      }
    }
  }
  
  /**
   * Save all queues
   * @private
   */
  async save() {
    const promises = [];
    
    for (const callsign of this.queues.keys()) {
      promises.push(this._saveUserQueue(callsign));
    }
    
    await Promise.all(promises);
  }
  
  /**
   * Load a user's queue
   * @private
   */
  async _loadUserQueue(callsign) {
    const filePath = path.join(this.dataDir, `${callsign}.json`);
    
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const queue = JSON.parse(data);
      
      // Convert data back to Buffer
      for (const message of queue) {
        message.data = Buffer.from(message.data, 'base64');
      }
      
      this.queues.set(callsign, queue);
      
      // Update stats
      for (const message of queue) {
        this.stats.totalSize += message.size;
      }
      
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[MessageStore] Error loading queue for ${callsign}:`, error.message);
      }
    }
  }
  
  /**
   * Save a user's queue
   * @private
   */
  async _saveUserQueue(callsign) {
    const filePath = path.join(this.dataDir, `${callsign}.json`);
    const queue = this.queues.get(callsign);
    
    if (!queue || queue.length === 0) {
      // Delete empty queue file
      await this._deleteUserQueue(callsign);
      return;
    }
    
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      
      // Convert Buffer to base64 for JSON
      const serializable = queue.map(msg => ({
        ...msg,
        data: msg.data.toString('base64')
      }));
      
      await fs.writeFile(filePath, JSON.stringify(serializable, null, 2), 'utf8');
      
    } catch (error) {
      console.error(`[MessageStore] Error saving queue for ${callsign}:`, error.message);
    }
  }
  
  /**
   * Delete a user's queue file
   * @private
   */
  async _deleteUserQueue(callsign) {
    const filePath = path.join(this.dataDir, `${callsign}.json`);
    
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[MessageStore] Error deleting queue for ${callsign}:`, error.message);
      }
    }
  }
}

// Export status constants
MessageStore.MessageStatus = MessageStatus;

module.exports = MessageStore;
