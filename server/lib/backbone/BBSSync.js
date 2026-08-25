/**
 * BBSSync.js
 * Synchronize BBS messages, bulletins, and user data across backbone nodes
 * 
 * Design Philosophy:
 * - Eventual consistency: All nodes converge to same message set
 * - Bandwidth-aware: Efficient sync over RF (incremental) and Internet (full)
 * - Conflict resolution: Vector clocks or last-write-wins with metadata
 * - Selective sync: Sync specific areas, not everything
 * - Deduplication: Global unique IDs prevent duplicates
 * 
 * Sync Strategy:
 * 1. Periodic sync: Every 30 minutes (configurable)
 * 2. Triggered sync: On new message creation
 * 3. Incremental sync: Only messages since last sync
 * 4. Full sync: On startup or long disconnection
 * 
 * Message Format:
 * - Global ID: nodeCallsign:timestamp:sequence (e.g., "NA4WX-10:1697472000000:42")
 * - Version vector: { NODE-1: 5, NODE-2: 3 } (for conflict detection)
 * - Tombstones: Deleted messages tracked for sync
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const BloomFilter = require('./BloomFilter');

// Sync message types
const SyncMessageType = {
  SYNC_REQUEST: 'sync_request',       // Request messages since timestamp
  SYNC_RESPONSE: 'sync_response',     // Response with message list
  MESSAGE_FETCH: 'message_fetch',     // Request specific messages
  MESSAGE_DATA: 'message_data',       // Full message content
  VERSION_VECTOR: 'version_vector',   // Version vector exchange
  TOMBSTONE: 'tombstone',             // Deleted message notification
  BLOOM_FILTER: 'bloom_filter'        // Bloom filter for efficient sync
};

// Sync status
const SyncStatus = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  COMPLETE: 'complete',
  ERROR: 'error'
};

class BBSSync extends EventEmitter {
  /**
   * Create BBS synchronization manager
   * @param {Object} config - Configuration
   * @param {Object} config.bbs - BBS instance to sync
   * @param {Object} config.backboneManager - BackboneManager instance
   * @param {String} config.localCallsign - Local node callsign
   * @param {Array} config.syncAreas - Areas to sync (default: all)
   * @param {Number} config.syncInterval - Sync interval (ms, default 1800000 = 30 min)
   * @param {Number} config.incrementalThreshold - Full vs incremental sync threshold (default 3600000 = 1 hour)
   * @param {String} config.conflictResolution - Conflict strategy: 'last-write-wins' or 'vector-clock' (default: 'last-write-wins')
   */
  constructor(bbs, backboneManager, localCallsign, syncAreas, syncInterval, incrementalThreshold, conflictResolution) {
    super();
    
    // Support both object config and positional parameters
    if (typeof bbs === 'object' && bbs.bbs !== undefined) {
      // Config object format
      const config = bbs;
      this.bbs = config.bbs;
      this.backboneManager = config.backboneManager;
      this.localCallsign = config.localCallsign;
      this.syncAreas = config.syncAreas || null;
      this.syncInterval = config.syncInterval || 1800000;
      this.incrementalThreshold = config.incrementalThreshold || 3600000;
      this.conflictResolution = config.conflictResolution || 'last-write-wins';
    } else {
      // Positional parameters format
      this.bbs = bbs;
      this.backboneManager = backboneManager;
      this.localCallsign = localCallsign;
      this.syncAreas = syncAreas || null;
      this.syncInterval = syncInterval || 1800000;
      this.incrementalThreshold = incrementalThreshold || 3600000;
      this.conflictResolution = conflictResolution || 'last-write-wins';
    }
    
    // Sync state tracking
    this.lastSyncTime = new Map(); // nodeCallsign -> timestamp
    this.syncStatus = new Map(); // nodeCallsign -> status
    this.versionVectors = new Map(); // nodeCallsign -> { NODE-1: version, NODE-2: version, ... }
    this.localVersionVector = new Map(); // area -> version number
    this.tombstones = new Map(); // messageId -> deletionTimestamp
    
    // Message ID tracking
    this.messageSequence = 0;
    this.knownMessageIds = new Set(); // For deduplication
    
    // Bloom filters for efficient sync
    this.messageBloomFilter = new BloomFilter(10000, 0.01); // Local messages
    this.areaBloomFilters = new Map(); // area -> BloomFilter
    
    // Bandwidth optimization (set BEFORE initializing areas)
    this.bandwidthMode = 'auto'; // 'auto', 'high', 'low'
    this.useBloomFilters = true; // Enable Bloom filter optimization
    this.maxSyncBatchSize = 100; // Max messages per sync batch
    
    // Area-specific sync schedules
    this.areaSyncSchedules = new Map(); // area -> { interval, lastSync, priority }
    this._initializeAreaSchedules();
    
    // Statistics
    this.stats = {
      syncsPerformed: 0,
      messagesSynced: 0,
      messagesReceived: 0,
      conflictsResolved: 0,
      duplicatesSkipped: 0,
      tombstonesProcessed: 0,
      errors: 0,
      bloomFilterQueries: 0,
      bloomFilterHits: 0,
      bandwidthSaved: 0
    };
    
    // Timers
    this.syncTimer = null;
    this.started = false;
  }
  
  /**
   * Start BBS sync
   */
  async start() {
    if (this.started) return;
    
    console.log('[BBSSync] Starting BBS synchronization...');
    
    // Load known message IDs from BBS
    await this._loadKnownMessageIds();
    
    // Initialize local version vector
    await this._initializeVersionVector();
    
    // Listen for backbone events
    this._setupBackboneListeners();
    
    // Start periodic sync
    this.syncTimer = setInterval(() => {
      this._performPeriodicSync();
    }, this.syncInterval);
    
    // Perform initial sync
    setImmediate(() => this._performPeriodicSync());
    
    this.started = true;
    console.log(`[BBSSync] Started (sync interval: ${this.syncInterval}ms, areas: ${this.syncAreas ? this.syncAreas.join(',') : 'all'})`);
  }
  
  /**
   * Stop BBS sync
   */
  async stop() {
    if (!this.started) return;
    
    console.log('[BBSSync] Stopping...');
    
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    this.started = false;
    console.log('[BBSSync] Stopped');
  }
  
  /**
   * Generate a global message ID
   * @returns {String} Global message ID
   */
  generateMessageId() {
    const timestamp = Date.now();
    const sequence = this.messageSequence++;
    return `${this.localCallsign}:${timestamp}:${sequence}`;
  }
  
  /**
   * Convert a local BBS message object into the wire format sent to peers.
   * @private
   */
  _toWireMessage(msg) {
    return {
      id: msg.globalId,
      globalId: msg.globalId,
      area: msg.category,
      from: msg.sender,
      to: msg.recipient,
      subject: msg.subject,
      content: msg.content,
      category: msg.category,
      priority: msg.priority,
      tags: msg.tags,
      replyTo: msg.replyTo,
      expiresAt: msg.expiresAt,
      timestamp: Date.parse(msg.timestamp)
    };
  }

  /**
   * Check if message ID is known (for deduplication)
   * @param {String} messageId - Global message ID
   * @returns {Boolean} True if known
   */
  isKnownMessage(messageId) {
    return this.knownMessageIds.has(messageId);
  }
  
  /**
   * Mark message as known
   * @param {String} messageId - Global message ID
   */
  markMessageKnown(messageId) {
    this.knownMessageIds.add(messageId);
  }
  
  /**
   * Request sync from a specific node
   * @param {String} nodeCallsign - Node to sync with
   * @param {Number} sinceTimestamp - Only messages since this time (optional)
   */
  async requestSync(nodeCallsign, sinceTimestamp = null) {
    console.log(`[BBSSync] Requesting sync from ${nodeCallsign}${sinceTimestamp ? ` since ${new Date(sinceTimestamp).toISOString()}` : ' (full sync)'}`);
    
    this.syncStatus.set(nodeCallsign, SyncStatus.SYNCING);
    
    const request = {
      type: SyncMessageType.SYNC_REQUEST,
      fromNode: this.localCallsign,
      toNode: nodeCallsign,
      sinceTimestamp,
      areas: this.syncAreas,
      versionVector: Object.fromEntries(this.localVersionVector)
    };
    
    try {
      // Send via backbone
      await this.backboneManager.sendData(
        nodeCallsign,
        Buffer.from(JSON.stringify(request)),
        { priority: 'normal' }
      );
      
      this.emit('sync-request-sent', nodeCallsign, sinceTimestamp);
      
    } catch (error) {
      console.error(`[BBSSync] Error requesting sync from ${nodeCallsign}:`, error.message);
      this.syncStatus.set(nodeCallsign, SyncStatus.ERROR);
      this.stats.errors++;
      this.emit('sync-error', nodeCallsign, error);
    }
  }
  
  /**
   * Handle incoming sync message
   * @param {Object} message - Parsed sync message
   * @param {String} fromNode - Source node callsign
   */
  async handleSyncMessage(message, fromNode) {
    try {
      switch (message.type) {
        case SyncMessageType.SYNC_REQUEST:
          await this._handleSyncRequest(message, fromNode);
          break;
          
        case SyncMessageType.SYNC_RESPONSE:
          await this._handleSyncResponse(message, fromNode);
          break;
          
        case SyncMessageType.MESSAGE_FETCH:
          await this._handleMessageFetch(message, fromNode);
          break;
          
        case SyncMessageType.MESSAGE_DATA:
          await this._handleMessageData(message, fromNode);
          break;
          
        case SyncMessageType.VERSION_VECTOR:
          await this._handleVersionVector(message, fromNode);
          break;
          
        case SyncMessageType.TOMBSTONE:
          await this._handleTombstone(message, fromNode);
          break;
          
        case SyncMessageType.BLOOM_FILTER:
          await this._handleBloomFilter(message, fromNode);
          break;
          
        default:
          console.warn(`[BBSSync] Unknown sync message type: ${message.type}`);
      }
      
    } catch (error) {
      console.error(`[BBSSync] Error handling sync message from ${fromNode}:`, error.message);
      this.stats.errors++;
      this.emit('sync-error', fromNode, error);
    }
  }
  
  /**
   * Notify of new local message (trigger sync)
   * @param {Object} message - BBS message
   */
  async notifyNewMessage(message) {
    // Increment local version vector for this area (BBS.js category code)
    const area = message.category || message.area || 'P';
    const currentVersion = this.localVersionVector.get(area) || 0;
    this.localVersionVector.set(area, currentVersion + 1);
    
    console.log(`[BBSSync] New message in ${area}, version now ${currentVersion + 1}`);
    
    // Mark as known
    const messageId = message.globalId || message.id;
    if (messageId) {
      this.markMessageKnown(messageId);
      // Add to Bloom filter
      this.addToBloomFilter(messageId, area);
    }
    
    // Update area sync time
    this._updateAreaSyncTime(area);
    
    // Trigger sync to all connected nodes
    this.emit('new-message', message);
    
    // TODO: Optionally trigger immediate sync instead of waiting for periodic
  }
  
  /**
   * Notify of message deletion (create tombstone)
   * @param {String} messageId - Global message ID
   */
  async notifyMessageDeleted(messageId) {
    const timestamp = Date.now();
    this.tombstones.set(messageId, timestamp);
    this.knownMessageIds.delete(messageId);

    console.log(`[BBSSync] Message ${messageId} deleted, tombstone created`);

    // Broadcast tombstone to all known neighbors
    const tombstone = {
      type: SyncMessageType.TOMBSTONE,
      fromNode: this.localCallsign,
      messageId,
      deletedAt: timestamp
    };

    const neighborMap = this.backboneManager?.neighborTable?.getAll();
    const neighbors = neighborMap ? Array.from(neighborMap.values()) : [];
    const payload = Buffer.from(JSON.stringify(tombstone));
    for (const neighbor of neighbors) {
      try {
        await this.backboneManager.sendData(neighbor.callsign, payload, { priority: 'normal' });
      } catch (error) {
        console.error(`[BBSSync] Error broadcasting tombstone to ${neighbor.callsign}:`, error.message);
      }
    }

    this.emit('tombstone-created', messageId);
  }
  
  /**
   * Get sync statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      knownMessages: this.knownMessageIds.size,
      tombstones: this.tombstones.size,
      syncedNodes: this.lastSyncTime.size,
      localVersion: Object.fromEntries(this.localVersionVector)
    };
  }
  
  // Private methods
  
  /**
   * Load known message IDs from BBS
   * @private
   */
  async _loadKnownMessageIds() {
    this.knownMessageIds.clear();
    const messages = (this.bbs && typeof this.bbs.getMessages === 'function') ? this.bbs.getMessages({}) : [];
    for (const msg of messages) {
      if (!msg.globalId) continue;
      this.knownMessageIds.add(msg.globalId);
      this.addToBloomFilter(msg.globalId, msg.category);
    }
    console.log(`[BBSSync] Loaded ${this.knownMessageIds.size} known message IDs`);
  }
  
  /**
   * Initialize local version vector
   * @private
   */
  async _initializeVersionVector() {
    // BBS.js does not persist a per-area version counter, so approximate it
    // from the current message count per category (area). This is enough to
    // let peers detect "nothing changed" vs "something changed" per area.
    this.localVersionVector.clear();
    const messages = (this.bbs && typeof this.bbs.getMessages === 'function') ? this.bbs.getMessages({}) : [];
    for (const msg of messages) {
      const area = msg.category || 'P';
      this.localVersionVector.set(area, (this.localVersionVector.get(area) || 0) + 1);
    }
    console.log('[BBSSync] Initialized version vector', Object.fromEntries(this.localVersionVector));
  }
  
  /**
   * Initialize area-specific sync schedules
   * @private
   */
  _initializeAreaSchedules() {
    // Default area priorities and sync intervals.
    // Area names match BBS.js message `category` codes (P/B/T/E/A) so sync
    // requests can filter bbs.getMessages({ category: area }) directly.
    const defaultAreas = [
      { name: 'E', priority: 0, interval: 300000 },    // Emergency - 5 min (highest priority)
      { name: 'B', priority: 1, interval: 900000 },     // Bulletin - 15 min
      { name: 'T', priority: 2, interval: 1800000 },    // Traffic - 30 min
      { name: 'A', priority: 3, interval: 3600000 },    // Administrative - 60 min
      { name: 'P', priority: 4, interval: 7200000 }     // Personal - 120 min (lowest priority)
    ];
    
    for (const area of defaultAreas) {
      this.areaSyncSchedules.set(area.name, {
        interval: area.interval,
        priority: area.priority,
        lastSync: 0,
        enabled: this.syncAreas === null || this.syncAreas.includes(area.name)
      });
      
      // Initialize Bloom filter for each area
      if (this.useBloomFilters) {
        this.areaBloomFilters.set(area.name, new BloomFilter(1000, 0.01));
      }
    }
  }
  
  /**
   * Check if area should be synced based on schedule
   * @private
   * @param {string} area - Area name
   * @returns {boolean} True if sync is due
   */
  _shouldSyncArea(area) {
    const schedule = this.areaSyncSchedules.get(area);
    if (!schedule || !schedule.enabled) return false;
    
    const timeSinceSync = Date.now() - schedule.lastSync;
    return timeSinceSync >= schedule.interval;
  }
  
  /**
   * Get areas that need syncing, sorted by priority
   * @private
   * @returns {string[]} Areas to sync
   */
  _getAreasToSync() {
    const areas = [];
    
    for (const [name, schedule] of this.areaSyncSchedules) {
      if (this._shouldSyncArea(name)) {
        areas.push({ name, priority: schedule.priority });
      }
    }
    
    // Sort by priority (0 = highest)
    areas.sort((a, b) => a.priority - b.priority);
    
    return areas.map(a => a.name);
  }
  
  /**
   * Update area sync timestamp
   * @private
   * @param {string} area - Area name
   */
  _updateAreaSyncTime(area) {
    const schedule = this.areaSyncSchedules.get(area);
    if (schedule) {
      schedule.lastSync = Date.now();
    }
  }
  
  /**
   * Add message ID to Bloom filter
   * @param {string} messageId - Message ID
   * @param {string} area - Message area
   */
  addToBloomFilter(messageId, area = null) {
    if (!this.useBloomFilters) return;
    
    // Add to global filter
    this.messageBloomFilter.add(messageId);
    
    // Add to area-specific filter
    if (area && this.areaBloomFilters.has(area)) {
      this.areaBloomFilters.get(area).add(messageId);
    }
  }
  
  /**
   * Check if message might exist using Bloom filter
   * @param {string} messageId - Message ID
   * @param {string} area - Message area
   * @returns {boolean} True if possibly exists
   */
  checkBloomFilter(messageId, area = null) {
    if (!this.useBloomFilters) return false;
    
    this.stats.bloomFilterQueries++;
    
    // Check area-specific filter first (more efficient)
    if (area && this.areaBloomFilters.has(area)) {
      const result = this.areaBloomFilters.get(area).has(messageId);
      if (result) this.stats.bloomFilterHits++;
      return result;
    }
    
    // Fall back to global filter
    const result = this.messageBloomFilter.has(messageId);
    if (result) this.stats.bloomFilterHits++;
    return result;
  }
  
  /**
   * Get Bloom filter for area (for transmission)
   * @param {string} area - Area name
   * @returns {Object} Serialized Bloom filter
   */
  getAreaBloomFilter(area) {
    if (!this.useBloomFilters) return null;
    
    const filter = this.areaBloomFilters.get(area);
    return filter ? filter.serialize() : null;
  }
  
  /**
   * Set bandwidth mode
   * @param {string} mode - 'high', 'low', or 'auto'
   */
  setBandwidthMode(mode) {
    const validModes = ['high', 'low', 'auto'];
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid bandwidth mode: ${mode}`);
    }
    
    this.bandwidthMode = mode;
    console.log(`[BBSSync] Bandwidth mode set to: ${mode}`);
    
    // Adjust settings based on mode
    if (mode === 'low') {
      this.useBloomFilters = true;
      this.maxSyncBatchSize = 50;
    } else if (mode === 'high') {
      this.useBloomFilters = false; // Less overhead
      this.maxSyncBatchSize = 500;
    } else {
      // Auto mode - will be adjusted based on transport type
      this.useBloomFilters = true;
      this.maxSyncBatchSize = 100;
    }
  }
  
  /**
   * Setup backbone event listeners
   * @private
   */
  _setupBackboneListeners() {
    // Listen for BBS sync messages on backbone
    this.backboneManager.on('data', (packet) => {
      try {
        const data = packet.data.toString('utf8');
        const message = JSON.parse(data);
        
        // Check if it's a BBS sync message
        if (message.type && Object.values(SyncMessageType).includes(message.type)) {
          this.handleSyncMessage(message, packet.source);
        }
      } catch (error) {
        // Not a BBS sync message, ignore
      }
    });
    
    console.log('[BBSSync] Backbone listeners setup');
  }
  
  /**
   * Perform periodic sync with all nodes
   * @private
   */
  async _performPeriodicSync() {
    // Get all backbone neighbors
    const neighborMap = this.backboneManager.neighborTable?.getAll();
    const neighbors = neighborMap ? Array.from(neighborMap.values()) : [];

    if (neighbors.length === 0) {
      console.log('[BBSSync] No neighbors, skipping sync');
      return;
    }
    
    // Get areas that need syncing based on schedules
    const areasToSync = this._getAreasToSync();
    
    if (areasToSync.length === 0) {
      console.log('[BBSSync] No areas due for sync');
      return;
    }
    
    console.log(`[BBSSync] Performing periodic sync with ${neighbors.length} neighbors (areas: ${areasToSync.join(', ')})`);
    
    for (const neighbor of neighbors) {
      const callsign = neighbor.callsign;
      const lastSync = this.lastSyncTime.get(callsign) || 0;
      const timeSinceSync = Date.now() - lastSync;

      // Determine if full or incremental sync
      const sinceTimestamp = timeSinceSync > this.incrementalThreshold ? null : lastSync;

      // Sync every due area, not just the highest-priority one - areasToSync
      // is already priority-sorted (see _getAreasToSync), so this still
      // processes them in priority order, it just doesn't silently mark
      // lower-priority due areas as synced without ever syncing them.
      if (this.useBloomFilters && areasToSync.length > 0) {
        for (const area of areasToSync) {
          await this._sendBloomFilterSync(callsign, area);
          this._updateAreaSyncTime(area);
          // Rate limiting: small delay between areas
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } else {
        await this.requestSync(callsign, sinceTimestamp);
        for (const area of areasToSync) {
          this._updateAreaSyncTime(area);
        }
      }

      // Rate limiting: small delay between nodes
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  /**
   * Send Bloom filter for efficient sync
   * @private
   * @param {string} nodeCallsign - Target node
   * @param {string} area - Area to sync
   */
  async _sendBloomFilterSync(nodeCallsign, area) {
    const bloomFilter = this.getAreaBloomFilter(area);
    
    if (!bloomFilter) {
      // Fall back to regular sync
      await this.requestSync(nodeCallsign);
      return;
    }
    
    const message = {
      type: SyncMessageType.BLOOM_FILTER,
      fromNode: this.localCallsign,
      toNode: nodeCallsign,
      area: area,
      bloomFilter: bloomFilter,
      timestamp: Date.now()
    };
    
    const payload = Buffer.from(JSON.stringify(message));
    this.backboneManager.sendData(nodeCallsign, payload);
    
    console.log(`[BBSSync] Sent Bloom filter for ${area} to ${nodeCallsign}`);
  }
  
  /**
   * Handle sync request from another node
   * @private
   */
  async _handleSyncRequest(message, fromNode) {
    console.log(`[BBSSync] Handling sync request from ${fromNode}`);

    const { sinceTimestamp, areas } = message;
    const allMessages = (this.bbs && typeof this.bbs.getMessages === 'function') ? this.bbs.getMessages({}) : [];

    const messageList = allMessages
      .filter(msg => {
        if (Array.isArray(areas) && areas.length > 0 && !areas.includes(msg.category)) return false;
        if (sinceTimestamp && Date.parse(msg.timestamp) <= sinceTimestamp) return false;
        return true;
      })
      .map(msg => ({
        id: msg.globalId,
        area: msg.category,
        subject: msg.subject,
        from: msg.sender,
        timestamp: Date.parse(msg.timestamp)
      }));

    const response = {
      type: SyncMessageType.SYNC_RESPONSE,
      fromNode: this.localCallsign,
      toNode: fromNode,
      messages: messageList,
      versionVector: Object.fromEntries(this.localVersionVector)
    };
    
    await this.backboneManager.sendData(
      fromNode,
      Buffer.from(JSON.stringify(response)),
      { priority: 'normal' }
    );
    
    this.emit('sync-response-sent', fromNode, messageList.length);
  }
  
  /**
   * Handle sync response with message list
   * @private
   */
  async _handleSyncResponse(message, fromNode) {
    console.log(`[BBSSync] Received sync response from ${fromNode}: ${message.messages.length} messages`);
    
    // Update version vector
    if (message.versionVector) {
      this.versionVectors.set(fromNode, message.versionVector);
    }
    
    // Request full content for messages we don't have
    const missingMessages = message.messages.filter(msg => !this.isKnownMessage(msg.id));
    
    if (missingMessages.length > 0) {
      console.log(`[BBSSync] Fetching ${missingMessages.length} missing messages`);
      
      const fetchRequest = {
        type: SyncMessageType.MESSAGE_FETCH,
        fromNode: this.localCallsign,
        toNode: fromNode,
        messageIds: missingMessages.map(msg => msg.id)
      };
      
      await this.backboneManager.sendData(
        fromNode,
        Buffer.from(JSON.stringify(fetchRequest)),
        { priority: 'normal' }
      );
    } else {
      this.syncStatus.set(fromNode, SyncStatus.COMPLETE);
      this.lastSyncTime.set(fromNode, Date.now());
    }
    
    this.stats.syncsPerformed++;
    this.emit('sync-response-received', fromNode, message.messages.length);
  }
  
  /**
   * Handle message fetch request
   * @private
   */
  async _handleMessageFetch(message, fromNode) {
    console.log(`[BBSSync] Fetching ${message.messageIds.length} messages for ${fromNode}`);

    const messages = [];
    for (const messageId of message.messageIds) {
      const full = (this.bbs && typeof this.bbs.getMessageByGlobalId === 'function')
        ? this.bbs.getMessageByGlobalId(messageId)
        : null;
      if (full) messages.push(this._toWireMessage(full));
    }

    const response = {
      type: SyncMessageType.MESSAGE_DATA,
      fromNode: this.localCallsign,
      toNode: fromNode,
      messages
    };
    
    await this.backboneManager.sendData(
      fromNode,
      Buffer.from(JSON.stringify(response)),
      { priority: 'normal' }
    );
    
    this.emit('messages-sent', fromNode, messages.length);
  }
  
  /**
   * Handle incoming message data
   * @private
   */
  async _handleMessageData(message, fromNode) {
    console.log(`[BBSSync] Received ${message.messages.length} messages from ${fromNode}`);

    for (const msg of message.messages) {
      const globalId = msg.globalId || msg.id;
      if (!globalId || !msg.content) {
        // Bloom-filter reconciliation can send bare {id} stubs with no content;
        // nothing to store until the full message is fetched separately.
        continue;
      }

      // Check for duplicates
      if (this.isKnownMessage(globalId)) {
        this.stats.duplicatesSkipped++;
        continue;
      }

      const remoteTimestamp = typeof msg.timestamp === 'number' ? msg.timestamp : Date.parse(msg.timestamp);
      const existingMessage = this.bbs.getMessageByGlobalId ? this.bbs.getMessageByGlobalId(globalId) : null;

      const addOptions = (m) => ({
        subject: m.subject || '',
        category: m.category || 'P',
        priority: m.priority || 'N',
        tags: m.tags || [],
        replyTo: m.replyTo || null,
        expires: m.expiresAt || null,
        globalId
      });

      if (existingMessage) {
        const existingTimestamp = Date.parse(existingMessage.timestamp);
        const conflict = this._detectConflict(existingMessage, null, { ...msg, timestamp: remoteTimestamp });

        if (conflict) {
          console.log(`[BBSSync] Conflict detected for message ${globalId}`);
          const resolved = this._resolveConflict(existingMessage, msg, conflict);
          if (this.bbs.deleteMessageByGlobalId) this.bbs.deleteMessageByGlobalId(globalId);
          this.bbs.addMessage(
            String(resolved.from || resolved.sender || 'UNKNOWN'),
            String(resolved.to || resolved.recipient || 'ALL'),
            String(resolved.content || resolved.body || ''),
            addOptions(resolved)
          );
        } else if (remoteTimestamp > existingTimestamp) {
          // No conflict, remote is newer - replace local copy
          if (this.bbs.deleteMessageByGlobalId) this.bbs.deleteMessageByGlobalId(globalId);
          this.bbs.addMessage(
            String(msg.from || msg.sender || 'UNKNOWN'),
            String(msg.to || msg.recipient || 'ALL'),
            String(msg.content || ''),
            addOptions(msg)
          );
        }
      } else {
        // New message, add it under its originating globalId
        this.bbs.addMessage(
          String(msg.from || msg.sender || 'UNKNOWN'),
          String(msg.to || msg.recipient || 'ALL'),
          String(msg.content || ''),
          addOptions(msg)
        );
      }

      // Mark as known
      this.markMessageKnown(globalId);
      this.addToBloomFilter(globalId, msg.category || msg.area);
      this.stats.messagesReceived++;
      this.stats.messagesSynced++;
    }

    this.syncStatus.set(fromNode, SyncStatus.COMPLETE);
    this.lastSyncTime.set(fromNode, Date.now());

    this.emit('messages-received', fromNode, message.messages.length);
  }
  
  /**
   * Handle version vector update
   * @private
   */
  async _handleVersionVector(message, fromNode) {
    console.log(`[BBSSync] Received version vector from ${fromNode}`);
    this.versionVectors.set(fromNode, message.versionVector);
    this.emit('version-vector-updated', fromNode);
  }
  
  /**
   * Handle tombstone (deleted message)
   * @private
   */
  async _handleTombstone(message, fromNode) {
    console.log(`[BBSSync] Received tombstone for ${message.messageId} from ${fromNode}`);

    // Record tombstone
    this.tombstones.set(message.messageId, message.deletedAt);

    // Delete from BBS if present
    if (this.bbs && typeof this.bbs.deleteMessageByGlobalId === 'function') {
      this.bbs.deleteMessageByGlobalId(message.messageId);
    }
    this.knownMessageIds.delete(message.messageId);

    this.stats.tombstonesProcessed++;
    this.emit('tombstone-received', message.messageId, fromNode);
  }
  
  /**
   * Handle Bloom filter sync
   * @private
   * @param {Object} message - Bloom filter message
   * @param {string} fromNode - Source node
   */
  async _handleBloomFilter(message, fromNode) {
    console.log(`[BBSSync] Received Bloom filter for ${message.area} from ${fromNode}`);
    
    // Deserialize remote Bloom filter
    const remoteFilter = BloomFilter.deserialize(message.bloomFilter);
    const localFilter = this.areaBloomFilters.get(message.area);
    
    if (!localFilter) {
      console.warn(`[BBSSync] No local Bloom filter for area: ${message.area}`);
      return;
    }
    
    // Find messages we have (in this area) that remote doesn't
    const messagesToSend = [];
    const areaMessages = (this.bbs && typeof this.bbs.getMessages === 'function')
      ? this.bbs.getMessages({ category: message.area })
      : [];

    for (const msg of areaMessages) {
      if (!msg.globalId || !this.knownMessageIds.has(msg.globalId)) continue;
      // Check if remote likely has this message
      if (!remoteFilter.has(msg.globalId)) {
        // Remote probably doesn't have it - send the full message, not just the id
        messagesToSend.push(this._toWireMessage(msg));

        if (messagesToSend.length >= this.maxSyncBatchSize) {
          break; // Respect batch size limit
        }
      }
    }
    
    console.log(`[BBSSync] Bloom filter comparison: ${messagesToSend.length} messages to send`);
    
    // Calculate bandwidth saved
    const fullSyncSize = this.knownMessageIds.size * 100; // Estimate 100 bytes per message ID
    const bloomSyncSize = message.bloomFilter.bits.length + messagesToSend.length * 100;
    this.stats.bandwidthSaved += Math.max(0, fullSyncSize - bloomSyncSize);
    
    // Send missing messages
    if (messagesToSend.length > 0) {
      const response = {
        type: SyncMessageType.MESSAGE_DATA,
        fromNode: this.localCallsign,
        toNode: fromNode,
        messages: messagesToSend
      };
      
      const payload = Buffer.from(JSON.stringify(response));
      this.backboneManager.sendData(fromNode, payload);
      
      this.emit('bloom-sync-complete', fromNode, message.area, messagesToSend.length);
    }
  }
  
  /**
   * Detect conflict for a message
   * @private
   * @param {Object} existingMessage - Existing message in BBS
   * @param {Object} localMessage - Local version (if any)
   * @param {Object} remoteMessage - Remote version
   * @returns {Object|null} Conflict info or null
   */
  _detectConflict(existingMessage, localMessage, remoteMessage) {
    if (!existingMessage || !remoteMessage) return null;
    
    // If we have both local and remote versions that are both newer than existing
    const localModified = localMessage && localMessage.timestamp > existingMessage.timestamp;
    const remoteModified = remoteMessage.timestamp > existingMessage.timestamp;
    
    if (localModified && remoteModified) {
      // Both modified - concurrent update conflict
      return {
        type: 'concurrent_update',
        existingTimestamp: existingMessage.timestamp,
        localTimestamp: localMessage.timestamp,
        remoteTimestamp: remoteMessage.timestamp,
        reason: 'Both local and remote modified the same message'
      };
    }
    
    // If existing message was modified by one node and we're receiving
    // a modification from a different node, that's a concurrent update conflict
    if (existingMessage.modifiedBy && remoteMessage.modifiedBy && 
        existingMessage.modifiedBy !== remoteMessage.modifiedBy) {
      // Two different nodes modified the same message - concurrent update
      return {
        type: 'concurrent_update',
        existingTimestamp: existingMessage.timestamp,
        existingModifiedBy: existingMessage.modifiedBy,
        remoteTimestamp: remoteMessage.timestamp,
        remoteModifiedBy: remoteMessage.modifiedBy,
        reason: `Message modified by ${existingMessage.modifiedBy} and ${remoteMessage.modifiedBy}`
      };
    }
    
    // Check for vector clock conflicts if using vector-clock resolution
    if (this.conflictResolution === 'vector-clock') {
      const vcConflict = this._detectConflictVectorClock(localMessage || existingMessage, remoteMessage);
      if (vcConflict) return vcConflict;
    }
    
    return null;
  }
  
  /**
   * Detect conflicts using vector clocks
   * @private
   * @param {Object} msg1 - First message version
   * @param {Object} msg2 - Second message version
   * @returns {Object|null} Conflict info or null
   */
  _detectConflictVectorClock(msg1, msg2) {
    if (!msg1 || !msg2) return null;
    if (!msg1.vectorClock || !msg2.vectorClock) return null;
    
    // Compare vector clocks to determine causality
    const vc1 = msg1.vectorClock;
    const vc2 = msg2.vectorClock;
    
    // Get all nodes mentioned in either vector clock
    const allNodes = new Set([...Object.keys(vc1), ...Object.keys(vc2)]);
    
    let msg1Dominates = false;
    let msg2Dominates = false;
    
    for (const node of allNodes) {
      const v1 = vc1[node] || 0;
      const v2 = vc2[node] || 0;
      
      if (v1 > v2) msg1Dominates = true;
      if (v2 > v1) msg2Dominates = true;
    }
    
    // If both dominate, they are concurrent (conflict)
    if (msg1Dominates && msg2Dominates) {
      return {
        type: 'concurrent_update',
        reason: 'Vector clocks incomparable - concurrent updates detected',
        vectorClock1: vc1,
        vectorClock2: vc2
      };
    }
    
    // If msg1 dominates, it's newer (no conflict)
    // If msg2 dominates, it's newer (no conflict)
    // If neither dominates, they're identical (no conflict)
    return null;
  }
  
  /**
   * Resolve message conflict
   * @private
   * @param {Object} msg1 - First message version
   * @param {Object} msg2 - Second message version
   * @param {Object} conflict - Conflict info from _detectConflict
   * @returns {Object} Resolved message
   */
  _resolveConflict(msg1, msg2, conflict) {
    this.stats.conflictsResolved++;
    this.emit('conflict-detected', { msg1, msg2, conflict });
    
    if (this.conflictResolution === 'last-write-wins') {
      // Use message with latest timestamp
      const winner = msg2.timestamp > msg1.timestamp ? msg2 : msg1;
      console.log(`[BBSSync] Conflict resolved using last-write-wins: ${winner.id} (${new Date(winner.timestamp).toISOString()})`);
      return winner;
    }
    
    if (this.conflictResolution === 'vector-clock') {
      // Merge using vector clocks
      const mergedVectorClock = this._mergeVectorClocks(
        msg1.vectorClock || {},
        msg2.vectorClock || {}
      );
      
      // Create merged message with conflict markers
      const resolved = {
        ...msg1,
        id: msg1.id,
        body: this._createConflictMarkers(msg1, msg2),
        timestamp: Math.max(msg1.timestamp, msg2.timestamp),
        vectorClock: mergedVectorClock,
        hasConflictMarkers: true,
        conflictInfo: {
          versions: [
            { from: msg1.modifiedBy, timestamp: msg1.timestamp, body: msg1.body },
            { from: msg2.modifiedBy, timestamp: msg2.timestamp, body: msg2.body }
          ],
          resolvedAt: Date.now(),
          resolvedBy: this.localCallsign
        }
      };
      
      console.log(`[BBSSync] Conflict resolved using vector-clock merge: ${resolved.id}`);
      return resolved;
    }
    
    // Fallback to msg2
    return msg2;
  }
  
  /**
   * Merge two vector clocks (take maximum of each component)
   * @private
   */
  _mergeVectorClocks(vc1, vc2) {
    const allNodes = new Set([...Object.keys(vc1), ...Object.keys(vc2)]);
    const merged = {};
    
    for (const node of allNodes) {
      merged[node] = Math.max(vc1[node] || 0, vc2[node] || 0);
    }
    
    return merged;
  }
  
  /**
   * Create conflict markers for manual resolution
   * @private
   */
  _createConflictMarkers(msg1, msg2) {
    return `<<<<<<< Version from ${msg1.modifiedBy} at ${new Date(msg1.timestamp).toISOString()}
${msg1.body}
=======
${msg2.body}
>>>>>>> Version from ${msg2.modifiedBy} at ${new Date(msg2.timestamp).toISOString()}`;
  }
}

// Export constants
BBSSync.SyncMessageType = SyncMessageType;
BBSSync.SyncStatus = SyncStatus;

module.exports = BBSSync;
