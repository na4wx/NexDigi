/**
 * ChatSyncManager - Synchronize chat messages across NexNet mesh nodes
 * 
 * Features:
 * - Automatic chat message distribution via NexNet backbone
 * - Vector clock conflict resolution for concurrent updates
 * - Message deduplication by hash
 * - Incremental sync with timestamps
 * - Bidirectional propagation with loop prevention
 * - Selective sync (room-based filtering)
 */

const crypto = require('crypto');
const EventEmitter = require('events');

class ChatSyncManager extends EventEmitter {
  constructor(chatManager, backboneManager, options = {}) {
    super();
    
    this.chatManager = chatManager;
    this.backboneManager = backboneManager;
    
    // Configuration
    this.config = {
      enabled: options.enabled !== false,
      syncInterval: options.syncInterval || 30000, // 30 seconds
      maxMessagesPerSync: options.maxMessagesPerSync || 100,
      deduplicationTTL: options.deduplicationTTL || 3600000, // 1 hour
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 5000, // 5 seconds
      ...options
    };
    
    // Vector clock for each room (tracks logical time)
    this.vectorClocks = new Map(); // roomId -> { nodeId: counter }
    
    // Message deduplication cache (hash -> timestamp)
    this.seenMessages = new Map();
    
    // Sync state tracking
    this.lastSyncTimestamp = new Map(); // roomId -> timestamp
    this.syncInProgress = new Set(); // roomIds currently syncing
    
    // Pending messages queue (for retry logic)
    this.pendingMessages = [];
    
    // Statistics
    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      messagesDeduplicated: 0,
      syncAttempts: 0,
      syncFailures: 0,
      conflictsResolved: 0
    };
    
    // Periodic sync interval
    this.syncIntervalTimer = null;
    
    // Initialize if both managers are available
    if (this.chatManager && this.backboneManager && this.config.enabled) {
      this.initialize();
    }
  }
  
  /**
   * Initialize the chat sync manager
   */
  initialize() {
    console.log('[ChatSync] Initializing chat synchronization...');
    
    // Listen for local chat messages
    if (this.chatManager) {
      this.chatManager.on('message', (message) => {
        this.onLocalMessage(message);
      });
    }
    
    // Listen for remote messages from backbone
    if (this.backboneManager) {
      this.backboneManager.on('data', (packet) => {
        if (packet.type === 'chat-sync' || packet.type === 'chat-message') {
          this.onRemoteMessage(packet);
        }
      });
    }
    
    // Start periodic sync
    if (this.config.syncInterval > 0) {
      this.startPeriodicSync();
    }
    
    // Cleanup old seen messages periodically
    setInterval(() => this.cleanupSeenMessages(), 60000); // Every minute
    
    console.log('[ChatSync] Chat synchronization initialized');
  }
  
  /**
   * Handle local chat message (distribute to mesh)
   */
  onLocalMessage(message) {
    if (!this.config.enabled || !this.backboneManager) return;
    
    try {
      const roomId = message.roomId || 'general';
      const nodeId = this.getLocalNodeId();
      
      // Increment vector clock for this room
      this.incrementVectorClock(roomId, nodeId);
      
      // Create sync packet
      const syncPacket = {
        type: 'chat-message',
        roomId,
        message: {
          id: message.id,
          serverId: message.serverId || nodeId,
          username: message.username,
          message: message.message,
          timestamp: message.timestamp || Date.now(),
          vectorClock: this.getVectorClock(roomId)
        },
        hash: this.hashMessage(message),
        sourceNode: nodeId
      };
      
      // Mark as seen to avoid re-processing our own message
      this.seenMessages.set(syncPacket.hash, Date.now());
      
      // Broadcast to all mesh nodes
      this.broadcastMessage(syncPacket);
      
      this.stats.messagesSent++;
      
      console.log(`[ChatSync] Distributed local message to mesh: ${message.username}: ${message.message.substring(0, 50)}`);
      
    } catch (err) {
      console.error('[ChatSync] Error handling local message:', err);
    }
  }
  
  /**
   * Handle remote message from mesh
   */
  onRemoteMessage(packet) {
    if (!this.config.enabled || !this.chatManager) return;
    
    try {
      const { type, roomId, message, hash, sourceNode, vectorClock } = packet.data || packet;
      
      // Ignore our own messages
      if (sourceNode === this.getLocalNodeId()) {
        return;
      }
      
      // Deduplication check
      if (this.seenMessages.has(hash)) {
        this.stats.messagesDeduplicated++;
        console.log(`[ChatSync] Deduplicated message from ${sourceNode}`);
        return;
      }
      
      // Mark as seen
      this.seenMessages.set(hash, Date.now());
      
      // Conflict resolution using vector clocks
      if (vectorClock && !this.shouldAcceptMessage(roomId, vectorClock)) {
        console.log(`[ChatSync] Message rejected due to vector clock conflict`);
        this.stats.conflictsResolved++;
        return;
      }
      
      // Update our vector clock
      this.mergeVectorClock(roomId, vectorClock);
      
      // Add message to local chat
      if (this.chatManager.addMessage) {
        this.chatManager.addMessage(roomId, {
          id: message.id,
          serverId: message.serverId || sourceNode,
          username: message.username,
          message: message.message,
          timestamp: message.timestamp,
          synced: true // Mark as synced from mesh
        });
      }
      
      this.stats.messagesReceived++;
      
      console.log(`[ChatSync] Received synced message from ${sourceNode}: ${message.username}: ${message.message.substring(0, 50)}`);
      
      // Emit event for UI updates
      this.emit('message-synced', {
        roomId,
        message,
        sourceNode
      });
      
    } catch (err) {
      console.error('[ChatSync] Error handling remote message:', err);
    }
  }
  
  /**
   * Broadcast message to all mesh nodes
   */
  broadcastMessage(packet) {
    if (!this.backboneManager || !this.backboneManager.enabled) {
      return;
    }
    
    try {
      // Send via backbone with high priority for real-time chat
      this.backboneManager.broadcast({
        type: 'chat-message',
        data: packet,
        priority: 'high',
        ttl: 5 // Max 5 hops
      });
      
    } catch (err) {
      console.error('[ChatSync] Error broadcasting message:', err);
      
      // Queue for retry
      this.pendingMessages.push({
        packet,
        attempts: 0,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Start periodic sync for message history
   */
  startPeriodicSync() {
    if (this.syncIntervalTimer) {
      clearInterval(this.syncIntervalTimer);
    }
    
    this.syncIntervalTimer = setInterval(() => {
      this.performPeriodicSync();
    }, this.config.syncInterval);
    
    console.log(`[ChatSync] Started periodic sync every ${this.config.syncInterval}ms`);
  }
  
  /**
   * Perform periodic sync of message history
   */
  async performPeriodicSync() {
    if (!this.config.enabled || !this.chatManager || !this.backboneManager) {
      return;
    }
    
    try {
      const rooms = this.chatManager.getRooms ? this.chatManager.getRooms() : ['general'];
      
      for (const roomId of rooms) {
        // Skip if already syncing this room
        if (this.syncInProgress.has(roomId)) {
          continue;
        }
        
        this.syncInProgress.add(roomId);
        this.stats.syncAttempts++;
        
        try {
          await this.syncRoom(roomId);
        } catch (err) {
          console.error(`[ChatSync] Error syncing room ${roomId}:`, err);
          this.stats.syncFailures++;
        } finally {
          this.syncInProgress.delete(roomId);
        }
      }
      
      // Retry pending messages
      this.retryPendingMessages();
      
    } catch (err) {
      console.error('[ChatSync] Error in periodic sync:', err);
    }
  }
  
  /**
   * Sync a specific room's message history
   */
  async syncRoom(roomId) {
    const lastSync = this.lastSyncTimestamp.get(roomId) || 0;
    const messages = this.chatManager.getMessages ? 
      this.chatManager.getMessages(roomId, { since: lastSync, limit: this.config.maxMessagesPerSync }) : 
      [];
    
    if (messages.length === 0) {
      return;
    }
    
    console.log(`[ChatSync] Syncing ${messages.length} messages for room ${roomId}`);
    
    const syncPacket = {
      type: 'chat-sync',
      roomId,
      messages: messages.map(msg => ({
        ...msg,
        vectorClock: this.getVectorClock(roomId)
      })),
      sourceNode: this.getLocalNodeId(),
      timestamp: Date.now()
    };
    
    // Broadcast sync packet
    this.backboneManager.broadcast({
      type: 'chat-sync',
      data: syncPacket,
      priority: 'normal',
      ttl: 7
    });
    
    // Update last sync timestamp
    this.lastSyncTimestamp.set(roomId, Date.now());
  }
  
  /**
   * Retry failed message sends
   */
  retryPendingMessages() {
    const now = Date.now();
    const toRetry = [];
    const toRemove = [];
    
    this.pendingMessages.forEach((pending, index) => {
      if (pending.attempts >= this.config.maxRetries) {
        console.warn(`[ChatSync] Max retries reached for message, dropping`);
        toRemove.push(index);
        return;
      }
      
      if (now - pending.timestamp > this.config.retryDelay) {
        toRetry.push(pending);
        toRemove.push(index);
      }
    });
    
    // Remove from pending queue
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.pendingMessages.splice(toRemove[i], 1);
    }
    
    // Retry
    toRetry.forEach(pending => {
      pending.attempts++;
      pending.timestamp = now;
      this.broadcastMessage(pending.packet);
      
      // Re-add to queue if failed again
      if (pending.attempts < this.config.maxRetries) {
        this.pendingMessages.push(pending);
      }
    });
  }
  
  /**
   * Vector clock operations
   */
  getVectorClock(roomId) {
    if (!this.vectorClocks.has(roomId)) {
      this.vectorClocks.set(roomId, {});
    }
    return { ...this.vectorClocks.get(roomId) };
  }
  
  incrementVectorClock(roomId, nodeId) {
    const clock = this.getVectorClock(roomId);
    clock[nodeId] = (clock[nodeId] || 0) + 1;
    this.vectorClocks.set(roomId, clock);
  }
  
  mergeVectorClock(roomId, remoteClock) {
    if (!remoteClock) return;
    
    const localClock = this.getVectorClock(roomId);
    
    Object.keys(remoteClock).forEach(nodeId => {
      const remoteValue = remoteClock[nodeId] || 0;
      const localValue = localClock[nodeId] || 0;
      localClock[nodeId] = Math.max(remoteValue, localValue);
    });
    
    this.vectorClocks.set(roomId, localClock);
  }
  
  shouldAcceptMessage(roomId, remoteClock) {
    if (!remoteClock) return true; // Accept if no clock provided
    
    const localClock = this.getVectorClock(roomId);
    
    // Check if remote clock is strictly greater than or concurrent with local
    // Accept if concurrent or newer
    let hasGreater = false;
    let hasLess = false;
    
    const allNodes = new Set([
      ...Object.keys(localClock),
      ...Object.keys(remoteClock)
    ]);
    
    allNodes.forEach(nodeId => {
      const local = localClock[nodeId] || 0;
      const remote = remoteClock[nodeId] || 0;
      
      if (remote > local) hasGreater = true;
      if (remote < local) hasLess = true;
    });
    
    // Accept if concurrent (both greater and less) or if remote is newer (only greater)
    return hasGreater || (!hasGreater && !hasLess);
  }
  
  /**
   * Message hashing for deduplication
   */
  hashMessage(message) {
    const data = JSON.stringify({
      id: message.id,
      serverId: message.serverId,
      username: message.username,
      message: message.message,
      timestamp: message.timestamp
    });
    
    return crypto.createHash('sha256').update(data).digest('hex');
  }
  
  /**
   * Cleanup old seen messages
   */
  cleanupSeenMessages() {
    const now = Date.now();
    const ttl = this.config.deduplicationTTL;
    
    let cleaned = 0;
    this.seenMessages.forEach((timestamp, hash) => {
      if (now - timestamp > ttl) {
        this.seenMessages.delete(hash);
        cleaned++;
      }
    });
    
    if (cleaned > 0) {
      console.log(`[ChatSync] Cleaned up ${cleaned} old seen messages`);
    }
  }
  
  /**
   * Get local node ID
   */
  getLocalNodeId() {
    if (this.backboneManager && this.backboneManager.nodeId) {
      return this.backboneManager.nodeId;
    }
    
    // Fallback to callsign or hostname
    return process.env.CALLSIGN || require('os').hostname();
  }
  
  /**
   * Get sync statistics
   */
  getStats() {
    return {
      ...this.stats,
      seenMessagesCount: this.seenMessages.size,
      pendingMessagesCount: this.pendingMessages.length,
      vectorClocksCount: this.vectorClocks.size,
      roomsSyncing: this.syncInProgress.size
    };
  }
  
  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    
    // Restart periodic sync if interval changed
    if (newConfig.syncInterval !== undefined && this.config.enabled) {
      this.startPeriodicSync();
    }
    
    console.log('[ChatSync] Configuration updated:', this.config);
  }
  
  /**
   * Enable/disable synchronization
   */
  setEnabled(enabled) {
    this.config.enabled = enabled;
    
    if (enabled) {
      if (!this.syncIntervalTimer) {
        this.startPeriodicSync();
      }
      console.log('[ChatSync] Chat synchronization enabled');
    } else {
      if (this.syncIntervalTimer) {
        clearInterval(this.syncIntervalTimer);
        this.syncIntervalTimer = null;
      }
      console.log('[ChatSync] Chat synchronization disabled');
    }
  }
  
  /**
   * Shutdown
   */
  shutdown() {
    if (this.syncIntervalTimer) {
      clearInterval(this.syncIntervalTimer);
      this.syncIntervalTimer = null;
    }
    
    this.removeAllListeners();
    
    console.log('[ChatSync] Chat synchronization shut down');
  }
}

module.exports = ChatSyncManager;
