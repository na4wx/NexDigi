/**
 * MessageQueue.js
 * Priority-based message queue for backbone packet forwarding
 * 
 * Implements 4 priority levels with FIFO ordering within each level:
 * - EMERGENCY: Life/safety traffic (highest priority)
 * - HIGH: Time-sensitive messages (CMS, APRS)
 * - NORMAL: Standard traffic (BBS messages, routine data)
 * - LOW: Bulk transfers, synchronization (lowest priority)
 */

const EventEmitter = require('events');

// Priority levels (higher number = higher priority)
const Priority = {
  EMERGENCY: 3,
  HIGH: 2,
  NORMAL: 1,
  LOW: 0
};

class MessageQueue extends EventEmitter {
  /**
   * Create message queue
   * @param {Object} config - Configuration
   * @param {Number} config.maxSize - Maximum total queue size (default: 1000)
   * @param {Number} config.maxSizePerPriority - Max size per priority queue (default: 500)
   * @param {Number} config.lowPriorityDropThreshold - Drop LOW when queue > this % full (default: 0.8)
   * @param {Number} config.normalPriorityDropThreshold - Drop NORMAL when queue > this % full (default: 0.9)
   */
  constructor(config = {}) {
    super();
    
    this.maxSize = config.maxSize || 1000;
    this.maxSizePerPriority = config.maxSizePerPriority || 500;
    this.lowPriorityDropThreshold = config.lowPriorityDropThreshold || 0.8;
    this.normalPriorityDropThreshold = config.normalPriorityDropThreshold || 0.9;
    
    // Priority queues: priority level -> array of messages
    this.queues = {
      [Priority.EMERGENCY]: [],
      [Priority.HIGH]: [],
      [Priority.NORMAL]: [],
      [Priority.LOW]: []
    };
    
    // Statistics
    this.stats = {
      enqueued: 0,
      dequeued: 0,
      dropped: 0,
      droppedByPriority: {
        [Priority.EMERGENCY]: 0,
        [Priority.HIGH]: 0,
        [Priority.NORMAL]: 0,
        [Priority.LOW]: 0
      }
    };
  }

  /**
   * Enqueue a message
   * @param {Object} message - Message to enqueue
   * @param {Number} message.priority - Priority level (0-3)
   * @param {String} message.messageId - Unique message ID
   * @param {String} message.destination - Destination callsign
   * @param {String} message.source - Source callsign
   * @param {Buffer} message.packet - Encoded packet data
   * @param {Object} message.options - Send options
   * @param {Number} message.timestamp - Enqueue timestamp
   * @param {Number} message.retries - Retry count
   * @returns {Boolean} True if enqueued, false if dropped
   */
  enqueue(message) {
    // Validate priority
    const priority = this._validatePriority(message.priority);
    message.priority = priority;
    
    // Add timestamp if not present
    if (!message.timestamp) {
      message.timestamp = Date.now();
    }
    
    // Check total queue size
    const currentSize = this.size();
    const fillRatio = currentSize / this.maxSize;
    
    // Drop low-priority messages when queue is getting full
    if (priority === Priority.LOW && fillRatio > this.lowPriorityDropThreshold) {
      console.warn(`[MessageQueue] Dropped LOW priority message (queue ${Math.round(fillRatio * 100)}% full)`);
      this.stats.dropped++;
      this.stats.droppedByPriority[priority]++;
      this.emit('dropped', message, 'Queue congestion');
      return false;
    }
    
    // Drop normal-priority messages when queue is nearly full
    if (priority === Priority.NORMAL && fillRatio > this.normalPriorityDropThreshold) {
      console.warn(`[MessageQueue] Dropped NORMAL priority message (queue ${Math.round(fillRatio * 100)}% full)`);
      this.stats.dropped++;
      this.stats.droppedByPriority[priority]++;
      this.emit('dropped', message, 'Queue congestion');
      return false;
    }
    
    // Check per-priority queue size
    const queue = this.queues[priority];
    if (queue.length >= this.maxSizePerPriority) {
      console.warn(`[MessageQueue] Dropped message: priority ${priority} queue full`);
      this.stats.dropped++;
      this.stats.droppedByPriority[priority]++;
      this.emit('dropped', message, 'Priority queue full');
      return false;
    }
    
    // Enqueue message
    queue.push(message);
    this.stats.enqueued++;
    this.emit('enqueued', message);
    
    return true;
  }

  /**
   * Dequeue highest priority message
   * @returns {Object|null} Message or null if queue empty
   */
  dequeue() {
    // Check priority queues from highest to lowest
    for (let priority = Priority.EMERGENCY; priority >= Priority.LOW; priority--) {
      const queue = this.queues[priority];
      if (queue.length > 0) {
        const message = queue.shift();
        this.stats.dequeued++;
        this.emit('dequeued', message);
        return message;
      }
    }
    
    return null;
  }

  /**
   * Peek at next message without removing it
   * @returns {Object|null} Next message or null
   */
  peek() {
    for (let priority = Priority.EMERGENCY; priority >= Priority.LOW; priority--) {
      const queue = this.queues[priority];
      if (queue.length > 0) {
        return queue[0];
      }
    }
    return null;
  }

  /**
   * Get total queue size
   * @returns {Number} Total messages in all queues
   */
  size() {
    return Object.values(this.queues).reduce((sum, queue) => sum + queue.length, 0);
  }

  /**
   * Get size of specific priority queue
   * @param {Number} priority - Priority level
   * @returns {Number} Messages in this priority queue
   */
  sizeByPriority(priority) {
    return this.queues[priority]?.length || 0;
  }

  /**
   * Check if queue is empty
   * @returns {Boolean} True if no messages queued
   */
  isEmpty() {
    return this.size() === 0;
  }

  /**
   * Check if queue is full
   * @returns {Boolean} True if at max capacity
   */
  isFull() {
    return this.size() >= this.maxSize;
  }

  /**
   * Get fill ratio (0.0 to 1.0)
   * @returns {Number} Queue fill ratio
   */
  getFillRatio() {
    return this.size() / this.maxSize;
  }

  /**
   * Remove specific message by ID
   * @param {String} messageId - Message ID to remove
   * @returns {Boolean} True if message was found and removed
   */
  remove(messageId) {
    for (const priority in this.queues) {
      const queue = this.queues[priority];
      const index = queue.findIndex(msg => msg.messageId === messageId);
      
      if (index !== -1) {
        queue.splice(index, 1);
        this.emit('removed', messageId);
        return true;
      }
    }
    return false;
  }

  /**
   * Remove all messages to specific destination
   * @param {String} destination - Destination callsign
   * @returns {Number} Number of messages removed
   */
  removeByDestination(destination) {
    let removed = 0;
    
    for (const priority in this.queues) {
      const queue = this.queues[priority];
      const originalLength = queue.length;
      this.queues[priority] = queue.filter(msg => msg.destination !== destination);
      removed += originalLength - this.queues[priority].length;
    }
    
    if (removed > 0) {
      this.emit('removed-destination', destination, removed);
    }
    
    return removed;
  }

  /**
   * Clear all queues
   */
  clear() {
    const size = this.size();
    
    for (const priority in this.queues) {
      this.queues[priority] = [];
    }
    
    console.log(`[MessageQueue] Cleared ${size} messages`);
    this.emit('cleared', size);
  }

  /**
   * Get queue statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      total: this.size(),
      byPriority: {
        emergency: this.queues[Priority.EMERGENCY].length,
        high: this.queues[Priority.HIGH].length,
        normal: this.queues[Priority.NORMAL].length,
        low: this.queues[Priority.LOW].length
      },
      capacity: this.maxSize,
      fillRatio: this.getFillRatio(),
      lifetime: {
        enqueued: this.stats.enqueued,
        dequeued: this.stats.dequeued,
        dropped: this.stats.dropped,
        droppedByPriority: this.stats.droppedByPriority
      }
    };
  }

  /**
   * Get oldest message age in queue
   * @returns {Number} Age in milliseconds, or 0 if empty
   */
  getOldestMessageAge() {
    let oldest = 0;
    const now = Date.now();
    
    for (const priority in this.queues) {
      const queue = this.queues[priority];
      if (queue.length > 0) {
        const age = now - queue[0].timestamp;
        oldest = Math.max(oldest, age);
      }
    }
    
    return oldest;
  }

  /**
   * Get messages waiting for specific destination
   * @param {String} destination - Destination callsign
   * @returns {Array} Array of messages
   */
  getByDestination(destination) {
    const messages = [];
    
    for (const priority in this.queues) {
      const queue = this.queues[priority];
      messages.push(...queue.filter(msg => msg.destination === destination));
    }
    
    return messages;
  }

  /**
   * Validate and normalize priority
   * @private
   * @param {Number} priority - Priority level
   * @returns {Number} Valid priority level
   */
  _validatePriority(priority) {
    if (priority === Priority.EMERGENCY) return Priority.EMERGENCY;
    if (priority === Priority.HIGH) return Priority.HIGH;
    if (priority === Priority.LOW) return Priority.LOW;
    return Priority.NORMAL; // Default
  }

  /**
   * Export queue contents for debugging
   * @returns {Array} All messages in queue
   */
  toArray() {
    const messages = [];
    
    for (let priority = Priority.EMERGENCY; priority >= Priority.LOW; priority--) {
      const queue = this.queues[priority];
      messages.push(...queue.map(msg => ({
        messageId: msg.messageId,
        destination: msg.destination,
        source: msg.source,
        priority: priority,
        priorityName: this._getPriorityName(priority),
        age: Date.now() - msg.timestamp,
        retries: msg.retries || 0
      })));
    }
    
    return messages;
  }

  /**
   * Get priority name string
   * @private
   * @param {Number} priority - Priority level
   * @returns {String} Priority name
   */
  _getPriorityName(priority) {
    switch (priority) {
      case Priority.EMERGENCY: return 'EMERGENCY';
      case Priority.HIGH: return 'HIGH';
      case Priority.NORMAL: return 'NORMAL';
      case Priority.LOW: return 'LOW';
      default: return 'UNKNOWN';
    }
  }
}

// Export Priority enum
MessageQueue.Priority = Priority;

module.exports = MessageQueue;
