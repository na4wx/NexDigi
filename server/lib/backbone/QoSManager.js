/**
 * QoSManager.js
 * 
 * Quality of Service (QoS) management for backbone network:
 * - Priority queues (emergency, high, normal, low)
 * - Traffic shaping and rate limiting
 * - Priority-based packet scheduling
 * - Queue management (drop policies, max sizes)
 * - Statistics and monitoring
 */

const EventEmitter = require('events');

// Priority levels
const Priority = {
  EMERGENCY: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3
};

class QoSManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.localCallsign = options.localCallsign || 'NOCALL';
    
    // Priority queues
    this.queues = {
      [Priority.EMERGENCY]: [],
      [Priority.HIGH]: [],
      [Priority.NORMAL]: [],
      [Priority.LOW]: []
    };
    
    // Queue limits
    this.queueLimits = {
      [Priority.EMERGENCY]: options.emergencyQueueSize || 100,
      [Priority.HIGH]: options.highQueueSize || 200,
      [Priority.NORMAL]: options.normalQueueSize || 500,
      [Priority.LOW]: options.lowQueueSize || 1000
    };
    
    // Traffic shaping
    this.bandwidthLimit = options.bandwidthLimit || 0; // bytes per second, 0 = unlimited
    this.tokenBucket = {
      tokens: 0,
      maxTokens: this.bandwidthLimit,
      lastRefill: Date.now()
    };
    
    // Processing state
    this.processing = false;
    this.processInterval = options.processInterval || 10; // milliseconds
    
    // Statistics
    this.stats = {
      queued: { emergency: 0, high: 0, normal: 0, low: 0 },
      processed: { emergency: 0, high: 0, normal: 0, low: 0 },
      dropped: { emergency: 0, high: 0, normal: 0, low: 0 },
      totalQueued: 0,
      totalProcessed: 0,
      totalDropped: 0,
      averageWaitTime: 0
    };
    
    // Start processing
    this.startProcessing();
  }
  
  /**
   * Enqueue a packet with priority
   */
  enqueue(packet, priority = Priority.NORMAL) {
    const queuedPacket = {
      packet,
      priority,
      queuedAt: Date.now(),
      id: `${this.localCallsign}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    
    const queue = this.queues[priority];
    const limit = this.queueLimits[priority];
    
    // Check queue limit
    if (queue.length >= limit) {
      // Drop packet
      this.stats.dropped[this.getPriorityName(priority)]++;
      this.stats.totalDropped++;
      
      this.emit('packet-dropped', {
        packet,
        priority: this.getPriorityName(priority),
        reason: 'queue-full',
        queueSize: queue.length
      });
      
      return false;
    }
    
    // Add to queue
    queue.push(queuedPacket);
    this.stats.queued[this.getPriorityName(priority)]++;
    this.stats.totalQueued++;
    
    this.emit('packet-queued', {
      id: queuedPacket.id,
      priority: this.getPriorityName(priority),
      queueSize: queue.length
    });
    
    return true;
  }
  
  /**
   * Dequeue next packet based on priority
   */
  dequeue() {
    // Check queues in priority order
    for (let priority = Priority.EMERGENCY; priority <= Priority.LOW; priority++) {
      const queue = this.queues[priority];
      
      if (queue.length > 0) {
        const queuedPacket = queue.shift();
        const waitTime = Date.now() - queuedPacket.queuedAt;
        
        // Update average wait time
        const totalProcessed = this.stats.totalProcessed || 1;
        this.stats.averageWaitTime = 
          (this.stats.averageWaitTime * totalProcessed + waitTime) / (totalProcessed + 1);
        
        this.stats.processed[this.getPriorityName(priority)]++;
        this.stats.totalProcessed++;
        
        this.emit('packet-dequeued', {
          id: queuedPacket.id,
          priority: this.getPriorityName(priority),
          waitTime,
          queueSize: queue.length
        });
        
        return queuedPacket;
      }
    }
    
    return null;
  }
  
  /**
   * Start processing queue
   */
  startProcessing() {
    if (this.processing) {
      return;
    }
    
    this.processing = true;
    this.processTimer = setInterval(() => {
      this.processQueue();
    }, this.processInterval);
  }
  
  /**
   * Stop processing queue
   */
  stopProcessing() {
    if (!this.processing) {
      return;
    }
    
    this.processing = false;
    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }
  }
  
  /**
   * Process queue (with token bucket if bandwidth limited)
   */
  processQueue() {
    // Refill token bucket
    if (this.bandwidthLimit > 0) {
      this.refillTokenBucket();
    }
    
    // Dequeue and process packets
    while (true) {
      const queuedPacket = this.dequeue();
      
      if (!queuedPacket) {
        break; // No more packets
      }
      
      const packetSize = this.getPacketSize(queuedPacket.packet);
      
      // Check token bucket
      if (this.bandwidthLimit > 0) {
        if (this.tokenBucket.tokens < packetSize) {
          // Not enough tokens, re-queue at front
          this.queues[queuedPacket.priority].unshift(queuedPacket);
          break;
        }
        
        // Consume tokens
        this.tokenBucket.tokens -= packetSize;
      }
      
      // Emit for transmission
      this.emit('packet-ready', queuedPacket);
    }
  }
  
  /**
   * Refill token bucket
   */
  refillTokenBucket() {
    const now = Date.now();
    const elapsed = now - this.tokenBucket.lastRefill;
    
    // Add tokens based on elapsed time and bandwidth limit
    const tokensToAdd = (this.bandwidthLimit * elapsed) / 1000;
    this.tokenBucket.tokens = Math.min(
      this.tokenBucket.maxTokens,
      this.tokenBucket.tokens + tokensToAdd
    );
    
    this.tokenBucket.lastRefill = now;
  }
  
  /**
   * Get packet size in bytes
   */
  getPacketSize(packet) {
    if (packet.size) {
      return packet.size;
    }
    
    // Estimate size from JSON
    return JSON.stringify(packet).length;
  }
  
  /**
   * Get priority level from name
   */
  getPriorityLevel(name) {
    const map = {
      'emergency': Priority.EMERGENCY,
      'high': Priority.HIGH,
      'normal': Priority.NORMAL,
      'low': Priority.LOW
    };
    
    return map[name.toLowerCase()] || Priority.NORMAL;
  }
  
  /**
   * Get priority name from level
   */
  getPriorityName(level) {
    const map = {
      [Priority.EMERGENCY]: 'emergency',
      [Priority.HIGH]: 'high',
      [Priority.NORMAL]: 'normal',
      [Priority.LOW]: 'low'
    };
    
    return map[level] || 'normal';
  }
  
  /**
   * Determine packet priority based on content
   */
  determinePriority(packet) {
    // Emergency: tornado warnings, severe weather, emergencies
    if (packet.type === 'emergency' || 
        packet.category === 'E' ||
        packet.priority === 'H' ||
        (packet.content && /\b(TOR|SVR|FFW|EMERGENCY|MAYDAY)\b/i.test(packet.content))) {
      return Priority.EMERGENCY;
    }
    
    // High: weather bulletins, important traffic
    if (packet.type === 'bulletin' ||
        packet.type === 'weather' ||
        packet.category === 'T' ||
        packet.priority === 'M') {
      return Priority.HIGH;
    }
    
    // Low: routine traffic, bulletins
    if (packet.category === 'B' ||
        packet.priority === 'L' ||
        packet.type === 'status') {
      return Priority.LOW;
    }
    
    // Normal: everything else
    return Priority.NORMAL;
  }
  
  /**
   * Get queue status
   */
  getQueueStatus() {
    return {
      emergency: {
        length: this.queues[Priority.EMERGENCY].length,
        limit: this.queueLimits[Priority.EMERGENCY],
        utilization: (this.queues[Priority.EMERGENCY].length / this.queueLimits[Priority.EMERGENCY]) * 100
      },
      high: {
        length: this.queues[Priority.HIGH].length,
        limit: this.queueLimits[Priority.HIGH],
        utilization: (this.queues[Priority.HIGH].length / this.queueLimits[Priority.HIGH]) * 100
      },
      normal: {
        length: this.queues[Priority.NORMAL].length,
        limit: this.queueLimits[Priority.NORMAL],
        utilization: (this.queues[Priority.NORMAL].length / this.queueLimits[Priority.NORMAL]) * 100
      },
      low: {
        length: this.queues[Priority.LOW].length,
        limit: this.queueLimits[Priority.LOW],
        utilization: (this.queues[Priority.LOW].length / this.queueLimits[Priority.LOW]) * 100
      },
      total: this.getTotalQueueLength()
    };
  }
  
  /**
   * Get total queue length
   */
  getTotalQueueLength() {
    return Object.values(this.queues).reduce((sum, queue) => sum + queue.length, 0);
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      queueStatus: this.getQueueStatus(),
      averageWaitTime: Math.round(this.stats.averageWaitTime),
      bandwidthLimit: this.bandwidthLimit,
      tokensAvailable: Math.round(this.tokenBucket.tokens)
    };
  }
  
  /**
   * Clear all queues
   */
  clearQueues() {
    for (let priority = Priority.EMERGENCY; priority <= Priority.LOW; priority++) {
      this.queues[priority] = [];
    }
    
    this.emit('queues-cleared');
  }
  
  /**
   * Set bandwidth limit
   */
  setBandwidthLimit(bytesPerSecond) {
    this.bandwidthLimit = bytesPerSecond;
    this.tokenBucket.maxTokens = bytesPerSecond;
    this.tokenBucket.tokens = Math.min(this.tokenBucket.tokens, bytesPerSecond);
    
    this.emit('bandwidth-limit-changed', { limit: bytesPerSecond });
  }
  
  /**
   * Shutdown
   */
  shutdown() {
    this.stopProcessing();
    this.clearQueues();
    this.emit('shutdown');
  }
}

module.exports = { QoSManager, Priority };
